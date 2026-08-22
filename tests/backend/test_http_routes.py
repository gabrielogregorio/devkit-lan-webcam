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


async def test_unknown_route_404(client: TestClient) -> None:
    response = await client.get("/nope")
    assert response.status == 404
