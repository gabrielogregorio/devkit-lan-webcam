import json

import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient
from secure_client import Credential, open_page

from crypto_channel import KIND_JSON, MessageCipher

RECEIVE_TIMEOUT_SECONDS = 1


async def expect_closed(websocket) -> None:
    message = await websocket.receive(timeout=RECEIVE_TIMEOUT_SECONDS)
    while message.type in (WSMsgType.TEXT, WSMsgType.BINARY):
        message = await websocket.receive(timeout=RECEIVE_TIMEOUT_SECONDS)
    assert message.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED)


@pytest.mark.parametrize(
    "first_message",
    [
        "not json",
        "[]",
        json.dumps({"type": "pair", "share": "zz"}),
        json.dumps({"type": "pair", "share": "00" * 32}),
        json.dumps({"type": "hello"}),
    ],
)
async def test_malformed_pairing_is_closed_and_the_server_stays_up(client: TestClient, first_message: str) -> None:
    websocket = await client.ws_connect("/ws/pair")
    await websocket.send_str(first_message)

    await expect_closed(websocket)
    assert (await client.get("/")).status == 200


@pytest.mark.parametrize(
    "hello",
    [
        {"type": "hello", "device": "short", "epk": "00" * 32, "nonce": "00" * 16},
        {"type": "hello", "device": "a" * 32, "epk": "00" * 31, "nonce": "00" * 16},
        {"type": "hello", "device": "a" * 32, "epk": "00" * 32, "nonce": "00"},
        {"type": "pair"},
    ],
)
async def test_malformed_session_hello_is_closed(client: TestClient, hello: dict[str, object]) -> None:
    websocket = await client.ws_connect("/ws/session")
    await websocket.send_json(hello)

    await expect_closed(websocket)


async def test_an_unknown_device_is_told_to_pair_again(client: TestClient) -> None:
    websocket = await client.ws_connect("/ws/session")
    await websocket.send_json({"type": "hello", "device": "a" * 32, "epk": "11" * 32, "nonce": "00" * 16})

    reply = await websocket.receive_json(timeout=RECEIVE_TIMEOUT_SECONDS)

    assert reply == {"type": "unpaired"}


async def test_a_wrong_session_proof_is_closed(client: TestClient, credential: Credential) -> None:
    websocket = await client.ws_connect("/ws/session")
    await websocket.send_json(
        {"type": "hello", "device": credential.device_id, "epk": "09" + "00" * 31, "nonce": "00" * 16}
    )
    welcome = await websocket.receive_json(timeout=RECEIVE_TIMEOUT_SECONDS)
    assert welcome["type"] == "welcome"

    await websocket.send_json({"type": "ready", "confirm": "00" * 32})

    await expect_closed(websocket)


async def test_a_message_with_the_wrong_key_ends_the_session(client: TestClient, credential: Credential) -> None:
    page = await open_page(client, credential)
    forged = MessageCipher(b"\x01" * 32, b"\x02" * 32)

    await page.websocket.send_bytes(forged.encrypt(KIND_JSON, b"{}"))

    await expect_closed(page.websocket)


async def test_a_replayed_message_ends_the_session(client: TestClient, credential: Credential) -> None:
    page = await open_page(client, credential)
    message = page.cipher.encrypt_json({"type": "camera-stop"})
    await page.websocket.send_bytes(message)

    await page.websocket.send_bytes(message)

    await expect_closed(page.websocket)


async def test_a_text_message_after_the_handshake_ends_the_session(client: TestClient, credential: Credential) -> None:
    page = await open_page(client, credential)

    await page.websocket.send_str("plain text")

    await expect_closed(page.websocket)
