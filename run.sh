#!/usr/bin/env bash
# Launcher do app "Celular como Webcam".
#   ./run.sh          -> inicia o servidor (Ctrl+C para parar)
#   ./run.sh stop     -> para o servidor
#   ./run.sh status   -> mostra o estado
#   ./run.sh restart  -> reinicia
set -e
cd "$(dirname "$0")"

DEVICE="${CAM_DEVICE:-/dev/video10}"
PORT="${PORT:-9443}"
PY=".venv/bin/python"
RELOAD_BIN="/usr/local/sbin/webcam-cam-reload"  # wrapper root-only (ver reload-mod.sh)

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
local_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }

stop_server() {
  pkill -9 -f "[s]erver.py" 2>/dev/null || true
  pkill -9 -f "[m]jpeg -i pipe:0" 2>/dev/null || true
}

# Recarrega o v4l2loopback num estado limpo antes de cada subida, senão a 2a
# abertura do device falha (VIDIOC_G_FMT: Invalid argument). Sem senha graças
# ao sudoers; se não estiver configurado, apenas avisa e segue.
reload_module() {
  if [ -x "$RELOAD_BIN" ] && sudo -n "$RELOAD_BIN" 2>/dev/null; then
    color "36" "↻ v4l2loopback recarregado (estado limpo)."
    sleep 0.5
  else
    color "33" "↻ Auto-reload do módulo NÃO configurado — seguindo sem recarregar."
    color "33" "  Configure uma vez (ver reload-mod.sh):"
    color "33" "    sudo install -m755 -o root -g root $(pwd)/reload-mod.sh $RELOAD_BIN"
    color "33" "    echo '$(whoami) ALL=(root) NOPASSWD: $RELOAD_BIN' | sudo tee /etc/sudoers.d/webcam"
    color "33" "    sudo chmod 440 /etc/sudoers.d/webcam"
  fi
}

case "${1:-start}" in
  stop)
    stop_server
    color "33" "Servidor parado."
    exit 0
    ;;
  status)
    if pgrep -f "[s]erver.py" >/dev/null; then
      color "32" "● Servidor RODANDO  ->  https://$(local_ip):$PORT"
    else
      color "31" "○ Servidor parado"
    fi
    if [ -e "$DEVICE" ]; then
      EC=$(cat /sys/module/v4l2loopback/parameters/exclusive_caps 2>/dev/null | cut -d, -f1)
      color "36" "Webcam virtual: $DEVICE (exclusive_caps=$EC)"
    else
      color "31" "Webcam virtual AUSENTE ($DEVICE) — rode: sudo bash reload-cam.sh"
    fi
    exit 0
    ;;
  restart)
    stop_server; sleep 1
    ;;
  start) ;;
  *) echo "uso: $0 [start|stop|status|restart]"; exit 1 ;;
esac

# libera o device (mata servidor/ffmpeg antigos) e recarrega o módulo limpo
stop_server
sleep 0.3
reload_module

# --- pre-checagens ---
if [ ! -x "$PY" ]; then
  color "33" "venv ausente, criando…"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
fi

if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
  color "33" "Gerando certificado HTTPS…"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=phone-cam"
fi

if [ ! -e "$DEVICE" ]; then
  color "31" "✗ Webcam virtual $DEVICE não existe."
  color "33" "  Rode uma vez (pede senha):  sudo bash $(pwd)/reload-cam.sh"
  exit 1
fi

EC=$(cat /sys/module/v4l2loopback/parameters/exclusive_caps 2>/dev/null | cut -d, -f1)
if [ "$EC" != "Y" ]; then
  color "33" "⚠ exclusive_caps=$EC — apps podem não listar a câmera."
  color "33" "  Recomendado: sudo bash $(pwd)/reload-cam.sh"
fi

color "32" "================================================="
color "32" "  Abra no celular:  https://$(local_ip):$PORT"
color "32" "  Webcam no PC:     \"Phone Camera\" ($DEVICE)"
color "32" "  Ctrl+C para parar"
color "32" "================================================="

exec "$PY" server.py
