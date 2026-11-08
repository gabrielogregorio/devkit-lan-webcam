"""entropy.py: same second, same machine, still different bytes; and the .env secret is stable and private."""
import itertools
import os
import re
import stat
from pathlib import Path

import pytest

import entropy
import pairing
from conftest import PROJECT_ROOT

FROZEN_TIME_NS = 1_700_000_000_000_000_000
FROZEN_PID = 4242
SECRET_A = "a1" * 32
SECRET_B = "b2" * 32


def freeze_clock_and_process(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(entropy.time, "time_ns", lambda: FROZEN_TIME_NS)
    monkeypatch.setattr(entropy.os, "getpid", lambda: FROZEN_PID)


def start_install(monkeypatch: pytest.MonkeyPatch, env_path: Path, secret_hex: str) -> None:
    """A fresh process of an install with this .env: same counter, salt read again."""
    env_path.write_text(f"{entropy.ENV_VARIABLE}={secret_hex}\n")
    monkeypatch.setenv("LAN_WEBCAM_ENV_FILE", str(env_path))
    entropy.reset_for_tests()
    entropy._counter = itertools.count()


def test_the_same_instant_in_the_same_process_and_install_gives_different_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_clock_and_process(monkeypatch)

    first = entropy.random_bytes(32, "session x25519")
    entropy._counter = itertools.count()
    entropy.reset_for_tests()
    second = entropy.random_bytes(32, "session x25519")

    assert first != second, "a restart at the same nanosecond with the same pid still draws new bytes"


def test_with_a_broken_kernel_generator_two_installs_still_differ_by_their_env_secret(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    freeze_clock_and_process(monkeypatch)
    monkeypatch.setattr(entropy.os, "urandom", lambda length: bytes(length))
    monkeypatch.setattr(entropy, "_hardware_bytes", lambda: b"")

    start_install(monkeypatch, tmp_path / "a.env", SECRET_A)
    install_a = entropy.random_bytes(32, "pairing seed")
    start_install(monkeypatch, tmp_path / "b.env", SECRET_B)
    install_b = entropy.random_bytes(32, "pairing seed")
    start_install(monkeypatch, tmp_path / "a-again.env", SECRET_A)
    install_a_again = entropy.random_bytes(32, "pairing seed")

    assert install_a != install_b, "the .env secret alone separates two installs"
    assert install_a == install_a_again, "proof the kernel and clock were really frozen in this test"


def test_each_purpose_and_length_gets_its_own_bytes() -> None:
    assert entropy.random_bytes(32, "session nonce") != entropy.random_bytes(32, "session nonce")
    assert len(entropy.random_bytes(64, "spake2 scalar")) == 64
    assert len(entropy.random_bytes(1, "x")) == 1
    assert re.fullmatch(r"[0-9a-f]{32}", entropy.random_hex(16, "device id"))


def test_the_env_secret_is_created_once_with_mode_600_and_reused(tmp_path: Path) -> None:
    env_path = Path(os.environ["LAN_WEBCAM_ENV_FILE"])
    assert not env_path.exists()

    first = entropy.load_env_secret()
    content = env_path.read_text()
    second = entropy.load_env_secret()

    assert first == second
    assert f"{entropy.ENV_VARIABLE}={first.hex()}" in content
    assert stat.S_IMODE(env_path.stat().st_mode) == entropy.PRIVATE_FILE_MODE
    assert env_path.read_text() == content, "not rewritten on the second read"


def test_an_env_with_other_settings_and_an_empty_value_is_filled_and_keeps_the_rest() -> None:
    env_path = Path(os.environ["LAN_WEBCAM_ENV_FILE"])
    env_path.write_text(f"# mine\nOTHER=1\n{entropy.ENV_VARIABLE}=\n")

    secret = entropy.load_env_secret()

    lines = env_path.read_text().splitlines()
    assert lines[:2] == ["# mine", "OTHER=1"]
    assert lines[-1] == f"{entropy.ENV_VARIABLE}={secret.hex()}"
    assert len(secret) == entropy.SECRET_BYTES
    assert stat.S_IMODE(env_path.stat().st_mode) == entropy.PRIVATE_FILE_MODE


def test_a_broken_value_never_stops_the_server(capsys: pytest.CaptureFixture[str]) -> None:
    env_path = Path(os.environ["LAN_WEBCAM_ENV_FILE"])
    env_path.write_text(f"{entropy.ENV_VARIABLE}=not-hex\n")

    assert len(entropy.random_bytes(32, "session nonce")) == 32

    assert "using a temporary one" in capsys.readouterr().err
    assert env_path.read_text() == f"{entropy.ENV_VARIABLE}=not-hex\n", "the file is left for a person to fix"


def test_the_environment_variable_wins_over_the_file(monkeypatch: pytest.MonkeyPatch) -> None:
    Path(os.environ["LAN_WEBCAM_ENV_FILE"]).write_text(f"{entropy.ENV_VARIABLE}={SECRET_A}\n")
    monkeypatch.setenv(entropy.ENV_VARIABLE, SECRET_B)

    assert entropy.load_env_secret().hex() == SECRET_B


def test_the_banner_names_the_sources() -> None:
    sources = entropy.sources()

    assert sources[0].startswith("kernel CSPRNG")
    assert ".env secret" in sources


def test_seeds_and_device_credentials_come_from_entropy(monkeypatch: pytest.MonkeyPatch) -> None:
    purposes: list[str] = []
    real = entropy.random_bytes

    def recording(length: int, purpose: str) -> bytes:
        purposes.append(purpose)
        return real(length, purpose)

    monkeypatch.setattr(entropy, "random_bytes", recording)
    pairing.rotate_seed()
    pairing.add_device("192.168.0.9", "phone")

    assert purposes == ["pairing seed", "device id", "device secret"]


def test_no_other_module_draws_randomness_on_its_own() -> None:
    """Every key, seed and nonce of the PC goes through entropy.py, so none skips the .env secret."""
    offenders = []
    for name in sorted(os.listdir(PROJECT_ROOT)):
        if name.endswith(".py") and name != "entropy.py":
            source = Path(PROJECT_ROOT, name).read_text()
            if re.search(r"\bsecrets\.|urandom|\bimport random\b|token_bytes", source):
                offenders.append(name)

    assert offenders == []


def test_a_clone_of_the_repository_carries_no_secret() -> None:
    """Cloning the project, same venv, same date and time: the .env is not in git, so a clone draws its own."""
    gitignore = Path(PROJECT_ROOT, ".gitignore").read_text().splitlines()
    example = Path(PROJECT_ROOT, ".env.example").read_text()

    assert ".env" in gitignore
    assert re.search(rf"^{entropy.ENV_VARIABLE}=$", example, re.MULTILINE), ".env.example ships no value"


def test_two_fresh_clones_started_at_the_same_instant_get_different_secrets_and_bytes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    freeze_clock_and_process(monkeypatch)
    drawn = []
    for clone in ("clone-a", "clone-b"):
        monkeypatch.setenv("LAN_WEBCAM_ENV_FILE", str(tmp_path / clone / ".env"))
        (tmp_path / clone).mkdir()
        entropy.reset_for_tests()
        entropy._counter = itertools.count()
        drawn.append((entropy.load_env_secret(), entropy.random_bytes(32, "pairing seed")))

    assert drawn[0][0] != drawn[1][0], "each clone writes its own .env secret"
    assert drawn[0][1] != drawn[1][1]
