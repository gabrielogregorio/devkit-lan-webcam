"""
Pairing state on this PC: the seed of the rotating 6-digit code and the paired devices.

Standard library only: the top bar icon runs on the system python3 and reads the same files.

- The code is HOTP (RFC 4226) over a time window: it changes every PAIRING_CODE_PERIOD seconds and is
  never sent over the network; it only feeds the SPAKE2 pairing (crypto_channel.py).
- "Change code" writes a new seed: the current code stops working at once.
- Each paired device gets a random 256-bit secret, kept here (file mode 600) and on the device.
  "Unpair all" empties the list, so every device needs a new code.
"""
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
from datetime import UTC, datetime

CODE_DIGITS = 6
CODE_MODULO = 10**CODE_DIGITS
DEFAULT_PERIOD_SECONDS = 300
SEED_BYTES = 32
DEVICE_SECRET_BYTES = 32
DEVICE_ID_BYTES = 16
LABEL_MAX_LENGTH = 160
PRIVATE_FILE_MODE = 0o600
PRIVATE_DIRECTORY_MODE = 0o700
SEED_FILE = "pairing.json"
DEVICES_FILE = "devices.json"


def config_dir() -> str:
    default = os.path.join(os.path.expanduser("~"), ".config", "devkit-lan-webcam")
    return os.environ.get("LAN_WEBCAM_CONFIG_DIR", default)


def code_period_seconds() -> int:
    return int(os.environ.get("PAIRING_CODE_PERIOD", str(DEFAULT_PERIOD_SECONDS)))


def _path(name: str) -> str:
    return os.path.join(config_dir(), name)


def _write_private_json(name: str, payload: dict[str, object]) -> None:
    """Writes atomically with mode 600, so a crash never leaves a half file and nobody else can read it."""
    os.makedirs(config_dir(), mode=PRIVATE_DIRECTORY_MODE, exist_ok=True)
    target = _path(name)
    temporary = f"{target}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, PRIVATE_FILE_MODE)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(payload, handle)
    os.replace(temporary, target)


def _read_json(name: str) -> dict[str, object]:
    try:
        with open(_path(name)) as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def rotate_seed() -> bytes:
    seed = secrets.token_bytes(SEED_BYTES)
    _write_private_json(SEED_FILE, {"seed": seed.hex(), "created": _now_iso()})
    return seed


def load_seed() -> bytes:
    stored = _read_json(SEED_FILE).get("seed")
    if isinstance(stored, str):
        try:
            seed = bytes.fromhex(stored)
        except ValueError:
            seed = b""
        if len(seed) == SEED_BYTES:
            return seed
    return rotate_seed()


def seed_fingerprint(seed: bytes) -> str:
    return hashlib.sha256(seed).hexdigest()[:16]


def code_at(seed: bytes, counter: int) -> str:
    digest = hmac.new(seed, struct.pack(">Q", counter), hashlib.sha256).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % CODE_MODULO:0{CODE_DIGITS}d}"


def current_code(seed: bytes, now: float | None = None) -> tuple[str, int]:
    """The code on screen and how many seconds it still has."""
    moment = time.time() if now is None else now
    period = code_period_seconds()
    counter = int(moment // period)
    seconds_left = period - int(moment % period)
    return code_at(seed, counter), seconds_left


def accepted_codes(seed: bytes, now: float | None = None) -> list[str]:
    """The current code and the previous one, so a code typed right at the turn still works."""
    moment = time.time() if now is None else now
    counter = int(moment // code_period_seconds())
    return [code_at(seed, counter), code_at(seed, counter - 1)]


def load_devices() -> dict[str, dict[str, str]]:
    devices = _read_json(DEVICES_FILE).get("devices")
    if not isinstance(devices, dict):
        return {}
    return {
        device_id: entry
        for device_id, entry in devices.items()
        if isinstance(entry, dict) and isinstance(entry.get("secret"), str)
    }


def device_secret(device_id: str) -> bytes | None:
    entry = load_devices().get(device_id)
    if entry is None:
        return None
    try:
        secret = bytes.fromhex(entry["secret"])
    except ValueError:
        return None
    return secret if len(secret) == DEVICE_SECRET_BYTES else None


def add_device(ip: str, label: str) -> tuple[str, bytes]:
    device_id = secrets.token_hex(DEVICE_ID_BYTES)
    secret = secrets.token_bytes(DEVICE_SECRET_BYTES)
    devices = load_devices()
    devices[device_id] = {
        "secret": secret.hex(),
        "paired_at": _now_iso(),
        "ip": ip,
        "label": label[:LABEL_MAX_LENGTH],
    }
    _write_private_json(DEVICES_FILE, {"devices": devices})
    return device_id, secret


def clear_devices() -> None:
    _write_private_json(DEVICES_FILE, {"devices": {}})


def main() -> None:
    """`python3 pairing.py` prints the current code; `rotate` changes it; `unpair` forgets every device."""
    import sys

    command = sys.argv[1] if len(sys.argv) > 1 else "code"
    if command == "rotate":
        rotate_seed()
    elif command == "unpair":
        clear_devices()
        print("Every device was unpaired.")
        return
    elif command != "code":
        print("usage: pairing.py [code|rotate|unpair]")
        raise SystemExit(1)
    code, seconds_left = current_code(load_seed())
    print(f"Pairing code: {code[:3]} {code[3:]}  (changes in {seconds_left} s)")


if __name__ == "__main__":
    main()
