"""
Encryption between the browser and this server, built so it holds even over plain HTTP.

Pairing (once per device, with the 6-digit code): SPAKE2 (RFC 9382) over edwards25519. The code never
travels; someone who records the traffic cannot test codes offline, and each attempt tests one guess.
The server answers for the current and the previous code, and the browser proves which one it knew.
On success the server hands over a random 256-bit device secret, encrypted with the SPAKE2 key.

Session (every connection): ephemeral X25519 + the device secret, through HKDF, give one key per
direction and two confirmation keys. Both sides prove they hold the keys before anything else.
Messages are XChaCha20-Poly1305 with a counter as nonce: a replayed or reordered message is refused.

The browser side is web/src/lib/crypto/ (noble libraries); both sides are checked against each other.
"""
import hashlib
import hmac
import json
import secrets
import struct
from dataclasses import dataclass

from nacl import bindings as sodium
from nacl.exceptions import CryptoError

PROTOCOL = b"lan-webcam v1"
# RFC 9382, section 4: M and N for edwards25519 (nobody knows their discrete logarithm).
POINT_M = bytes.fromhex("d048032c6ea0b6d697ddc2e86bda85a33adac920f1bf18e1b0c6d166a5cecdaf")
POINT_N = bytes.fromhex("d3bfb518f44f3430f29d0c92af503865a1ed3281dc69b35dd868ba85f886c4ab")
POINT_BYTES = 32
KEY_BYTES = 32
NONCE_BYTES = 24
COUNTER_BYTES = 8
SESSION_NONCE_BYTES = 16
TAG_BYTES = 32
KIND_JSON = 1
KIND_FRAME = 2


class HandshakeError(Exception):
    """A malformed or failed handshake: the connection is closed."""


def hkdf(salt: bytes, input_key: bytes, info: bytes, length: int) -> bytes:
    """HKDF-SHA256 (RFC 5869)."""
    pseudo_random_key = hmac.new(salt, input_key, hashlib.sha256).digest()
    output = b""
    block = b""
    counter = 1
    while len(output) < length:
        block = hmac.new(pseudo_random_key, block + info + bytes([counter]), hashlib.sha256).digest()
        output += block
        counter += 1
    return output[:length]


def length_prefixed(*parts: bytes) -> bytes:
    return b"".join(struct.pack("<Q", len(part)) + part for part in parts)


def mac(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def scalar_from_code(code: str) -> bytes:
    return sodium.crypto_core_ed25519_scalar_reduce(hashlib.sha512(PROTOCOL + b" spake2 " + code.encode()).digest())


def random_scalar() -> bytes:
    return sodium.crypto_core_ed25519_scalar_reduce(secrets.token_bytes(64))


def decode_point(hex_text: object) -> bytes:
    if not isinstance(hex_text, str):
        raise HandshakeError("point is not text")
    try:
        point = bytes.fromhex(hex_text)
    except ValueError as error:
        raise HandshakeError("point is not hex") from error
    if len(point) != POINT_BYTES or not sodium.crypto_core_ed25519_is_valid_point(point):
        raise HandshakeError("not a valid point")
    return point


def decode_bytes(hex_text: object, length: int) -> bytes:
    if not isinstance(hex_text, str):
        raise HandshakeError("value is not text")
    try:
        value = bytes.fromhex(hex_text)
    except ValueError as error:
        raise HandshakeError("value is not hex") from error
    if len(value) != length:
        raise HandshakeError("value has the wrong length")
    return value


@dataclass
class PairingCandidate:
    """The server's side of SPAKE2 for one accepted code."""

    share: bytes
    encryption_key: bytes
    client_confirm_key: bytes
    server_confirm_key: bytes
    transcript: bytes


def spake2_server(client_share: bytes, code: str) -> PairingCandidate:
    password_scalar = scalar_from_code(code)
    secret = random_scalar()
    server_share = sodium.crypto_core_ed25519_add(
        sodium.crypto_scalarmult_ed25519_base_noclamp(secret),
        sodium.crypto_scalarmult_ed25519_noclamp(password_scalar, POINT_N),
    )
    unblinded = sodium.crypto_core_ed25519_sub(
        client_share, sodium.crypto_scalarmult_ed25519_noclamp(password_scalar, POINT_M)
    )
    try:
        shared_point = sodium.crypto_scalarmult_ed25519_noclamp(secret, unblinded)
    except (CryptoError, RuntimeError) as error:
        raise HandshakeError("degenerate share") from error
    transcript = length_prefixed(
        b"client", b"server", POINT_M, POINT_N, client_share, server_share, shared_point, password_scalar
    )
    digest = hashlib.sha512(transcript).digest()
    confirm_keys = hkdf(b"", digest[KEY_BYTES:], b"ConfirmationKeys", 2 * KEY_BYTES)
    return PairingCandidate(
        share=server_share,
        encryption_key=digest[:KEY_BYTES],
        client_confirm_key=confirm_keys[:KEY_BYTES],
        server_confirm_key=confirm_keys[KEY_BYTES:],
        transcript=transcript,
    )


def seal(key: bytes, plaintext: bytes) -> bytes:
    """One-off encryption with a random nonce (the device credential): nonce || ciphertext."""
    nonce = secrets.token_bytes(NONCE_BYTES)
    return nonce + sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, PROTOCOL, nonce, key)


@dataclass
class SessionKeys:
    client_to_server: bytes
    server_to_client: bytes
    client_confirm: bytes
    server_confirm: bytes
    transcript: bytes


def session_keys(
    device_secret: bytes,
    device_id: str,
    client_public: bytes,
    client_nonce: bytes,
    server_public: bytes,
    server_nonce: bytes,
    shared_secret: bytes,
) -> SessionKeys:
    transcript = length_prefixed(
        PROTOCOL, device_id.encode(), client_public, client_nonce, server_public, server_nonce
    )
    material = hkdf(device_secret, shared_secret, transcript, 4 * KEY_BYTES)
    return SessionKeys(
        client_to_server=material[:KEY_BYTES],
        server_to_client=material[KEY_BYTES : 2 * KEY_BYTES],
        client_confirm=material[2 * KEY_BYTES : 3 * KEY_BYTES],
        server_confirm=material[3 * KEY_BYTES :],
        transcript=transcript,
    )


@dataclass
class ServerHello:
    keys: SessionKeys
    reply: dict[str, object]


def server_hello(device_id: str, device_secret: bytes, client_public: bytes, client_nonce: bytes) -> ServerHello:
    server_private = secrets.token_bytes(KEY_BYTES)
    server_public = sodium.crypto_scalarmult_base(server_private)
    try:
        shared_secret = sodium.crypto_scalarmult(server_private, client_public)
    except (CryptoError, RuntimeError) as error:
        raise HandshakeError("degenerate X25519 key") from error
    server_nonce = secrets.token_bytes(SESSION_NONCE_BYTES)
    keys = session_keys(
        device_secret, device_id, client_public, client_nonce, server_public, server_nonce, shared_secret
    )
    reply = {
        "type": "welcome",
        "epk": server_public.hex(),
        "nonce": server_nonce.hex(),
        "confirm": mac(keys.server_confirm, keys.transcript).hex(),
    }
    return ServerHello(keys, reply)


class MessageCipher:
    """One direction pair of a session: counter nonces, strictly increasing on receipt."""

    def __init__(self, send_key: bytes, receive_key: bytes) -> None:
        self._send_key = send_key
        self._receive_key = receive_key
        self._send_counter = 0
        self._last_received = -1

    def encrypt(self, kind: int, payload: bytes) -> bytes:
        counter = self._send_counter
        self._send_counter += 1
        header = struct.pack(">Q", counter)
        nonce = bytes(NONCE_BYTES - COUNTER_BYTES) + header
        ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            bytes([kind]) + payload, PROTOCOL, nonce, self._send_key
        )
        return header + ciphertext

    def decrypt(self, message: bytes) -> tuple[int, bytes]:
        if len(message) <= COUNTER_BYTES:
            raise HandshakeError("message too short")
        header = message[:COUNTER_BYTES]
        counter = struct.unpack(">Q", header)[0]
        if counter <= self._last_received:
            raise HandshakeError("replayed or reordered message")
        nonce = bytes(NONCE_BYTES - COUNTER_BYTES) + header
        try:
            plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                message[COUNTER_BYTES:], PROTOCOL, nonce, self._receive_key
            )
        except CryptoError as error:
            raise HandshakeError("message failed authentication") from error
        if not plaintext:
            raise HandshakeError("empty message")
        self._last_received = counter
        return plaintext[0], plaintext[1:]

    def encrypt_json(self, payload: dict[str, object]) -> bytes:
        return self.encrypt(KIND_JSON, json.dumps(payload).encode())
