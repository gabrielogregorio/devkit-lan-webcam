import os
import stat

import pytest
from aiohttp.test_utils import TestClient
from secure_client import open_page, pair

import pairing
from conftest import current_code
from handshake import IP_FAILURE_LIMIT, IP_FAILURE_WINDOW_SECONDS, TOTAL_FAILURE_LIMIT, PairingGuard

FIXED_NOW = 1_800_000_000.0
LOCAL_IP = "127.0.0.1"


def wrong_code() -> str:
    code = current_code()
    previous = pairing.accepted_codes(pairing.load_seed())[1]
    for candidate in ("000000", "111111", "222222"):
        if candidate not in (code, previous):
            return candidate
    raise AssertionError("no wrong code available")


async def test_the_code_on_screen_pairs_and_the_credential_opens_a_session(client: TestClient) -> None:
    result = await pair(client, current_code())

    assert result.outcome == "paired"
    assert result.credential is not None
    page = await open_page(client, result.credential)
    assert (await page.next_json("status"))["access"] == "none"
    await page.close()


async def test_the_previous_code_still_pairs(client: TestClient) -> None:
    previous = pairing.accepted_codes(pairing.load_seed())[1]

    result = await pair(client, previous)

    assert result.outcome == "paired"


async def test_a_wrong_code_does_not_pair(client: TestClient) -> None:
    result = await pair(client, wrong_code())

    assert result.outcome == "wrong-code"
    assert result.credential is None
    assert pairing.load_devices() == {}


async def test_too_many_wrong_codes_block_the_ip(client: TestClient) -> None:
    for _attempt in range(IP_FAILURE_LIMIT):
        assert (await pair(client, wrong_code())).outcome == "wrong-code"

    blocked = await pair(client, current_code())

    assert blocked.outcome == "blocked"
    assert 0 < blocked.reply["retryIn"] <= IP_FAILURE_WINDOW_SECONDS + 1


async def test_changing_the_code_kills_the_old_one(client: TestClient) -> None:
    old_code = current_code()
    pairing.rotate_seed()

    assert old_code != current_code() or pairing.accepted_codes(pairing.load_seed())[1] != old_code
    result = await pair(client, current_code())
    assert result.outcome == "paired"


async def test_unpairing_every_device_closes_their_next_session(client: TestClient) -> None:
    result = await pair(client, current_code())
    pairing.clear_devices()

    with pytest.raises(PermissionError, match="unpaired"):
        await open_page(client, result.credential)


def test_guard_blocks_an_ip_after_the_limit_and_frees_it_after_the_window() -> None:
    guard = PairingGuard()
    seed = b"s" * 32
    for _attempt in range(IP_FAILURE_LIMIT - 1):
        guard.record_failure(LOCAL_IP, seed, FIXED_NOW)

    assert guard.seconds_blocked(LOCAL_IP, FIXED_NOW) == 0

    guard.record_failure(LOCAL_IP, seed, FIXED_NOW)

    assert guard.seconds_blocked(LOCAL_IP, FIXED_NOW) == IP_FAILURE_WINDOW_SECONDS + 1
    assert guard.seconds_blocked("192.168.0.77", FIXED_NOW) == 0
    assert guard.seconds_blocked(LOCAL_IP, FIXED_NOW + IP_FAILURE_WINDOW_SECONDS) == 0


def test_guard_locks_pairing_after_the_total_limit_until_the_seed_changes() -> None:
    guard = PairingGuard()
    seed = b"s" * 32
    for attempt in range(TOTAL_FAILURE_LIMIT - 1):
        guard.record_failure(f"192.168.0.{attempt}", seed, FIXED_NOW)

    assert guard.locked(seed) is False

    guard.record_failure("192.168.0.200", seed, FIXED_NOW)

    assert guard.locked(seed) is True
    assert guard.locked(b"n" * 32) is False


async def test_a_locked_pairing_answers_locked(client: TestClient, server_module) -> None:
    seed = pairing.load_seed()
    guard = client.server.app[server_module.PAIRING_GUARD_KEY]
    for attempt in range(TOTAL_FAILURE_LIMIT):
        guard.record_failure(f"10.0.0.{attempt}", seed, FIXED_NOW)

    assert (await pair(client, current_code())).outcome == "locked"


def test_the_code_has_six_digits_and_changes_with_the_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAIRING_CODE_PERIOD", "300")
    seed = b"k" * 32

    code, seconds_left = pairing.current_code(seed, FIXED_NOW)

    assert code == "095618"
    assert seconds_left == 300 - int(FIXED_NOW % 300)
    assert pairing.accepted_codes(seed, FIXED_NOW) == ["095618", "472477"]
    assert pairing.current_code(seed, FIXED_NOW - 300)[0] == "472477"


def test_pairing_files_are_private(private_config_dir) -> None:
    pairing.load_seed()
    pairing.add_device(LOCAL_IP, "label")

    for name in (pairing.SEED_FILE, pairing.DEVICES_FILE):
        mode = stat.S_IMODE(os.stat(private_config_dir / name).st_mode)
        assert mode == 0o600, name
    assert stat.S_IMODE(os.stat(private_config_dir).st_mode) == 0o700


def test_a_damaged_seed_file_is_replaced(private_config_dir) -> None:
    private_config_dir.mkdir(parents=True, exist_ok=True)
    (private_config_dir / pairing.SEED_FILE).write_text('{"seed": "not hex"}')

    assert len(pairing.load_seed()) == pairing.SEED_BYTES


def test_device_secret_reads_back_and_ignores_unknown_ids() -> None:
    device_id, secret = pairing.add_device(LOCAL_IP, "x" * 500)

    assert pairing.device_secret(device_id) == secret
    assert pairing.device_secret("f" * 32) is None
    assert len(pairing.load_devices()[device_id]["label"]) == pairing.LABEL_MAX_LENGTH
