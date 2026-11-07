import asyncio
from types import ModuleType

import pytest
from aiohttp.test_utils import TestClient
from secure_client import Credential, open_page

from conftest import FakeFfmpegProcess
from server import FRAME_RELEASE_MARKER

HANDLER_SETTLE_SECONDS = 0.05

JPEG_FRAME_A = b"\xff\xd8frameA\xff\xd9"
JPEG_FRAME_B = b"\xff\xd8frameB\xff\xd9"


async def test_camera_start_spawns_one_ffmpeg_and_feeds_it(
    client: TestClient, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    camera = await open_page(client, credential)
    await camera.send_json({"type": "camera-start"})
    await camera.send_frame(JPEG_FRAME_A)
    await camera.send_frame(JPEG_FRAME_B)
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    assert len(fake_ffmpeg) == 1, "exactly 1 ffmpeg per camera"
    assert fake_ffmpeg[0].writes == [JPEG_FRAME_A + FRAME_RELEASE_MARKER, JPEG_FRAME_B + FRAME_RELEASE_MARKER]
    await camera.close()


async def test_a_page_that_never_started_the_camera_feeds_nothing(
    client: TestClient, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    page = await open_page(client, credential)
    await page.send_frame(JPEG_FRAME_A)
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    assert fake_ffmpeg == []
    await page.close()


async def test_camera_stop_and_disconnect_stop_ffmpeg(
    client: TestClient, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    camera = await open_page(client, credential)
    await camera.send_json({"type": "camera-start"})
    await camera.send_json({"type": "camera-stop"})
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    assert fake_ffmpeg[0].stdin.close.called
    assert fake_ffmpeg[0].terminated

    await camera.send_json({"type": "camera-start"})
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    await camera.close()
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    assert fake_ffmpeg[1].terminated or fake_ffmpeg[1].killed


async def test_a_new_camera_takes_over_and_the_old_one_is_told(
    client: TestClient, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    first = await open_page(client, credential)
    second = await open_page(client, credential)
    await first.send_json({"type": "camera-start"})
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)

    await second.send_json({"type": "camera-start"})

    stopped = await first.next_json("camera-stopped")
    assert stopped["reason"] == "taken"
    assert fake_ffmpeg[0].terminated
    await first.close()
    await second.close()


async def test_broken_pipe_stops_the_camera_and_the_server_stays_up(
    client: TestClient, credential: Credential, fake_ffmpeg: list[FakeFfmpegProcess]
) -> None:
    camera = await open_page(client, credential)
    await camera.send_json({"type": "camera-start"})
    await asyncio.sleep(HANDLER_SETTLE_SECONDS)
    fake_ffmpeg[0].stdin.write.side_effect = BrokenPipeError("ffmpeg died")

    await camera.send_frame(JPEG_FRAME_A)

    stopped = await camera.next_json("camera-stopped")
    assert stopped["reason"] == "device"
    response = await client.get("/")
    assert response.status == 200
    await camera.close()


async def test_ffmpeg_missing_tells_the_camera(
    client: TestClient, credential: Credential, server_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    def raise_ffmpeg_missing() -> None:
        raise FileNotFoundError("ffmpeg not found")

    monkeypatch.setattr(server_module, "make_ffmpeg", raise_ffmpeg_missing)
    camera = await open_page(client, credential)

    await camera.send_json({"type": "camera-start"})

    assert (await camera.next_json("camera-error"))["type"] == "camera-error"
    await camera.close()
