#!/usr/bin/env python3
"""
Starts the real server.py for the E2E with ffmpeg swapped for a `cat` that drops the
frames: real HTTP/TLS/WebSocket without touching /dev/video10.

Also exposes `GET /frames` -> {"frames": <n>} so the tests can check that the blobs
really reached the server. That replaces Playwright's `framesent` event, which does not
fire reliably in headless Chromium on CI.

Usage:  PORT=19443 .venv/bin/python tests/e2e/serve_mock.py
"""
import os
import subprocess
import sys

from aiohttp import web

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

import server  # noqa: E402

frames_received = 0

# Keep the originals BEFORE overriding them (avoids infinite recursion).
_original_write_frame = server.write_frame
_original_build_app = server.build_app


def make_discarding_ffmpeg() -> subprocess.Popen[bytes]:
    return subprocess.Popen(["cat"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)


def counting_write_frame(ffmpeg_process: subprocess.Popen[bytes], jpeg_frame: bytes) -> bool:
    global frames_received
    written = _original_write_frame(ffmpeg_process, jpeg_frame)
    if written:
        frames_received += 1
    return written


def build_app_with_counter() -> web.Application:
    app = _original_build_app()

    async def frames_handler(request: web.Request) -> web.Response:
        return web.json_response({"frames": frames_received})

    app.router.add_get("/frames", frames_handler)
    return app


server.make_ffmpeg = make_discarding_ffmpeg
server.write_frame = counting_write_frame
server.build_app = build_app_with_counter

if __name__ == "__main__":
    server.main()
