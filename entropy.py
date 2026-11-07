"""Every random byte the PC uses for keys, seeds and nonces comes from here (standard library only).

Sources, mixed with HKDF-SHA256 on every call:

1. The kernel's CSPRNG (os.urandom / getrandom), which Linux feeds with the CPU's hardware generator
   (RDRAND/RDSEED when the CPU has them), interrupt timing and CPU jitter.
2. /dev/hwrng, the hardware generator device, when this process may read it (usually root only).
3. A secret of this install, kept in .env (LAN_WEBCAM_ENTROPY_SECRET, mode 600, never in git), created
   on the first run. Two installs started in the same second, even with a broken kernel generator,
   still draw different bytes.
4. The time in nanoseconds, the process id and a counter: not secret, only to never repeat an input.

The .env secret only salts fresh randomness; no stored key is derived from it. Changing or losing it
breaks nothing: paired devices and the pairing seed keep working.
"""
import hashlib
import hmac
import itertools
import os
import secrets
import struct
import sys
import threading
import time

ENV_VARIABLE = "LAN_WEBCAM_ENTROPY_SECRET"
SECRET_BYTES = 32
KERNEL_BYTES = 64
HARDWARE_BYTES = 32
HARDWARE_DEVICE = "/dev/hwrng"
PRIVATE_FILE_MODE = 0o600
WAIT_TRIES = 20
WAIT_SECONDS = 0.05
HASH_BYTES = hashlib.sha256().digest_size

_lock = threading.Lock()
_counter = itertools.count()
_process_salt: bytes | None = None
_sources: list[str] = []


def env_file() -> str:
    default = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    return os.environ.get("LAN_WEBCAM_ENV_FILE", default)


def _parse_secret(text: str) -> bytes | None:
    if len(text) != 2 * SECRET_BYTES:
        return None
    try:
        return bytes.fromhex(text)
    except ValueError:
        return None


def _read_env_secret(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as env:
            for line in env:
                name, _, value = line.strip().partition("=")
                if name.strip() == ENV_VARIABLE:
                    return value.strip().strip("\"'")
    except FileNotFoundError:
        return None
    return None


def _create_env_secret(path: str) -> bytes:
    """Writes a new secret with mode 600; if another process got there first, uses its secret."""
    secret = secrets.token_bytes(SECRET_BYTES)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE_MODE)
    except FileExistsError:
        # Another process (server or top bar icon) is writing it right now: wait for its line.
        for _ in range(WAIT_TRIES):
            stored = _parse_secret(_read_env_secret(path) or "")
            if stored is not None:
                return stored
            time.sleep(WAIT_SECONDS)
        return secret
    with os.fdopen(descriptor, "w", encoding="utf-8") as env:
        env.write("# LAN Webcam: secret of this install, mixed into every random byte (entropy.py).\n")
        env.write("# Keep it private and out of git. Delete this file to get a new one.\n")
        env.write(f"{ENV_VARIABLE}={secret.hex()}\n")
    return secret


def _fill_env_secret(path: str) -> bytes:
    """A .env without our value (other settings, or a copy of .env.example): add it, keep the rest."""
    secret = secrets.token_bytes(SECRET_BYTES)
    with open(path, encoding="utf-8") as env:
        lines = [line for line in env.read().splitlines() if line.partition("=")[0].strip() != ENV_VARIABLE]
    lines.append(f"{ENV_VARIABLE}={secret.hex()}")
    temporary = f"{path}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, PRIVATE_FILE_MODE)
    with os.fdopen(descriptor, "w", encoding="utf-8") as env:
        env.write("\n".join(lines) + "\n")
    os.replace(temporary, path)
    return secret


def load_env_secret() -> bytes:
    """The install secret: from the environment, else from .env, else a new .env."""
    from_environment = os.environ.get(ENV_VARIABLE)
    if from_environment is not None:
        secret = _parse_secret(from_environment)
        if secret is not None:
            return secret
        print(f"[!] {ENV_VARIABLE} is not {2 * SECRET_BYTES} hex digits: ignored", file=sys.stderr)
    path = env_file()
    stored = _read_env_secret(path)
    if not stored:
        if os.path.exists(path):
            return _fill_env_secret(path)
        return _create_env_secret(path)
    secret = _parse_secret(stored)
    if secret is None:
        # Stable over strict: a broken line never stops the webcam; this process uses a fresh secret.
        print(f"[!] {ENV_VARIABLE} in {path} is not {2 * SECRET_BYTES} hex digits: using a temporary one",
              file=sys.stderr)
        return secrets.token_bytes(SECRET_BYTES)
    return secret


def _hardware_bytes() -> bytes:
    if not os.access(HARDWARE_DEVICE, os.R_OK):
        return b""
    try:
        with open(HARDWARE_DEVICE, "rb", buffering=0) as device:
            return device.read(HARDWARE_BYTES)
    except OSError:
        return b""


def _salt() -> bytes:
    """Read once per process: the install secret plus the hardware generator, when readable."""
    global _process_salt
    with _lock:
        if _process_salt is None:
            hardware = _hardware_bytes()
            _sources[:] = ["kernel CSPRNG" + (" (CPU RDRAND/RDSEED)" if _cpu_has_rdrand() else ""), ".env secret"]
            if hardware:
                _sources.append(HARDWARE_DEVICE)
            _process_salt = hmac.new(load_env_secret(), hardware + os.urandom(KERNEL_BYTES), hashlib.sha256).digest()
        return _process_salt


def _cpu_has_rdrand() -> bool:
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as cpuinfo:
            return " rdrand" in cpuinfo.read()
    except OSError:
        return False


def random_bytes(length: int, purpose: str) -> bytes:
    """`length` random bytes for `purpose` (a label such as "session nonce"), from every source above."""
    unique = struct.pack(">QQQ", time.time_ns(), os.getpid(), next(_counter))
    key = hmac.new(_salt(), os.urandom(KERNEL_BYTES), hashlib.sha256).digest()
    info = purpose.encode() + unique
    output = b""
    block = b""
    for index in range(1, -(-length // HASH_BYTES) + 1):
        block = hmac.new(key, block + info + bytes([index]), hashlib.sha256).digest()
        output += block
    return output[:length]


def random_hex(length: int, purpose: str) -> str:
    return random_bytes(length, purpose).hex()


def sources() -> list[str]:
    """What feeds random_bytes in this process, for the start banner."""
    _salt()
    return list(_sources)


def reset_for_tests() -> None:
    global _process_salt
    with _lock:
        _process_salt = None
