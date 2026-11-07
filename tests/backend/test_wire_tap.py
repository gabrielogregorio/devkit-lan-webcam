"""Break tests: someone on the LAN records or changes the raw TCP stream of plain HTTP.

Every test runs the real server and the real protocol through WireTap (wire_tap.py), a relay in the middle.
They prove what the eavesdropper sees, and that changing or replaying bytes gets nothing through.
"""
import asyncio
import json
from collections.abc import AsyncIterator

import pytest
from aiohttp.test_utils import TestClient
from secure_client import Credential, SecurePage, open_page, pair
from wire_tap import CLIENT_TO_SERVER, OPCODE_BINARY, OPCODE_TEXT, TappedClient, WireTap

from access import request_id
from conftest import FakeFfmpegProcess, current_code
from crypto_channel import COUNTER_BYTES, scalar_from_code

LOCAL_IP = "127.0.0.1"
VIEWER_KEY = "e" * 32
PIXELS = b"VISIBLE-PIXELS-" * 64
# A JPEG with a JFIF header, the way canvas.toBlob makes them: the markers an eavesdropper would look for.
JPEG_FRAME = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + PIXELS + b"\xff\xd9"
JPEG_MARKERS = (b"\xff\xd8\xff", b"JFIF", PIXELS[:15])
# The only messages that may cross in the clear: pairing and session handshakes, made of public values.
HANDSHAKE_TYPES = {"pair", "challenge", "confirm", "paired", "hello", "welcome", "ready"}
# What the app says after the handshake: none of it may be readable on the wire.
APP_WORDS = (b"camera-start", b"request", b"decide", b"approve", b"status", b"network", VIEWER_KEY.encode())
SETTLE_SECONDS = 0.2
RECEIVE_TIMEOUT_SECONDS = 1


@pytest.fixture
async def tap(client: TestClient) -> AsyncIterator[WireTap]:
    wire_tap = WireTap(client.server.port)
    await wire_tap.start()
    yield wire_tap
    await wire_tap.close()


async def approved_viewer(tapped: TappedClient, credential: Credential) -> tuple[SecurePage, SecurePage]:
    """A camera and a viewer it approved, both through the tap."""
    camera = await open_page(tapped, credential)
    await camera.send_json({"type": "camera-start"})
    await camera.next_json("requests")
    viewer = await open_page(tapped, credential)
    await viewer.send_json({"type": "request", "key": VIEWER_KEY})
    await camera.next_json("requests")
    await camera.send_json({"type": "decide", "id": request_id(LOCAL_IP, VIEWER_KEY), "decision": "approve"})
    status = await viewer.next_json("status")
    while status["access"] != "approved":
        status = await viewer.next_json("status")
    return camera, viewer


async def test_an_eavesdropper_sees_no_picture_no_app_message_and_no_secret(
    client: TestClient, tap: WireTap, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    tapped = TappedClient(tap, compress=15)
    code = current_code()
    paired = await pair(tapped, code)
    assert paired.credential is not None
    credential = paired.credential
    camera, viewer = await approved_viewer(tapped, credential)

    await camera.send_frame(JPEG_FRAME)
    assert await viewer.next_frame() == JPEG_FRAME, "the picture did cross the wire"
    await camera.close()
    await viewer.close()
    await tapped.close()
    await asyncio.sleep(SETTLE_SECONDS)

    messages = tap.messages()
    wire = tap.all_bytes()
    assert sum(message.opcode == OPCODE_BINARY for message in messages) >= 2, "frame and app messages were captured"
    for marker in JPEG_MARKERS:
        assert marker not in wire, f"JPEG marker {marker!r} visible on the wire"
    for word in APP_WORDS:
        assert all(word not in m.payload for m in messages if m.opcode == OPCODE_BINARY), f"{word!r} readable"
    assert credential.secret not in wire and credential.secret.hex().encode() not in wire, "the device secret leaked"
    assert scalar_from_code(code).hex().encode() not in wire, "the pairing code leaked"
    text_types = {json.loads(m.payload)["type"] for m in messages if m.opcode == OPCODE_TEXT}
    assert text_types <= HANDSHAKE_TYPES, f"plain text after the handshake: {text_types - HANDSHAKE_TYPES}"


async def test_the_same_picture_never_looks_the_same_on_the_wire(
    client: TestClient, tap: WireTap, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    tapped = TappedClient(tap, compress=0)
    camera, viewer = await approved_viewer(tapped, credential)

    for _ in range(2):
        await camera.send_frame(JPEG_FRAME)
        await viewer.next_frame()
    await camera.close()
    await viewer.close()
    await tapped.close()
    await asyncio.sleep(SETTLE_SECONDS)

    sent = [m.payload for m in tap.messages() if m.direction == CLIENT_TO_SERVER and m.opcode == OPCODE_BINARY]
    frames = [payload for payload in sent if len(payload) > len(JPEG_FRAME)]
    assert len(frames) == 2
    # The first 8 bytes are the public counter; the rest must differ even for the same picture.
    assert frames[0][COUNTER_BYTES:] != frames[1][COUNTER_BYTES:], "a fresh nonce per message hides repeats"


async def test_a_bit_flipped_on_the_wire_ends_the_session_and_nothing_reaches_the_webcam(
    client: TestClient, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    armed = {"flip": False}

    def flip_last_bit(direction: str, chunk: bytes) -> bytes:
        if armed["flip"] and direction == CLIENT_TO_SERVER:
            armed["flip"] = False
            return chunk[:-1] + bytes([chunk[-1] ^ 1])
        return chunk

    tap = WireTap(client.server.port, tamper=flip_last_bit)
    await tap.start()
    tapped = TappedClient(tap, compress=0)
    camera, viewer = await approved_viewer(tapped, credential)
    try:
        armed["flip"] = True
        await camera.send_frame(JPEG_FRAME)

        with pytest.raises(ConnectionError):
            await camera.next_json("never")
        assert await viewer.receives_no_frame(), "the changed frame reached nobody"
        assert all(JPEG_FRAME not in b"".join(process.writes) for process in fake_ffmpeg), "nor the PC webcam"
    finally:
        await camera.close()
        await viewer.close()
        await tapped.close()
        await tap.close()


async def test_a_recorded_session_played_back_later_gets_nothing(
    client: TestClient, tap: WireTap, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    tapped = TappedClient(tap, compress=0)
    camera = await open_page(tapped, credential)
    await camera.send_json({"type": "camera-start"})
    await camera.next_json("requests")
    await camera.send_frame(JPEG_FRAME)
    await camera.close()
    await tapped.close()
    await asyncio.sleep(SETTLE_SECONDS)
    recorded = next(c for c in tap.connections if c.is_websocket)
    started_before = len(fake_ffmpeg)

    reader, writer = await asyncio.open_connection("127.0.0.1", client.server.port)
    writer.write(bytes(recorded.client_to_server))
    await writer.drain()
    answer = await asyncio.wait_for(reader.read(), RECEIVE_TIMEOUT_SECONDS)
    writer.close()

    assert b" 101 " in answer, "the server took the upgrade and answered the hello with a fresh welcome"
    assert len(fake_ffmpeg) == started_before, "the replayed camera-start did not open the webcam"
    assert sum(process.writes.count(JPEG_FRAME) for process in fake_ffmpeg) <= 1, "the replayed frame was refused"
