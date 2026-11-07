from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

from conftest import APP_HTML, APP_SCRIPT

NO_CACHE = "no-store, no-cache, must-revalidate"
ASSET_CACHE = "public, max-age=31536000, immutable"


@pytest.mark.parametrize("path", ["/", "/stream", "/watch"])
async def test_every_page_gets_the_app_without_cache(client: TestClient, path: str) -> None:
    response = await client.get(path)
    assert response.status == 200
    assert "text/html" in response.headers["Content-Type"]
    assert response.headers.get("Cache-Control") == NO_CACHE
    assert response.headers.get("Pragma") == "no-cache"
    assert await response.text() == APP_HTML


async def test_hashed_asset_is_served_with_long_cache(client: TestClient) -> None:
    response = await client.get("/assets/app-1a2b3c.js")
    assert response.status == 200
    assert "javascript" in response.headers["Content-Type"]
    assert response.headers.get("Cache-Control") == ASSET_CACHE
    assert await response.text() == APP_SCRIPT


@pytest.mark.parametrize(
    "path",
    [
        "/assets/missing.js",
        "/assets/..%2Findex.html",
        "/assets/.hidden",
        "/assets/%2e%2e%2f%2e%2e%2fserver.py",
        "/assets/../../server.py",
    ],
)
async def test_assets_never_leave_the_assets_folder(client: TestClient, path: str) -> None:
    response = await client.get(path)
    assert response.status == 404, path


@pytest.mark.parametrize(
    "path",
    ["/key.pem", "/cert.pem", "/server.py", "/../server.py", "/index.html", "/web/dist/index.html", "/nope"],
)
async def test_private_and_unknown_files_are_not_served(client: TestClient, path: str) -> None:
    response = await client.get(path)
    assert response.status == 404, path


async def test_missing_build_answers_503_with_what_to_run(server_module, tmp_path: Path) -> None:
    test_client = TestClient(TestServer(server_module.build_app(str(tmp_path / "not-built"))))
    await test_client.start_server()
    try:
        response = await test_client.get("/")
        assert response.status == 503
        assert await response.text() == server_module.NOT_BUILT_MESSAGE
    finally:
        await test_client.close()
