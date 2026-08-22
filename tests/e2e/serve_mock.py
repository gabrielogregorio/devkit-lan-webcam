#!/usr/bin/env python3
"""
Sobe o server.py real para o E2E com o ffmpeg trocado por um `cat` que descarta
os frames: exercita HTTP/TLS/WebSocket de verdade sem encostar no /dev/video10.

Uso:  PORT=19443 .venv/bin/python tests/e2e/serve_mock.py
"""
import os
import subprocess
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

import server


def make_discarding_ffmpeg() -> subprocess.Popen[bytes]:
    return subprocess.Popen(["cat"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)


server.make_ffmpeg = make_discarding_ffmpeg

if __name__ == "__main__":
    server.main()
