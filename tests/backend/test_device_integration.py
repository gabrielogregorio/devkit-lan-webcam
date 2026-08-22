import os
import stat

import pytest

DEVICE = os.environ.get("CAM_DEVICE", "/dev/video10")

# Opt-in: encostar no device real atrapalha o uso normal e o `modprobe -r`.
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DEVICE_TESTS") != "1",
    reason="device test opt-in: defina RUN_DEVICE_TESTS=1 para rodar",
)


def test_device_exists_and_is_char_device() -> None:
    if not os.path.exists(DEVICE):
        pytest.skip(f'"{DEVICE}" ausente, rode "sudo bash reload-cam.sh"')
    device_stat = os.stat(DEVICE)
    assert stat.S_ISCHR(device_stat.st_mode), f'"{DEVICE}" deveria ser um char device'


def test_device_readable_writable() -> None:
    if not os.path.exists(DEVICE):
        pytest.skip(f'"{DEVICE}" ausente')
    assert os.access(DEVICE, os.R_OK), f'"{DEVICE}" não é legível pelo usuário'
    assert os.access(DEVICE, os.W_OK), f'"{DEVICE}" não é gravável pelo usuário'
