import importlib
import os
import sys
from collections.abc import AsyncIterator
from types import ModuleType
from unittest.mock import MagicMock

import pytest
from aiohttp.test_utils import TestClient, TestServer

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


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


@pytest.fixture
async def client(
    server_module: ModuleType,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> AsyncIterator[TestClient]:
    """Plain HTTP TestClient on an ephemeral port: never binds 9443 nor holds the device."""
    test_client = TestClient(TestServer(server_module.build_app()))
    await test_client.start_server()
    yield test_client
    await test_client.close()
