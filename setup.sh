#!/usr/bin/env bash
# Installs the dependencies, loads the virtual webcam and generates the HTTPS certificate.
set -e
cd "$(dirname "$0")"

echo ">> Installing packages (needs sudo)…"
sudo apt update
sudo apt install -y v4l2loopback-dkms v4l-utils ffmpeg python3-venv python3-pip openssl psmisc

echo ">> Creating the venv and installing the locked dependencies…"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

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
