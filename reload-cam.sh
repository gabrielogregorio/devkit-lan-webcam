#!/usr/bin/env bash
# Reloads v4l2loopback with exclusive_caps=1 (Chrome and other apps need it to see
# the camera) and makes the setting permanent.
# Run with: sudo bash reload-cam.sh
set -e

echo ">> Freeing processes that hold /dev/video10…"
fuser -k /dev/video10 2>/dev/null || true
sleep 1

echo ">> Unloading the old module…"
modprobe -r v4l2loopback 2>/dev/null || true

echo ">> Making the setting permanent (/etc/modprobe.d/v4l2loopback.conf)…"
echo 'options v4l2loopback video_nr=10 card_label="LAN Webcam" exclusive_caps=1' \
  > /etc/modprobe.d/v4l2loopback.conf
echo 'v4l2loopback' > /etc/modules-load.d/v4l2loopback.conf

echo ">> Loading the module with exclusive_caps=1…"
modprobe v4l2loopback video_nr=10 card_label="LAN Webcam" exclusive_caps=1

echo ""
echo "=== RESULT ==="
echo -n "exclusive_caps = "; cat /sys/module/v4l2loopback/parameters/exclusive_caps
ls -l /dev/video10
echo ""
echo "If exclusive_caps starts with Y it worked."
