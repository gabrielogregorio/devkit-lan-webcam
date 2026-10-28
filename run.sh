#!/usr/bin/env bash
# LAN Webcam launcher.
#   ./run.sh          -> starts the server (Ctrl+C stops it)
#   ./run.sh stop     -> stops the server
#   ./run.sh status   -> shows the state
#   ./run.sh restart  -> restarts
set -e
cd "$(dirname "$0")"

DEVICE="${CAM_DEVICE:-/dev/video10}"
PORT="${PORT:-9443}"
PY=".venv/bin/python"
RELOAD_BIN="/usr/local/sbin/webcam-cam-reload"  # root-only wrapper (see reload-mod.sh)

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
local_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }

stop_server() {
  pkill -9 -f "python [s]erver[.]py" 2>/dev/null || true
  pkill -9 -f "[m]jpeg -i pipe:0" 2>/dev/null || true
}

# Reloads v4l2loopback in a clean state before every start, or the 2nd opening of
# the device fails (VIDIOC_G_FMT: Invalid argument). No password thanks to sudoers;
# when that is not set up it only warns and goes on.
reload_module() {
  if [ -x "$RELOAD_BIN" ] && sudo -n "$RELOAD_BIN" 2>/dev/null; then
    color "36" "↻ v4l2loopback reloaded (clean state)."
    sleep 0.5
  else
    color "33" "↻ Module auto-reload is NOT set up - going on without reloading."
    color "33" "  Set it up once (see reload-mod.sh):"
    color "33" "    sudo install -m755 -o root -g root $(pwd)/reload-mod.sh $RELOAD_BIN"
    color "33" "    echo '$(whoami) ALL=(root) NOPASSWD: $RELOAD_BIN' | sudo tee /etc/sudoers.d/webcam"
    color "33" "    sudo chmod 440 /etc/sudoers.d/webcam"
  fi
}

case "${1:-start}" in
  stop)
    stop_server
    color "33" "Server stopped."
    exit 0
    ;;
  status)
    if pgrep -f "python [s]erver[.]py" >/dev/null; then
      color "32" "● Server RUNNING  ->  https://$(local_ip):$PORT"
    else
      color "31" "○ Server stopped"
    fi
    if [ -e "$DEVICE" ]; then
      EC=$(cat /sys/module/v4l2loopback/parameters/exclusive_caps 2>/dev/null | cut -d, -f1)
      color "36" "Virtual webcam: $DEVICE (exclusive_caps=$EC)"
    else
      color "31" "Virtual webcam MISSING ($DEVICE) - run: sudo bash reload-cam.sh"
    fi
    exit 0
    ;;
  restart)
    stop_server; sleep 1
    ;;
  start) ;;
  *) echo "usage: $0 [start|stop|status|restart]"; exit 1 ;;
esac

# frees the device (kills old server/ffmpeg) and reloads the module clean
stop_server
sleep 0.3
reload_module

# --- pre-checks ---
if [ ! -x "$PY" ]; then
  color "33" "venv missing, creating it…"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
fi

if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
  color "33" "Generating the HTTPS certificate…"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=lan-webcam"
fi

if [ ! -e "$DEVICE" ]; then
  color "31" "✗ Virtual webcam $DEVICE does not exist."
  color "33" "  Run once (asks for the password):  sudo bash $(pwd)/reload-cam.sh"
  exit 1
fi

EC=$(cat /sys/module/v4l2loopback/parameters/exclusive_caps 2>/dev/null | cut -d, -f1)
if [ "$EC" != "Y" ]; then
  color "33" "⚠ exclusive_caps=$EC - apps may not list the camera."
  color "33" "  Recommended: sudo bash $(pwd)/reload-cam.sh"
fi

color "32" "================================================="
color "32" "  Open on the camera device:  https://$(local_ip):$PORT"
color "32" "  Webcam on this PC:          \"LAN Webcam\" ($DEVICE)"
color "32" "  Ctrl+C to stop"
color "32" "================================================="

exec "$PY" server.py
