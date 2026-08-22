#!/usr/bin/env bash
# Recarrega o v4l2loopback com exclusive_caps=1 (necessario para Chrome/apps
# enxergarem a camera) e torna a config permanente.
# Rode com: sudo bash reload-cam.sh
set -e

echo ">> Liberando processos que seguram /dev/video10…"
fuser -k /dev/video10 2>/dev/null || true
sleep 1

echo ">> Descarregando modulo antigo…"
modprobe -r v4l2loopback 2>/dev/null || true

echo ">> Tornando config permanente (/etc/modprobe.d/v4l2loopback.conf)…"
echo 'options v4l2loopback video_nr=10 card_label="Phone Camera" exclusive_caps=1' \
  > /etc/modprobe.d/v4l2loopback.conf
echo 'v4l2loopback' > /etc/modules-load.d/v4l2loopback.conf

echo ">> Carregando modulo com exclusive_caps=1…"
modprobe v4l2loopback video_nr=10 card_label="Phone Camera" exclusive_caps=1

echo ""
echo "=== RESULTADO ==="
echo -n "exclusive_caps = "; cat /sys/module/v4l2loopback/parameters/exclusive_caps
ls -l /dev/video10
echo ""
echo "Se exclusive_caps começa com Y -> deu certo!"
