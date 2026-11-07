#!/usr/bin/env bash
# Installs the dependencies, builds the web app, loads the virtual webcam and generates the HTTPS certificate.
set -e
cd "$(dirname "$0")"

echo ">> Installing packages (needs sudo)…"
sudo apt update
sudo apt install -y v4l2loopback-dkms v4l-utils ffmpeg python3-venv python3-pip openssl psmisc

echo ">> Creating the venv and installing the locked dependencies…"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

echo ">> Building the web app (Node 24 + pnpm)…"
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  set +e
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install 24 && nvm use 24
  set -e
fi
if command -v corepack >/dev/null 2>&1; then
  corepack pnpm install --frozen-lockfile
  corepack pnpm run build
else
  echo "   Node 24 not found: install nvm (https://github.com/nvm-sh/nvm), then run ./setup.sh again."
  echo "   ./run.sh also builds the web app on its first start once Node 24 is there."
fi

echo ">> Loading the virtual webcam on /dev/video10…"
sudo modprobe -r v4l2loopback 2>/dev/null || true
sudo modprobe v4l2loopback video_nr=10 card_label="LAN Webcam" exclusive_caps=1

if [ ! -f cert.pem ]; then
  echo ">> Generating a self-signed HTTPS certificate…"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout key.pem -out cert.pem -days 365 -subj "/CN=lan-webcam"
fi

echo ""
echo "Done. Run:  ./run.sh"
