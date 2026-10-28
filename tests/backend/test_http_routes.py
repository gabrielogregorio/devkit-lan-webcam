from aiohttp.test_utils import TestClient

NO_CACHE = "no-store, no-cache, must-revalidate"


async def test_index_ok_and_html(client: TestClient) -> None:
    response = await client.get("/")
    assert response.status == 200
    assert "text/html" in response.headers["Content-Type"]
    body = await response.text()
    assert '<canvas id="preview">' in body
    assert "./view.js" in body


async def test_index_no_cache_headers(client: TestClient) -> None:
    response = await client.get("/")
    assert response.headers.get("Cache-Control") == NO_CACHE
    assert response.headers.get("Pragma") == "no-cache"


async def test_view_js_served_and_no_cache(client: TestClient) -> None:
    response = await client.get("/view.js")
    assert response.status == 200
    content_type = response.headers["Content-Type"]
    assert "javascript" in content_type or "ecmascript" in content_type
    assert response.headers.get("Cache-Control") == NO_CACHE
    body = await response.text()
    assert "computeDrawParams" in body


async def test_i18n_js_served_and_no_cache(client: TestClient) -> None:
    response = await client.get("/i18n.js")
    assert response.status == 200
    assert response.headers.get("Cache-Control") == NO_CACHE
    assert "PT_BR" in await response.text()


async def test_private_files_not_served(client: TestClient) -> None:
    for path in ("/key.pem", "/cert.pem", "/server.py", "/../server.py"):
        response = await client.get(path)
        assert response.status == 404, path


async def test_unknown_route_404(client: TestClient) -> None:
    response = await client.get("/nope")
    assert response.status == 404
