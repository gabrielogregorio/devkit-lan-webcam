import asyncio
from collections.abc import AsyncIterator
from types import ModuleType

import pytest
from aiohttp.test_utils import TestClient, TestServer


@pytest.fixture
async def client_spawn_fails(
    server_module: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[TestClient]:
    """Client cujo make_ffmpeg sempre falha, simulando o binário ffmpeg ausente."""
    def raise_ffmpeg_missing() -> None:
        raise FileNotFoundError("ffmpeg not found")

    monkeypatch.setattr(server_module, "make_ffmpeg", raise_ffmpeg_missing)

    test_client = TestClient(TestServer(server_module.build_app()))
    await test_client.start_server()
    yield test_client
    await test_client.close()


async def test_spawn_failure_closes_ws_not_server(client_spawn_fails: TestClient) -> None:
    websocket = await client_spawn_fails.ws_connect("/ws")
    message = await websocket.receive(timeout=2)
    assert message.type.name in ("CLOSE", "CLOSING", "CLOSED")
    await websocket.close()


async def test_server_survives_after_spawn_failure(client_spawn_fails: TestClient) -> None:
    websocket = await client_spawn_fails.ws_connect("/ws")
    await websocket.receive(timeout=2)
    await websocket.close()
    await asyncio.sleep(0.02)

    response = await client_spawn_fails.get("/")
    assert response.status == 200
