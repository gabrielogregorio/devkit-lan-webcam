import importlib
import os
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import pytest
from aiohttp.test_utils import TestClient, TestServer

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


SERVER_IP = "192.168.0.50"


@pytest.fixture(autouse=True)
def private_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Pairing seed and paired devices go to a temporary folder, never to the PC's real config."""
    config = tmp_path / "config"
    monkeypatch.setenv("LAN_WEBCAM_CONFIG_DIR", str(config))
    return config


@pytest.fixture
def server_module() -> ModuleType:
    import server
    return importlib.reload(server)


class FakeFfmpegProcess:
    """ffmpeg double: records what was written to stdin and how it was stopped,
    without starting the real binary or touching /dev/video10."""

    def __init__(self) -> None:
        self.stdin = MagicMock()
        self.writes: list[bytes] = []
        self.terminated = False
        self.killed = False
        self.waited = False

        def record_write(data: bytes) -> None:
            self.writes.append(data)

        self.stdin.write.side_effect = record_write

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True

    def wait(self, timeout: float | None = None) -> int:
        self.waited = True
        return 0


@pytest.fixture
def fake_ffmpeg(server_module: ModuleType, monkeypatch: pytest.MonkeyPatch) -> list[FakeFfmpegProcess]:
    """Fake processes the handler created (normally 1 per connection)."""
    created_processes: list[FakeFfmpegProcess] = []

    def factory() -> FakeFfmpegProcess:
        ffmpeg_process = FakeFfmpegProcess()
        created_processes.append(ffmpeg_process)
        return ffmpeg_process

    monkeypatch.setattr(server_module, "make_ffmpeg", factory)
    return created_processes


APP_HTML = '<!doctype html><div id="root"></div><script type="module" src="/assets/app-1a2b3c.js"></script>'
APP_SCRIPT = "console.log('lan webcam app')"


@pytest.fixture
def dist_dir(tmp_path: Path) -> Path:
    """A stand-in for web/dist, so the tests never depend on a real build."""
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text(APP_HTML)
    (assets / "app-1a2b3c.js").write_text(APP_SCRIPT)
    return dist


@pytest.fixture
async def client(
    server_module: ModuleType,
    fake_ffmpeg: list[FakeFfmpegProcess],
    dist_dir: Path,
) -> AsyncIterator[TestClient]:
    """Plain HTTP TestClient on an ephemeral port: never binds 9443 nor holds the device."""
    test_client = TestClient(TestServer(server_module.build_app(str(dist_dir), server_ip=SERVER_IP)))
    await test_client.start_server()
    yield test_client
    await test_client.close()


def current_code() -> str:
    import pairing

    return pairing.current_code(pairing.load_seed())[0]


@pytest.fixture
async def credential(client: TestClient):
    """A device paired with the code on screen."""
    from secure_client import pair

    result = await pair(client, current_code())
    assert result.credential is not None
    return result.credential
