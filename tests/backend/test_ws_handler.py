import asyncio

from aiohttp.test_utils import TestClient
from conftest import FakeFfmpegProcess

HANDLER_SETTLE_SECONDS = 0.05

JPEG_FRAME_A = b"\xff\xd8frameA\xff\xd9"
JPEG_FRAME_B = b"\xff\xd8frameB\xff\xd9"


async def test_ws_spawns_one_ffmpeg_and_writes_frames(
    client: TestClient,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    websocket = await client.ws_connect("/ws")
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    assert len(fake_ffmpeg) == 1, "deve subir exatamente 1 ffmpeg por conexão"

    await websocket.send_bytes(JPEG_FRAME_A)
    await websocket.send_bytes(JPEG_FRAME_B)
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    ffmpeg_process = fake_ffmpeg[0]
    assert ffmpeg_process.writes == [JPEG_FRAME_A, JPEG_FRAME_B]

    await websocket.close()
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    assert ffmpeg_process.terminated or ffmpeg_process.killed


async def test_text_messages_do_not_break(
    client: TestClient,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    websocket = await client.ws_connect("/ws")
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    await websocket.send_str("ping")
    await websocket.send_bytes(JPEG_FRAME_A)
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    assert fake_ffmpeg[0].writes == [JPEG_FRAME_A]
    await websocket.close()


async def test_disconnect_closes_stdin_and_stops(
    client: TestClient,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    websocket = await client.ws_connect("/ws")
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    ffmpeg_process = fake_ffmpeg[0]
    await websocket.close()
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    assert ffmpeg_process.stdin.close.called
    assert ffmpeg_process.terminated or ffmpeg_process.killed


async def test_broken_pipe_breaks_loop_cleanly(
    client: TestClient,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    websocket = await client.ws_connect("/ws")
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    ffmpeg_process = fake_ffmpeg[0]
    ffmpeg_process.stdin.write.side_effect = BrokenPipeError("ffmpeg died")

    await websocket.send_bytes(JPEG_FRAME_A)
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    response = await client.get("/")
    assert response.status == 200, "o servidor segue de pé mesmo com o ffmpeg morto"
    await websocket.close()
