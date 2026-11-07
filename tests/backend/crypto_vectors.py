"""
Fixed-input vectors from the server's real crypto (crypto_channel.py), for the browser's tests.

    .venv/bin/python tests/backend/crypto_vectors.py   rewrites web/src/lib/crypto/vectors.json

test_crypto_vectors.py fails when the file no longer matches what the Python side computes, and
web/src/lib/crypto/*.test.ts check the browser's side against the same file.
"""
import hashlib
import json
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)

from nacl import bindings as sodium  # noqa: E402
from secure_client import spake2_client_tags  # noqa: E402

import crypto_channel  # noqa: E402
from crypto_channel import KIND_FRAME, MessageCipher, mac, seal, server_hello, spake2_server  # noqa: E402

VECTORS_PATH = os.path.join(ROOT, "web", "src", "lib", "crypto", "vectors.json")
CODE = "123456"
OTHER_CODE = "654321"
CLIENT_SCALAR_SOURCE = bytes(range(64))
CREDENTIAL = {"id": "ab" * 16, "secret": "cd" * 32}
DEVICE_SECRET = bytes.fromhex("ef" * 32)
CLIENT_PRIVATE = bytes(range(32))
CLIENT_NONCE = bytes(range(32, 48))
SERVER_PRIVATE = bytes(range(64, 96))
SERVER_NONCE = bytes(range(96, 112))
SEAL_NONCE = bytes(range(200, 224))


@contextmanager
def fixed_random(chunks: list[bytes]) -> Iterator[None]:
    pending = iter(chunks)
    with mock.patch("crypto_channel.entropy.random_bytes", side_effect=lambda _length, _purpose: next(pending)):
        yield


def pairing_vectors() -> dict[str, object]:
    client_secret = sodium.crypto_core_ed25519_scalar_reduce(CLIENT_SCALAR_SOURCE)
    password_scalar = crypto_channel.scalar_from_code(CODE)
    client_share = sodium.crypto_core_ed25519_add(
        sodium.crypto_scalarmult_ed25519_base_noclamp(client_secret),
        sodium.crypto_scalarmult_ed25519_noclamp(password_scalar, crypto_channel.POINT_M),
    )
    server_scalars = iter(
        sodium.crypto_core_ed25519_scalar_reduce(hashlib.sha512(f"server-{index}".encode()).digest())
        for index in range(2)
    )
    with mock.patch("crypto_channel.random_scalar", side_effect=lambda: next(server_scalars)):
        candidates = [spake2_server(client_share, code) for code in (CODE, OTHER_CODE)]
    client_tags = [
        spake2_client_tags(client_secret, password_scalar, client_share, candidate.share)[0] for candidate in candidates
    ]
    with fixed_random([SEAL_NONCE]):
        sealed = seal(candidates[0].encryption_key, json.dumps(CREDENTIAL).encode())
    return {
        "code": CODE,
        "clientScalarSource": CLIENT_SCALAR_SOURCE.hex(),
        "clientShare": client_share.hex(),
        "serverShares": [candidate.share.hex() for candidate in candidates],
        "clientTags": [tag.hex() for tag in client_tags],
        "serverConfirm": mac(candidates[0].server_confirm_key, candidates[0].transcript).hex(),
        "sealedCredential": sealed.hex(),
        "credential": CREDENTIAL,
    }


def session_vectors() -> dict[str, object]:
    client_public = sodium.crypto_scalarmult_base(CLIENT_PRIVATE)
    with fixed_random([SERVER_PRIVATE, SERVER_NONCE]):
        hello = server_hello(CREDENTIAL["id"], DEVICE_SECRET, client_public, CLIENT_NONCE)
    keys = hello.keys
    to_client = MessageCipher(keys.server_to_client, keys.client_to_server)
    from_client = MessageCipher(keys.client_to_server, keys.server_to_client)
    return {
        "deviceId": CREDENTIAL["id"],
        "deviceSecret": DEVICE_SECRET.hex(),
        "clientPrivate": CLIENT_PRIVATE.hex(),
        "clientNonce": CLIENT_NONCE.hex(),
        "clientPublic": client_public.hex(),
        "welcome": hello.reply,
        "readyConfirm": mac(keys.client_confirm, keys.transcript).hex(),
        "serverMessage": to_client.encrypt_json({"type": "status", "camera": True}).hex(),
        "clientFrame": from_client.encrypt(KIND_FRAME, b"jpeg").hex(),
    }


def build_vectors() -> dict[str, object]:
    return {"pairing": pairing_vectors(), "session": session_vectors()}


if __name__ == "__main__":
    with open(VECTORS_PATH, "w") as handle:
        json.dump(build_vectors(), handle, indent=2)
        handle.write("\n")
    print(f"written: {VECTORS_PATH}")
