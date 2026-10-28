#!/usr/bin/env bash
# Reloads v4l2loopback in a CLEAN state.
#
# Why it exists: with exclusive_caps=1, v4l2loopback (the distro version) leaves
# /dev/video10 broken after the 1st producer (ffmpeg) closes - the 2nd opening
# fails with "VIDIOC_G_FMT: Invalid argument". Reloading the module on every server
# start avoids that. Called by run.sh through `sudo -n`.
#
# Install (once, as root):
#   sudo install -m755 -o root -g root reload-mod.sh /usr/local/sbin/webcam-cam-reload
#   echo "$(whoami) ALL=(root) NOPASSWD: /usr/local/sbin/webcam-cam-reload" | sudo tee /etc/sudoers.d/webcam
#   sudo chmod 440 /etc/sudoers.d/webcam
set -e
fuser -k /dev/video10 2>/dev/null || true
modprobe -r v4l2loopback 2>/dev/null || true
modprobe v4l2loopback video_nr=10 card_label="LAN Webcam" exclusive_caps=1
