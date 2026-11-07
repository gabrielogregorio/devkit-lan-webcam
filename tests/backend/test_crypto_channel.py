import pytest

from crypto_channel import KIND_FRAME, KIND_JSON, HandshakeError, MessageCipher, decode_bytes, decode_point, hkdf

SEND_KEY = b"\x01" * 32
RECEIVE_KEY = b"\x02" * 32


def cipher_pair() -> tuple[MessageCipher, MessageCipher]:
    return MessageCipher(SEND_KEY, RECEIVE_KEY), MessageCipher(RECEIVE_KEY, SEND_KEY)


def test_hkdf_matches_rfc_5869_test_case_1() -> None:
    output = hkdf(bytes(range(13)), b"\x0b" * 22, bytes(range(0xF0, 0xFA)), 42)

    assert output.hex() == (
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
    )


def test_messages_round_trip_with_their_kind() -> None:
    sender, receiver = cipher_pair()

    assert receiver.decrypt(sender.encrypt(KIND_FRAME, b"jpeg")) == (KIND_FRAME, b"jpeg")
    assert receiver.decrypt(sender.encrypt_json({"type": "x"})) == (KIND_JSON, b'{"type": "x"}')


def test_the_ciphertext_does_not_contain_the_plaintext() -> None:
    sender, _receiver = cipher_pair()

    assert b"secret-frame" not in sender.encrypt(KIND_FRAME, b"secret-frame")


def test_a_replayed_message_is_refused() -> None:
    sender, receiver = cipher_pair()
    message = sender.encrypt(KIND_FRAME, b"jpeg")
    receiver.decrypt(message)

    with pytest.raises(HandshakeError, match="replayed"):
        receiver.decrypt(message)


def test_an_older_message_after_a_newer_one_is_refused() -> None:
    sender, receiver = cipher_pair()
    older = sender.encrypt(KIND_FRAME, b"one")
    newer = sender.encrypt(KIND_FRAME, b"two")
    receiver.decrypt(newer)

    with pytest.raises(HandshakeError, match="replayed"):
        receiver.decrypt(older)


def test_a_tampered_message_is_refused() -> None:
    sender, receiver = cipher_pair()
    message = bytearray(sender.encrypt(KIND_FRAME, b"jpeg"))
    message[-1] ^= 1

    with pytest.raises(HandshakeError, match="authentication"):
        receiver.decrypt(bytes(message))


def test_a_message_too_short_is_refused() -> None:
    _sender, receiver = cipher_pair()

    with pytest.raises(HandshakeError, match="short"):
        receiver.decrypt(b"\x00" * 8)


@pytest.mark.parametrize("value", [None, "zz", "00" * 31, "00" * 32])
def test_invalid_points_are_refused(value: object) -> None:
    with pytest.raises(HandshakeError):
        decode_point(value)


def test_decode_bytes_checks_type_hex_and_length() -> None:
    assert decode_bytes("ab" * 16, 16) == b"\xab" * 16
    for value in (7, "zz", "ab"):
        with pytest.raises(HandshakeError):
            decode_bytes(value, 16)
