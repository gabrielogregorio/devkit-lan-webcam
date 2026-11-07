"""pytest plugin that turns the message encryption off, to prove the break tests notice.

    PYTHONPATH=.:tests/backend .venv/bin/python -m pytest -p plugin_without_encryption tests/backend/test_wire_tap.py

Every break test that guards the encryption must fail with it. run-tests.sh runs this and fails if they pass.
Never loaded by a normal run: pytest only picks it up with -p.
"""
import struct

import crypto_channel


def encrypt_nothing(self: crypto_channel.MessageCipher, kind: int, payload: bytes) -> bytes:
    header = struct.pack(">Q", self._send_counter)
    self._send_counter += 1
    return header + bytes([kind]) + payload


def decrypt_nothing(self: crypto_channel.MessageCipher, message: bytes) -> tuple[int, bytes]:
    return message[crypto_channel.COUNTER_BYTES], message[crypto_channel.COUNTER_BYTES + 1:]


crypto_channel.MessageCipher.encrypt = encrypt_nothing  # type: ignore[method-assign]
crypto_channel.MessageCipher.decrypt = decrypt_nothing  # type: ignore[method-assign]
