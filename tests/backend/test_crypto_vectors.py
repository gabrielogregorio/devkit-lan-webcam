import json

from crypto_vectors import VECTORS_PATH, build_vectors


def test_the_browser_vectors_match_the_server_crypto() -> None:
    with open(VECTORS_PATH) as handle:
        stored = json.load(handle)

    assert stored == build_vectors(), "run: .venv/bin/python tests/backend/crypto_vectors.py"
