import asyncio
import io
import shutil
import subprocess
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


def test_ffmpeg_log_drops_only_the_two_lines_the_release_marker_causes(capsys: pytest.CaptureFixture[str]) -> None:
    from server import forward_ffmpeg_log

    stderr = io.BytesIO(
        b"[mjpeg @ 0x5f] No JPEG data found in image\n"
        b"[vist#0:0/mjpeg @ 0x5f] Error submitting packet to decoder: Invalid data found when processing input\n"
        b"\n"
        b"[video4linux2,v4l2 @ 0x5f] ioctl(VIDIOC_G_FMT): Invalid argument\n"
    )

    forward_ffmpeg_log(stderr)

    assert capsys.readouterr().out == "[ffmpeg] [video4linux2,v4l2 @ 0x5f] ioctl(VIDIOC_G_FMT): Invalid argument\n"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs the real ffmpeg")
def test_the_real_ffmpeg_says_nothing_else_about_frames_with_the_release_marker(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The filter matches what the installed ffmpeg really prints, with the same input options as server.py."""
    from server import ffmpeg_cmd, forward_ffmpeg_log

    jpeg_frame = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=64x48", "-frames:v", "1",
         "-f", "mjpeg", "pipe:1"],
        capture_output=True, check=True,
    ).stdout
    command = ffmpeg_cmd()
    command = command[: command.index("-vf")] + ["-f", "null", "-"]
    decoded = subprocess.run(
        command, input=(jpeg_frame + FRAME_RELEASE_MARKER) * 3, capture_output=True, check=True
    )

    assert b"No JPEG data found" in decoded.stderr, "the marker still makes ffmpeg complain"
    forward_ffmpeg_log(io.BytesIO(decoded.stderr))
    assert capsys.readouterr().out == ""
