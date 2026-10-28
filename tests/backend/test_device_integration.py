import os
import stat

import pytest

DEVICE = os.environ.get("CAM_DEVICE", "/dev/video10")

# Opt-in: touching the real device gets in the way of normal use and of `modprobe -r`.
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DEVICE_TESTS") != "1",
    reason="opt-in device test: set RUN_DEVICE_TESTS=1 to run it",
)


def test_device_exists_and_is_char_device() -> None:
    if not os.path.exists(DEVICE):
        pytest.skip(f'"{DEVICE}" missing, run "sudo bash reload-cam.sh"')
    device_stat = os.stat(DEVICE)
    assert stat.S_ISCHR(device_stat.st_mode), f'"{DEVICE}" should be a char device'


def test_device_readable_writable() -> None:
    if not os.path.exists(DEVICE):
        pytest.skip(f'"{DEVICE}" missing')
    assert os.access(DEVICE, os.R_OK), f'"{DEVICE}" is not readable by the user'
    assert os.access(DEVICE, os.W_OK), f'"{DEVICE}" is not writable by the user'
