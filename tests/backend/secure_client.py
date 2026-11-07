"""The browser's side of the protocol, in Python, so the backend tests speak real encryption."""
import hashlib
import json
import secrets
from dataclasses import dataclass

from aiohttp import ClientWebSocketResponse, WSMsgType
from aiohttp.test_utils import TestClient
from nacl import bindings as sodium

from crypto_channel import (
    KEY_BYTES,
    KIND_FRAME,
    KIND_JSON,
    NONCE_BYTES,
    POINT_M,
    POINT_N,
    PROTOCOL,
    SESSION_NONCE_BYTES,
    MessageCipher,
    hkdf,
    length_prefixed,
    mac,
    random_scalar,
    scalar_from_code,
    session_keys,
)

RECEIVE_TIMEOUT_SECONDS = 1
SILENCE_SECONDS = 0.15


@dataclass
class Credential:
    device_id: str
    secret: bytes


@dataclass
class PairingResult:
    outcome: str
    credential: Credential | None
    reply: dict[str, object]


def spake2_client_tags(
    secret: bytes, password_scalar: bytes, client_share: bytes, server_share: bytes
) -> tuple[bytes, bytes, bytes, bytes]:
    unblinded = sodium.crypto_core_ed25519_sub(
        server_share, sodium.crypto_scalarmult_ed25519_noclamp(password_scalar, POINT_N)
    )
    shared_point = sodium.crypto_scalarmult_ed25519_noclamp(secret, unblinded)
    transcript = length_prefixed(
        b"client", b"server", POINT_M, POINT_N, client_share, server_share, shared_point, password_scalar
    )
    digest = hashlib.sha512(transcript).digest()
    confirm_keys = hkdf(b"", digest[KEY_BYTES:], b"ConfirmationKeys", 2 * KEY_BYTES)
    client_tag = mac(confirm_keys[:KEY_BYTES], transcript)
    server_tag = mac(confirm_keys[KEY_BYTES:], transcript)
    return client_tag, server_tag, digest[:KEY_BYTES], transcript


async def pair(client: TestClient, code: str) -> PairingResult:
    websocket = await client.ws_connect("/ws/pair")
    secret = random_scalar()
    password_scalar = scalar_from_code(code)
    client_share = sodium.crypto_core_ed25519_add(
        sodium.crypto_scalarmult_ed25519_base_noclamp(secret),
        sodium.crypto_scalarmult_ed25519_noclamp(password_scalar, POINT_M),
    )
    await websocket.send_json({"type": "pair", "share": client_share.hex()})
    challenge = await websocket.receive_json(timeout=RECEIVE_TIMEOUT_SECONDS)
    if challenge["type"] != "challenge":
        await websocket.close()
        return PairingResult(challenge["type"], None, challenge)
    candidates = [
        spake2_client_tags(secret, password_scalar, client_share, bytes.fromhex(share))
        for share in challenge["shares"]
    ]
    await websocket.send_json({"type": "confirm", "tags": [candidate[0].hex() for candidate in candidates]})
    reply = await websocket.receive_json(timeout=RECEIVE_TIMEOUT_SECONDS)
    await websocket.close()
    if reply["type"] != "paired":
        return PairingResult(reply["type"], None, reply)
    server_tag = bytes.fromhex(reply["confirm"])
    match = next(candidate for candidate in candidates if candidate[1] == server_tag)
    sealed = bytes.fromhex(reply["credential"])
    plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        sealed[NONCE_BYTES:], PROTOCOL, sealed[:NONCE_BYTES], match[2]
    )
    payload = json.loads(plaintext)
    return PairingResult("paired", Credential(payload["id"], bytes.fromhex(payload["secret"])), reply)


class SecurePage:
    """One open page: an encrypted session to /ws/session."""

    def __init__(self, websocket: ClientWebSocketResponse, cipher: MessageCipher) -> None:
        self.websocket = websocket
        self.cipher = cipher

    async def send_json(self, payload: dict[str, object]) -> None:
        await self.websocket.send_bytes(self.cipher.encrypt_json(payload))

    async def send_frame(self, jpeg_frame: bytes) -> None:
        await self.websocket.send_bytes(self.cipher.encrypt(KIND_FRAME, jpeg_frame))

    async def receive(self, timeout: float = RECEIVE_TIMEOUT_SECONDS) -> tuple[int, bytes]:
        message = await self.websocket.receive(timeout=timeout)
        if message.type != WSMsgType.BINARY:
            raise ConnectionError(f"session ended: {message.type}")
        return self.cipher.decrypt(message.data)

    async def next_json(self, wanted_type: str) -> dict[str, object]:
        while True:
            kind, payload = await self.receive()
            if kind == KIND_JSON:
                message = json.loads(payload)
                if message.get("type") == wanted_type:
                    return message

    async def next_frame(self) -> bytes:
        while True:
            kind, payload = await self.receive()
            if kind == KIND_FRAME:
                return payload

    async def receives_no_frame(self) -> bool:
        try:
            while True:
                kind, _payload = await self.receive(timeout=SILENCE_SECONDS)
                if kind == KIND_FRAME:
                    return False
        except TimeoutError:
            return True

    async def close(self) -> None:
        await self.websocket.close()


async def open_page(client: TestClient, credential: Credential) -> SecurePage:
    websocket = await client.ws_connect("/ws/session")
    private_key = secrets.token_bytes(KEY_BYTES)
    public_key = sodium.crypto_scalarmult_base(private_key)
    nonce = secrets.token_bytes(SESSION_NONCE_BYTES)
    await websocket.send_json(
        {"type": "hello", "device": credential.device_id, "epk": public_key.hex(), "nonce": nonce.hex()}
    )
    welcome = await websocket.receive_json(timeout=RECEIVE_TIMEOUT_SECONDS)
    if welcome["type"] != "welcome":
        raise PermissionError(welcome["type"])
    server_public = bytes.fromhex(welcome["epk"])
    shared_secret = sodium.crypto_scalarmult(private_key, server_public)
    keys = session_keys(
        credential.secret,
        credential.device_id,
        public_key,
        nonce,
        server_public,
        bytes.fromhex(welcome["nonce"]),
        shared_secret,
    )
    assert bytes.fromhex(welcome["confirm"]) == mac(keys.server_confirm, keys.transcript), "server proved the key"
    await websocket.send_json({"type": "ready", "confirm": mac(keys.client_confirm, keys.transcript).hex()})
    return SecurePage(websocket, MessageCipher(keys.client_to_server, keys.server_to_client))
