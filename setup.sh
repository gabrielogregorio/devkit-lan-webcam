#!/usr/bin/env bash
# Instala dependencias, carrega a webcam virtual e gera o certificado HTTPS.
set -e
cd "$(dirname "$0")"

echo ">> Instalando pacotes (precisa de sudo)…"
sudo apt update
sudo apt install -y v4l2loopback-dkms v4l-utils ffmpeg python3-pip openssl

echo ">> Criando o venv e instalando as dependências travadas…"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

echo ">> Carregando webcam virtual em /dev/video10…"
sudo modprobe -r v4l2loopback 2>/dev/null || true
sudo modprobe v4l2loopback video_nr=10 card_label="Phone Camera" exclusive_caps=1

if [ ! -f cert.pem ]; then
  echo ">> Gerando certificado HTTPS autoassinado…"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout key.pem -out cert.pem -days 365 -subj "/CN=phone-cam"
fi

echo ""
echo "Pronto! Rode:  ./run.sh"
