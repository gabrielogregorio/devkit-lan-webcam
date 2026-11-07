#!/usr/bin/env python3
"""
Receives camera frames from a browser on the local network and feeds them into a v4l2loopback virtual
device through ffmpeg, so that camera shows up as a webcam on this PC. Serves the web app, relays the
frames to the Watch pages the camera approved, and encrypts everything (crypto_channel.py, handshake.py).
"""
import asyncio
import os
import re
import socket
import ssl
import subprocess
import threading
from collections.abc import AsyncIterator
from typing import IO

from aiohttp import WSMsgType, web

import entropy
import pairing
from access import (
    Broadcast,
    NetworkInfo,
    Session,
    announce,
    parse_decision,
    parse_json_object,
    parse_viewer_key,
    relay_frame,
    router_ip,
)
from crypto_channel import KIND_FRAME, KIND_JSON, HandshakeError
from handshake import PAIRING_GUARD_KEY, PairingGuard, open_session, run_pairing

DEVICE: str = os.environ.get("CAM_DEVICE", "/dev/video10")
WIDTH: int = int(os.environ.get("CAM_WIDTH", "1280"))
HEIGHT: int = int(os.environ.get("CAM_HEIGHT", "720"))
FPS: int = int(os.environ.get("CAM_FPS", "25"))
PORT: int = int(os.environ.get("PORT", "9443"))
# Plain HTTP for devices that only watch (the camera needs HTTPS: browsers block it elsewhere). 0 turns it off.
HTTP_PORT: int = int(os.environ.get("HTTP_PORT", "9080"))
HERE: str = os.path.dirname(os.path.abspath(__file__))
# The React app built by `pnpm run build` (run.sh builds it when it is missing). Only this folder is served.
DIST: str = os.path.join(HERE, "web", "dist")
# Pages of the app: every one gets the same index.html and the app picks the page from the address.
PAGE_ROUTES: tuple[str, ...] = ("/", "/stream", "/watch")
# Vite names every asset after its content hash: a plain file name, never a path.
ASSET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
FFMPEG_SHUTDOWN_TIMEOUT_SECONDS: int = 3
WEBSOCKET_MAX_MESSAGE_BYTES: int = 16 * 1024 * 1024
PAIRING_MAX_MESSAGE_BYTES: int = 4 * 1024
CODE_CHECK_SECONDS: int = 5

# Without no-store the browser keeps an old index.html after a new build, pointing at assets that no longer exist.
NO_CACHE_HEADERS: dict[str, str] = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
}
# A hashed asset never changes under the same name.
ASSET_CACHE_HEADERS: dict[str, str] = {"Cache-Control": "public, max-age=31536000, immutable"}
NOT_BUILT_MESSAGE = "The web app is not built yet. Run ./run.sh, or pnpm install && pnpm run build."
DIST_KEY = web.AppKey("dist", str)
SERVER_IP_KEY = web.AppKey("server_ip", str)
BROADCAST_KEY = web.AppKey("broadcast", Broadcast)


def local_ip_address() -> str:
    probe_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe_socket.connect(("8.8.8.8", 80))
        return probe_socket.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe_socket.close()


def ffmpeg_cmd(
    device: str | None = None,
    width: int | None = None,
    height: int | None = None,
    fps: int | None = None,
) -> list[str]:
    device = DEVICE if device is None else device
    width = WIDTH if width is None else width
    height = HEIGHT if height is None else height
    fps = FPS if fps is None else fps
    return [
        # "error": the empty JPEG appended to each frame (see write_frame) makes the decoder warn on every frame;
        # the two error lines it also causes are dropped by forward_ffmpeg_log.
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-use_wallclock_as_timestamps", "1",
        # No probing: otherwise ffmpeg holds the first frames to guess the stream.
        "-probesize", "32", "-analyzeduration", "0",
        "-f", "mjpeg", "-i", "pipe:0",
        "-vf", f"scale={width}:{height},format=yuv420p",
        "-r", str(fps),
        "-f", "v4l2", device,
    ]


# What the decoder says about the empty JPEG appended to every frame (FRAME_RELEASE_MARKER): two lines per
# frame, expected and harmless. Only these are dropped; any other ffmpeg line still reaches the log.
EXPECTED_MARKER_ERRORS = (
    "No JPEG data found in image",
    "Error submitting packet to decoder: Invalid data found when processing input",
)


def forward_ffmpeg_log(stderr: IO[bytes]) -> None:
    """Copies ffmpeg's stderr to the server log, without the two lines the release marker causes."""
    for raw_line in stderr:
        line = raw_line.decode(errors="replace").rstrip()
        if line and not line.endswith(EXPECTED_MARKER_ERRORS):
            print(f"[ffmpeg] {line}", flush=True)


def make_ffmpeg() -> subprocess.Popen[bytes]:
    ffmpeg_process = subprocess.Popen(ffmpeg_cmd(), stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    if ffmpeg_process.stderr is not None:
        threading.Thread(target=forward_ffmpeg_log, args=(ffmpeg_process.stderr,), daemon=True).start()
    return ffmpeg_process


# The mjpeg parser only releases a frame when it sees the start (SOI) of the next one, which holds every
# frame for one whole frame interval (40 ms at 25 fps). An empty JPEG (SOI + EOI) right after each frame
# releases it at once; the decoder rejects the empty one and moves on. Measured: 83 ms -> 43 ms at 25 fps.
FRAME_RELEASE_MARKER = b"\xff\xd8\xff\xd9"


def write_frame(ffmpeg_process: subprocess.Popen[bytes], jpeg_frame: bytes) -> bool:
    """False when ffmpeg takes no more frames (it died, the device is gone, stdin is closed)."""
    if ffmpeg_process.stdin is None:
        return False
    try:
        ffmpeg_process.stdin.write(jpeg_frame + FRAME_RELEASE_MARKER)
        ffmpeg_process.stdin.flush()
    except (OSError, ValueError):
        return False
    return True


def stop_ffmpeg(ffmpeg_process: subprocess.Popen[bytes]) -> None:
    if ffmpeg_process.stdin is not None:
        try:
            ffmpeg_process.stdin.close()
        except (OSError, ValueError):
            pass
    ffmpeg_process.terminate()
    try:
        ffmpeg_process.wait(timeout=FFMPEG_SHUTDOWN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        ffmpeg_process.kill()


async def app_page(request: web.Request) -> web.StreamResponse:
    index_path = os.path.join(request.app[DIST_KEY], "index.html")
    if not os.path.isfile(index_path):
        return web.Response(status=503, text=NOT_BUILT_MESSAGE, headers=dict(NO_CACHE_HEADERS))
    return web.FileResponse(index_path, headers=dict(NO_CACHE_HEADERS))


async def asset(request: web.Request) -> web.FileResponse:
    name = request.match_info["name"]
    if not ASSET_NAME.fullmatch(name):
        raise web.HTTPNotFound()
    asset_path = os.path.join(request.app[DIST_KEY], "assets", name)
    if not os.path.isfile(asset_path):
        raise web.HTTPNotFound()
    return web.FileResponse(asset_path, headers=dict(ASSET_CACHE_HEADERS))


def network_info(app: web.Application) -> NetworkInfo:
    code, seconds_left = pairing.current_code(pairing.load_seed())
    return NetworkInfo(app[SERVER_IP_KEY], router_ip(), code, seconds_left)


async def announce_all(app: web.Application) -> None:
    await announce(app[BROADCAST_KEY], network_info(app))


def start_camera(broadcast: Broadcast, session: Session) -> Session | None:
    """Makes the session the camera and returns the one it replaced. Raises OSError when ffmpeg cannot start."""
    previous = broadcast.camera if broadcast.camera is not session else None
    if session.ffmpeg is None:
        session.ffmpeg = make_ffmpeg()
    if previous is not None:
        stop_camera(broadcast, previous)
    broadcast.camera = session
    print(f'[+] Camera "{session.ip}" streaming, feeding "{DEVICE}"')
    return previous


def stop_camera(broadcast: Broadcast, session: Session) -> None:
    if session.ffmpeg is not None:
        stop_ffmpeg(session.ffmpeg)
        session.ffmpeg = None
        print(f'[-] Camera "{session.ip}" stopped')
    if broadcast.camera is session:
        broadcast.camera_left()


async def handle_session_json(app: web.Application, session: Session, message: dict[str, object]) -> None:
    broadcast = app[BROADCAST_KEY]
    kind = message.get("type")
    if kind == "camera-start":
        try:
            previous = start_camera(broadcast, session)
        except OSError as error:
            print(f'[!] Could not start ffmpeg: "{error}"')
            await session.send_json({"type": "camera-error"})
            return
        if previous is not None:
            await previous.send_json({"type": "camera-stopped", "reason": "taken"})
    elif kind == "camera-stop":
        stop_camera(broadcast, session)
    elif kind == "decide":
        decision = parse_decision(message)
        if decision is None or broadcast.camera is not session or not broadcast.decide(*decision):
            return
        print(f'[i] Watch request "{decision[0][:8]}": {decision[1]}')
    elif kind == "request":
        key = parse_viewer_key(message)
        if key is None or not broadcast.ask(session, key):
            return
        print(f'[i] Watch request from "{session.ip}"')
    else:
        return
    await announce_all(app)


async def handle_session_frame(broadcast: Broadcast, session: Session, jpeg_frame: bytes) -> None:
    if broadcast.camera is not session or session.ffmpeg is None:
        return
    if not write_frame(session.ffmpeg, jpeg_frame):
        stop_camera(broadcast, session)
        await session.send_json({"type": "camera-stopped", "reason": "device"})
        return
    relay_frame(broadcast, jpeg_frame)


async def session_handler(request: web.Request) -> web.WebSocketResponse:
    """One page: encrypted session; streams the camera, asks to watch, decides requests, gets the panel."""
    websocket = web.WebSocketResponse(heartbeat=20, max_msg_size=WEBSOCKET_MAX_MESSAGE_BYTES)
    await websocket.prepare(request)
    try:
        opened = await open_session(websocket)
    except (HandshakeError, TimeoutError):
        await websocket.close()
        return websocket
    if opened is None:
        await websocket.close()
        return websocket
    app = request.app
    broadcast = app[BROADCAST_KEY]
    session = Session(
        websocket, opened.cipher, opened.device_id, request.remote or "unknown", request.headers.get("User-Agent", "")
    )
    broadcast.join(session)
    print(f'[+] Page connected from "{session.ip}" ({len(broadcast.sessions)} open)')
    try:
        await announce_all(app)
        async for message in websocket:
            if message.type != WSMsgType.BINARY:
                break
            try:
                kind, payload = session.cipher.decrypt(message.data)
            except HandshakeError:
                break
            if kind == KIND_FRAME:
                await handle_session_frame(broadcast, session, payload)
            elif kind == KIND_JSON:
                parsed = parse_json_object(payload)
                if parsed is not None:
                    await handle_session_json(app, session, parsed)
    finally:
        stop_camera(broadcast, session)
        broadcast.leave(session)
        print(f'[-] Page disconnected from "{session.ip}" ({len(broadcast.sessions)} open)')
        await announce_all(app)
    return websocket


async def pair_handler(request: web.Request) -> web.WebSocketResponse:
    websocket = web.WebSocketResponse(max_msg_size=PAIRING_MAX_MESSAGE_BYTES)
    await websocket.prepare(request)
    ip = request.remote or "unknown"
    try:
        guard = request.app[PAIRING_GUARD_KEY]
        outcome = await run_pairing(websocket, guard, ip, request.headers.get("User-Agent", ""))
        print(f'[i] Pairing from "{ip}": {outcome}')
    except (HandshakeError, TimeoutError):
        print(f'[!] Pairing from "{ip}": malformed')
    await websocket.close()
    return websocket


async def watch_pairing_code(app: web.Application) -> None:
    """Pushes the panel again when the code turns or the icon changes it, so pages show the code on screen."""
    last_code = None
    while True:
        code, _seconds_left = pairing.current_code(pairing.load_seed())
        if code != last_code:
            if last_code is not None:
                await announce_all(app)
            last_code = code
        await asyncio.sleep(CODE_CHECK_SECONDS)


async def start_background(app: web.Application) -> AsyncIterator[None]:
    task = asyncio.create_task(watch_pairing_code(app))
    yield
    task.cancel()


def build_app(dist_dir: str = DIST, server_ip: str | None = None) -> web.Application:
    app = web.Application()
    app[BROADCAST_KEY] = Broadcast()
    app[PAIRING_GUARD_KEY] = PairingGuard()
    app[DIST_KEY] = dist_dir
    app[SERVER_IP_KEY] = server_ip or local_ip_address()
    app.cleanup_ctx.append(start_background)
    for path in PAGE_ROUTES:
        app.router.add_get(path, app_page)
    app.router.add_get("/assets/{name}", asset)
    app.router.add_get("/ws/pair", pair_handler)
    app.router.add_get("/ws/session", session_handler)
    return app


async def serve(app: web.Application, ssl_context: ssl.SSLContext) -> None:
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT, ssl_context=ssl_context).start()
    if HTTP_PORT:
        await web.TCPSite(runner, "0.0.0.0", HTTP_PORT).start()
    await asyncio.Event().wait()


def main() -> None:
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(os.path.join(HERE, "cert.pem"), os.path.join(HERE, "key.pem"))
    address = local_ip_address()
    code, seconds_left = pairing.current_code(pairing.load_seed())

    print("\n" + "=" * 60)
    print(f"  Stream a camera (HTTPS):   https://{address}:{PORT}/stream")
    print(f"  Watch it:                  https://{address}:{PORT}/watch")
    if HTTP_PORT:
        print(f"  Watch it over plain HTTP:  http://{address}:{HTTP_PORT}/watch")
        print("                             (still encrypted between the browser and this PC)")
    print(f"  Pairing code now:          {code[:3]} {code[3:]}  (changes every {pairing.code_period_seconds()} s;")
    print("                             see it in the top bar icon or with ./run.sh code)")
    print(f"  Virtual webcam:            {DEVICE}  ({WIDTH}x{HEIGHT}@{FPS})")
    print(f"  Randomness:                {' + '.join(entropy.sources())}")
    print("=" * 60 + "\n")
    try:
        asyncio.run(serve(build_app(server_ip=address), ssl_context))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
