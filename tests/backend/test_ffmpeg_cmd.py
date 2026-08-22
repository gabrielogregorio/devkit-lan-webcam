import importlib
from types import ModuleType

import pytest

CAMERA_ENV_VARS = ("CAM_DEVICE", "CAM_WIDTH", "CAM_HEIGHT", "CAM_FPS", "PORT")


def test_ffmpeg_cmd_default_shape(server_module: ModuleType) -> None:
    command = server_module.ffmpeg_cmd()
    assert command[0] == "ffmpeg"
    assert "-f" in command and "mjpeg" in command
    assert "-i" in command and "pipe:0" in command
    assert f"scale={server_module.WIDTH}:{server_module.HEIGHT},format=yuv420p" in command

    last_format_flag = max(index for index, argument in enumerate(command) if argument == "-f")
    assert command[last_format_flag + 1] == "v4l2"
    assert command[-1] == server_module.DEVICE


def test_ffmpeg_cmd_explicit_params(server_module: ModuleType) -> None:
    command = server_module.ffmpeg_cmd(device="/dev/video42", width=640, height=480, fps=15)
    assert "scale=640:480,format=yuv420p" in command
    assert command[-1] == "/dev/video42"
    assert command[command.index("-r") + 1] == "15"


def test_env_vars_override_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAM_DEVICE", "/dev/video20")
    monkeypatch.setenv("CAM_WIDTH", "800")
    monkeypatch.setenv("CAM_HEIGHT", "600")
    monkeypatch.setenv("CAM_FPS", "10")
    monkeypatch.setenv("PORT", "12345")
    import server
    importlib.reload(server)
    try:
        assert server.DEVICE == "/dev/video20"
        assert server.WIDTH == 800
        assert server.HEIGHT == 600
        assert server.FPS == 10
        assert server.PORT == 12345
        command = server.ffmpeg_cmd()
        assert "scale=800:600,format=yuv420p" in command
        assert command[-1] == "/dev/video20"
    finally:
        for env_var in CAMERA_ENV_VARS:
            monkeypatch.delenv(env_var, raising=False)
        importlib.reload(server)


def test_defaults_match_claude_md(monkeypatch: pytest.MonkeyPatch) -> None:
    for env_var in CAMERA_ENV_VARS:
        monkeypatch.delenv(env_var, raising=False)
    import server
    importlib.reload(server)
    assert server.DEVICE == "/dev/video10"
    assert server.WIDTH == 1280
    assert server.HEIGHT == 720
    assert server.FPS == 25
    assert server.PORT == 9443
