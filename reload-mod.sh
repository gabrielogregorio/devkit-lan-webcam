#!/usr/bin/env bash
# Recarrega o v4l2loopback num estado LIMPO.
#
# Por que existe: com exclusive_caps=1, o v4l2loopback (versão da distro) deixa
# o /dev/video10 num estado quebrado depois que o 1º produtor (ffmpeg) fecha —
# a 2ª abertura falha com "VIDIOC_G_FMT: Invalid argument". Recarregar o módulo
# a cada subida do servidor evita isso. Chamado pelo run.sh via `sudo -n`.
#
# Instalar (uma vez, root):
#   sudo install -m755 -o root -g root reload-mod.sh /usr/local/sbin/webcam-cam-reload
#   echo 'greg ALL=(root) NOPASSWD: /usr/local/sbin/webcam-cam-reload' | sudo tee /etc/sudoers.d/webcam
#   sudo chmod 440 /etc/sudoers.d/webcam
set -e
fuser -k /dev/video10 2>/dev/null || true
modprobe -r v4l2loopback 2>/dev/null || true
modprobe v4l2loopback video_nr=10 card_label="Phone Camera" exclusive_caps=1
