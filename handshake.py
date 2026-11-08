"""
The two handshakes over a WebSocket, before any encrypted message.

/ws/pair     SPAKE2 with the 6-digit code -> the device gets its credential (device id + secret).
/ws/session  device id + ephemeral X25519 -> session keys, confirmed both ways -> MessageCipher.

PairingGuard limits guessing: 5 wrong codes per IP in 10 minutes block that IP, and 10 wrong codes in
total lock pairing until the code is changed in the top bar icon (a new seed resets the count).
"""
import hmac
import json
import time
from collections import deque
from dataclasses import dataclass, field

from aiohttp import WSMsgType, web

import pairing
from crypto_channel import (
    KEY_BYTES,
    SESSION_NONCE_BYTES,
    TAG_BYTES,
    HandshakeError,
    MessageCipher,
    decode_bytes,
    decode_point,
    mac,
    seal,
    server_hello,
    spake2_server,
)

HANDSHAKE_TIMEOUT_SECONDS = 15
DEVICE_ID_HEX_LENGTH = 2 * pairing.DEVICE_ID_BYTES
IP_FAILURE_LIMIT = 5
IP_FAILURE_WINDOW_SECONDS = 600
TOTAL_FAILURE_LIMIT = 10


@dataclass
class PairingGuard:
    ip_failures: dict[str, deque[float]] = field(default_factory=dict)
    failures_by_seed: dict[str, int] = field(default_factory=dict)

    def seconds_blocked(self, ip: str, now: float) -> int:
        failures = self.ip_failures.get(ip)
        if not failures:
            return 0
        while failures and now - failures[0] >= IP_FAILURE_WINDOW_SECONDS:
            failures.popleft()
        if len(failures) < IP_FAILURE_LIMIT:
            return 0

        return int(IP_FAILURE_WINDOW_SECONDS - (now - failures[0])) + 1

    def locked(self, seed: bytes) -> bool:
        return self.failures_by_seed.get(pairing.seed_fingerprint(seed), 0) >= TOTAL_FAILURE_LIMIT

    def record_failure(self, ip: str, seed: bytes, now: float) -> None:
        self.ip_failures.setdefault(ip, deque()).append(now)
        fingerprint = pairing.seed_fingerprint(seed)
        self.failures_by_seed[fingerprint] = self.failures_by_seed.get(fingerprint, 0) + 1


PAIRING_GUARD_KEY = web.AppKey("pairing_guard", PairingGuard)


async def receive_json(websocket: web.WebSocketResponse) -> dict[str, object]:
    message = await websocket.receive(timeout=HANDSHAKE_TIMEOUT_SECONDS)
    if message.type != WSMsgType.TEXT:
        raise HandshakeError("expected a text message")
    try:
        payload = json.loads(message.data)
    except ValueError as error:
        raise HandshakeError("not JSON") from error
    if not isinstance(payload, dict):
        raise HandshakeError("not an object")
    return payload


def expect_type(payload: dict[str, object], wanted: str) -> None:
    if payload.get("type") != wanted:
        raise HandshakeError(f"expected {wanted}")


async def run_pairing(websocket: web.WebSocketResponse, guard: PairingGuard, ip: str, device: str) -> str:
    """Returns how it ended: "paired", "wrong-code", "blocked" or "locked"."""
    first = await receive_json(websocket)
    expect_type(first, "pair")
    client_share = decode_point(first.get("share"))
    now = time.time()
    blocked_for = guard.seconds_blocked(ip, now)
    if blocked_for:
        await websocket.send_json({"type": "blocked", "retryIn": blocked_for})
        return "blocked"
    seed = pairing.load_seed()
    if guard.locked(seed):
        await websocket.send_json({"type": "locked"})
        return "locked"
    candidates = [spake2_server(client_share, code) for code in pairing.accepted_codes(seed, now)]
    await websocket.send_json({"type": "challenge", "shares": [candidate.share.hex() for candidate in candidates]})
    answer = await receive_json(websocket)
    expect_type(answer, "confirm")
    tags = answer.get("tags")
    if not isinstance(tags, list) or len(tags) != len(candidates):
        raise HandshakeError("wrong number of tags")
    received = [decode_bytes(tag, TAG_BYTES) for tag in tags]
    match = next(
        (
            candidate
            for candidate, tag in zip(candidates, received, strict=True)
            if hmac.compare_digest(tag, mac(candidate.client_confirm_key, candidate.transcript))
        ),
        None,
    )
    if match is None:
        guard.record_failure(ip, seed, now)
        await websocket.send_json({"type": "wrong-code"})
        return "wrong-code"
    device_id, secret = pairing.add_device(ip, device)
    credential = json.dumps({"id": device_id, "secret": secret.hex()}).encode()
    await websocket.send_json(
        {
            "type": "paired",
            "confirm": mac(match.server_confirm_key, match.transcript).hex(),
            "credential": seal(match.encryption_key, credential).hex(),
        }
    )
    return "paired"


@dataclass
class OpenSession:
    device_id: str
    cipher: MessageCipher


async def open_session(websocket: web.WebSocketResponse) -> OpenSession | None:
    """None when the device is not paired (it was told so and must pair again)."""
    hello = await receive_json(websocket)
    expect_type(hello, "hello")
    device_id = hello.get("device")
    if not isinstance(device_id, str) or len(device_id) != DEVICE_ID_HEX_LENGTH:
        raise HandshakeError("bad device id")
    client_public = decode_bytes(hello.get("epk"), KEY_BYTES)
    client_nonce = decode_bytes(hello.get("nonce"), SESSION_NONCE_BYTES)
    secret = pairing.device_secret(device_id)
    if secret is None:
        await websocket.send_json({"type": "unpaired"})
        return None
    server = server_hello(device_id, secret, client_public, client_nonce)
    await websocket.send_json(server.reply)
    ready = await receive_json(websocket)
    expect_type(ready, "ready")
    proof = decode_bytes(ready.get("confirm"), TAG_BYTES)
    if not hmac.compare_digest(proof, mac(server.keys.client_confirm, server.keys.transcript)):
        raise HandshakeError("the device did not prove the session key")
    return OpenSession(device_id, MessageCipher(server.keys.server_to_client, server.keys.client_to_server))
