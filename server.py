#!/usr/bin/env python3
"""
Servidor que recebe os frames da câmera do celular (via WebSocket) e os injeta
num dispositivo virtual v4l2loopback usando ffmpeg, fazendo a câmera do celular
aparecer como uma webcam no PC.
"""
import os
import socket
import ssl
import subprocess

from aiohttp import WSCloseCode, WSMsgType, web

DEVICE: str = os.environ.get("CAM_DEVICE", "/dev/video10")
WIDTH: int = int(os.environ.get("CAM_WIDTH", "1280"))
HEIGHT: int = int(os.environ.get("CAM_HEIGHT", "720"))
FPS: int = int(os.environ.get("CAM_FPS", "25"))
PORT: int = int(os.environ.get("PORT", "9443"))
HERE: str = os.path.dirname(os.path.abspath(__file__))

FFMPEG_SHUTDOWN_TIMEOUT_SECONDS: int = 3
WEBSOCKET_MAX_MESSAGE_BYTES: int = 16 * 1024 * 1024

# Sem no-store o celular fica preso numa versão antiga do HTML/JS depois de cada edição.
NO_CACHE_HEADERS: dict[str, str] = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
}


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
        "ffmpeg", "-hide_banner", "-loglevel", "warning",
        "-use_wallclock_as_timestamps", "1",
        "-f", "mjpeg", "-i", "pipe:0",
        "-vf", f"scale={width}:{height},format=yuv420p",
        "-r", str(fps),
        "-f", "v4l2", device,
    ]


def make_ffmpeg() -> subprocess.Popen[bytes]:
    return subprocess.Popen(ffmpeg_cmd(), stdin=subprocess.PIPE)


def write_frame(ffmpeg_process: subprocess.Popen[bytes], jpeg_frame: bytes) -> bool:
    """False quando o ffmpeg não aceita mais frames (morreu, device sumiu, stdin fechado)."""
    if ffmpeg_process.stdin is None:
        return False
    try:
        ffmpeg_process.stdin.write(jpeg_frame)
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


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(os.path.join(HERE, "index.html"), headers=dict(NO_CACHE_HEADERS))


async def view_js(request: web.Request) -> web.FileResponse:
    return web.FileResponse(os.path.join(HERE, "view.js"), headers=dict(NO_CACHE_HEADERS))


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    websocket = web.WebSocketResponse(max_msg_size=WEBSOCKET_MAX_MESSAGE_BYTES)
    await websocket.prepare(request)
    print(f'[+] Celular conectado, alimentando "{DEVICE}"')
    try:
        ffmpeg_process = make_ffmpeg()
    except OSError as error:
        print(f'[!] Falha ao iniciar ffmpeg: "{error}"')
        await websocket.close(
            code=WSCloseCode.TRY_AGAIN_LATER,
            message=b"ffmpeg failed to start",
        )
        return websocket
    try:
        async for message in websocket:
            if message.type == WSMsgType.BINARY:
                if not write_frame(ffmpeg_process, message.data):
                    break
            elif message.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                break
    finally:
        print("[-] Celular desconectado, parando ffmpeg")
        stop_ffmpeg(ffmpeg_process)
    return websocket


def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/view.js", view_js)
    app.router.add_get("/ws", ws_handler)
    return app


def main() -> None:
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(os.path.join(HERE, "cert.pem"), os.path.join(HERE, "key.pem"))

    print("\n" + "=" * 50)
    print(f"  Abra no celular:  https://{local_ip_address()}:{PORT}")
    print(f"  Webcam virtual:   {DEVICE}  ({WIDTH}x{HEIGHT}@{FPS})")
    print("=" * 50 + "\n")
    web.run_app(build_app(), host="0.0.0.0", port=PORT, ssl_context=ssl_context, print=None)


if __name__ == "__main__":
    main()
