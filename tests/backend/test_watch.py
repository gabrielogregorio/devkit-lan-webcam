import asyncio
import json

import pytest
from aiohttp.test_utils import TestClient
from secure_client import Credential, SecurePage, open_page

from access import (
    MAX_REQUESTS,
    Broadcast,
    Session,
    parse_decision,
    parse_json_object,
    parse_viewer_key,
    request_id,
    router_ip,
)
from conftest import SERVER_IP, FakeFfmpegProcess

SILENCE_SECONDS = 0.15
LOCAL_IP = "127.0.0.1"

JPEG_FRAME = b"\xff\xd8frame\xff\xd9"
LAPTOP_KEY = "a" * 32
PHONE_KEY = "b" * 32
SECOND_TAB_KEY = "c" * 32


def ask(key: str) -> dict[str, object]:
    return {"type": "request", "key": key}


def decide(key: str, decision: str) -> dict[str, object]:
    return {"type": "decide", "id": request_id(LOCAL_IP, key), "decision": decision}


async def wait_status(page: SecurePage, access: str) -> dict[str, object]:
    status = await page.next_json("status")
    while status["access"] != access:
        status = await page.next_json("status")
    return status


async def wait_requests(camera: SecurePage, count: int) -> list[dict[str, object]]:
    status = await camera.next_json("requests")
    while len(status["requests"]) != count:
        status = await camera.next_json("requests")
    return status["requests"]


async def start_camera(client: TestClient, credential: Credential) -> SecurePage:
    camera = await open_page(client, credential)
    await camera.send_json({"type": "camera-start"})
    await camera.next_json("requests")
    return camera


async def test_open_page_without_a_request_has_no_access(client: TestClient, credential: Credential) -> None:
    viewer = await open_page(client, credential)
    status = await viewer.next_json("status")
    assert status == {"type": "status", "camera": False, "streaming": False, "access": "none", "code": None}
    await viewer.close()


async def test_request_is_pending_with_a_code_from_ip_and_key(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))

    status = await wait_status(viewer, "pending")
    requests = await wait_requests(camera, 1)

    expected_id = request_id(LOCAL_IP, LAPTOP_KEY)
    assert status == {
        "type": "status",
        "camera": True,
        "streaming": False,
        "access": "pending",
        "code": expected_id[:8],
    }
    assert requests[0]["id"] == expected_id
    assert requests[0]["code"] == expected_id[:8]
    assert requests[0]["ip"] == LOCAL_IP
    assert requests[0]["state"] == "pending"
    assert requests[0]["connected"] is True
    assert LAPTOP_KEY not in json.dumps(requests), "the key itself never reaches the camera"
    await viewer.close()
    await camera.close()


async def test_only_the_approved_request_gets_frames(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    laptop = await open_page(client, credential)
    phone = await open_page(client, credential)
    await laptop.send_json(ask(LAPTOP_KEY))
    await phone.send_json(ask(PHONE_KEY))
    await wait_requests(camera, 2)

    await camera.send_json(decide(LAPTOP_KEY, "approve"))
    await wait_status(laptop, "approved")
    await camera.send_frame(JPEG_FRAME)

    assert await laptop.next_frame() == JPEG_FRAME, "the JPEG as sent, without the release marker"
    assert await phone.receives_no_frame(), "a pending request never gets a frame"
    await laptop.close()
    await phone.close()
    await camera.close()


async def test_denied_and_revoked_requests_get_no_frames(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))
    await wait_requests(camera, 1)

    await camera.send_json(decide(LAPTOP_KEY, "deny"))
    await wait_status(viewer, "denied")
    await camera.send_frame(JPEG_FRAME)
    assert await viewer.receives_no_frame()

    await camera.send_json(decide(LAPTOP_KEY, "approve"))
    await wait_status(viewer, "approved")
    await camera.send_json(decide(LAPTOP_KEY, "revoke"))
    await wait_status(viewer, "denied")
    await camera.send_frame(JPEG_FRAME)
    assert await viewer.receives_no_frame()
    await viewer.close()
    await camera.close()


async def test_each_tab_key_is_its_own_request(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    first_tab = await open_page(client, credential)
    second_tab = await open_page(client, credential)
    await first_tab.send_json(ask(LAPTOP_KEY))
    await second_tab.send_json(ask(SECOND_TAB_KEY))

    requests = await wait_requests(camera, 2)

    assert {item["code"] for item in requests} == {
        request_id(LOCAL_IP, LAPTOP_KEY)[:8],
        request_id(LOCAL_IP, SECOND_TAB_KEY)[:8],
    }
    await first_tab.close()
    await second_tab.close()
    await camera.close()


@pytest.mark.parametrize(
    "message",
    [
        {"type": "request", "key": "a" * 31},
        {"type": "request", "key": "A" * 32},
        {"type": "request", "key": "g" * 32},
        {"type": "request"},
        {"type": "ping"},
    ],
)
async def test_invalid_requests_are_ignored(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
    message: dict[str, object],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(message)
    await viewer.send_json(ask(LAPTOP_KEY))

    requests = await wait_requests(camera, 1)

    assert requests[0]["id"] == request_id(LOCAL_IP, LAPTOP_KEY)
    await viewer.close()
    await camera.close()


async def test_a_viewer_cannot_approve_itself(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))
    await wait_requests(camera, 1)

    await viewer.send_json(decide(LAPTOP_KEY, "approve"))
    await asyncio.sleep(SILENCE_SECONDS)
    await camera.send_frame(JPEG_FRAME)

    assert await viewer.receives_no_frame(), "only the camera page decides"
    await viewer.close()
    await camera.close()


async def test_camera_leaving_sends_every_approval_back_to_pending(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))
    await wait_requests(camera, 1)
    await camera.send_json(decide(LAPTOP_KEY, "approve"))
    await wait_status(viewer, "approved")

    await camera.close()

    status = await wait_status(viewer, "pending")
    assert status["camera"] is False
    await viewer.close()


async def test_an_approved_tab_that_reloads_is_still_approved(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))
    await wait_requests(camera, 1)
    await camera.send_json(decide(LAPTOP_KEY, "approve"))
    await wait_status(viewer, "approved")

    await viewer.close()
    requests = await wait_requests(camera, 1)
    while requests[0]["connected"]:
        requests = await wait_requests(camera, 1)
    reloaded = await open_page(client, credential)
    await reloaded.send_json(ask(LAPTOP_KEY))

    await wait_status(reloaded, "approved")
    await reloaded.close()
    await camera.close()


async def test_a_pending_tab_that_closes_leaves_the_list(
    client: TestClient,
    credential: Credential,
    fake_ffmpeg: list[FakeFfmpegProcess],
) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))
    await wait_requests(camera, 1)

    await viewer.close()

    assert await wait_requests(camera, 0) == []
    await camera.close()


def fake_session(device: str = "device") -> Session:
    return Session(websocket=None, cipher=None, device_id="d" * 32, ip=LOCAL_IP, device=device)


def test_the_request_list_is_bounded() -> None:
    broadcast = Broadcast()
    viewers = [fake_session() for _ in range(MAX_REQUESTS + 1)]
    for viewer in viewers:
        broadcast.join(viewer)

    accepted = [broadcast.ask(viewer, f"{index:032x}") for index, viewer in enumerate(viewers)]

    assert accepted.count(True) == MAX_REQUESTS
    assert accepted[-1] is False
    assert len(broadcast.requests) == MAX_REQUESTS


def test_a_tab_asking_with_a_new_key_drops_its_old_request() -> None:
    broadcast = Broadcast()
    viewer = fake_session()
    broadcast.join(viewer)
    broadcast.ask(viewer, LAPTOP_KEY)
    assert broadcast.ask(viewer, LAPTOP_KEY) is True

    broadcast.ask(viewer, PHONE_KEY)

    assert list(broadcast.requests) == [request_id(LOCAL_IP, PHONE_KEY)]


def test_device_text_is_cut_and_unknown_decisions_change_nothing() -> None:
    broadcast = Broadcast()
    viewer = fake_session("x" * 500)
    broadcast.join(viewer)
    broadcast.ask(viewer, LAPTOP_KEY)

    assert len(broadcast.requests[request_id(LOCAL_IP, LAPTOP_KEY)].device) == 160
    assert broadcast.decide("not-a-request", "approved") is False


def test_same_key_from_another_machine_is_another_request() -> None:
    assert request_id("192.168.0.10", LAPTOP_KEY) != request_id("192.168.0.11", LAPTOP_KEY)


def test_message_parsers() -> None:
    assert parse_json_object("[]") is None
    assert parse_json_object("ping") is None
    assert parse_viewer_key({"type": "request", "key": LAPTOP_KEY}) == LAPTOP_KEY
    assert parse_viewer_key({"type": "request", "key": 42}) is None
    assert parse_decision({"type": "decide", "id": "abc", "decision": "approve"}) == ("abc", "approved")
    assert parse_decision({"type": "decide", "id": "abc", "decision": "revoke"}) == ("abc", "denied")
    assert parse_decision({"type": "decide", "id": "abc", "decision": "maybe"}) is None
    assert parse_decision({"type": "decide", "id": 7, "decision": "approve"}) is None


async def test_every_page_gets_the_network_panel(client: TestClient, credential: Credential) -> None:
    camera = await start_camera(client, credential)
    viewer = await open_page(client, credential)
    await viewer.send_json(ask(LAPTOP_KEY))
    await wait_requests(camera, 1)
    await camera.send_json(decide(LAPTOP_KEY, "approve"))
    await wait_status(viewer, "approved")

    panel = await viewer.next_json("network")
    while not any(peer["role"] == "watching" for peer in panel["peers"]):
        panel = await viewer.next_json("network")

    assert panel["you"] == LOCAL_IP
    assert panel["server"] == SERVER_IP
    assert panel["camera"]["ip"] == LOCAL_IP
    assert sorted(peer["role"] for peer in panel["peers"]) == ["camera", "watching"]
    assert [peer["you"] for peer in panel["peers"] if peer["role"] == "watching"] == [True]
    assert len(panel["pairing"]["code"]) == 6
    assert 0 < panel["pairing"]["secondsLeft"] <= 300
    await viewer.close()
    await camera.close()


def test_router_is_read_from_the_default_route() -> None:
    table = (
        "Iface\tDestination\tGateway\tFlags\n"
        "wlp3s0\t0000A8C0\t00000000\t0001\n"
        "wlp3s0\t00000000\t0100A8C0\t0003\n"
    )

    assert router_ip(table) == "192.168.0.1"
    assert router_ip("Iface\tDestination\tGateway\n") is None
