# Security

How the LAN Webcam keeps the picture private on the local network, what someone on that network can
still see, and the tests that try to break it.

The short version: **someone who records the traffic sees no picture, no app message and no secret**,
also over plain HTTP. Someone who can *change* the traffic of a plain-HTTP page can change the page
itself, and no encryption inside the page fixes that. Use HTTPS with the right certificate on a
network you do not trust.

## Threat model

| Who | Can | Protected? |
|---|---|---|
| **Passive eavesdropper** on the LAN (Wi-Fi sniffing, a mirrored switch port, a compromised router that only records) | read every byte, keep recordings | **Yes.** Frames and control messages are encrypted; the pairing code never travels; recordings do not decrypt later |
| **Active attacker** on the WebSocket (drops, changes, replays or injects bytes) | change the encrypted stream | **Yes.** Any change ends the session; replays and injected messages are refused; a recorded session played back gets nothing |
| **Code guesser** (anyone who reaches the PC) | try pairing codes | **Yes.** One guess per attempt, 5 per IP per 10 minutes, 10 in total until the code changes, a new code every 5 minutes |
| **Active attacker on the page** (plain HTTP on 9080, or a self-signed certificate accepted blindly) | serve a changed HTML/JavaScript | **No.** The changed page runs with the device's credential and sees the decrypted picture |
| **Someone with the device** (or a script running in the page's origin) | read `localStorage` | **No.** The device credential is there; **Unpair all devices** revokes it |
| **The PC itself** | decrypt | **By design.** It feeds the frames to `/dev/video10`, which any local program can read |

## What crosses the wire

| Message | Readable by an eavesdropper | Content |
|---|---|---|
| Pairing (`/ws/pair`): `pair`, `challenge`, `confirm`, `paired` | yes, JSON | SPAKE2 shares and tags (public points and MACs), and the device credential **sealed** with the SPAKE2 key. Not the code, not the secret |
| Session handshake (`/ws/session`): `hello`, `welcome`, `ready` | yes, JSON | the **device id** (a random 128-bit name, not a secret), ephemeral X25519 public keys, nonces and the key proofs |
| Everything after the handshake | **no**, binary | 8-byte message counter + XChaCha20-Poly1305 ciphertext of the kind byte and the payload: frames, `camera-start`, watch requests and their keys, decisions, status, the network panel |

Also visible, as on any network: **IP addresses, when a page connects, and the size and timing of
messages**. From that, someone can tell that a camera is streaming, roughly at what frame rate, and
when the scene changes a lot (bigger JPEGs). Not what the picture shows.

The WebSocket compression (permessage-deflate) is not secrecy: the tests inflate it and check the
payload as the encryption left it.

## The design in five lines

1. **Pairing:** SPAKE2 (RFC 9382) over edwards25519, password = the 6-digit code. Each attempt tests
   one guess; a recording cannot test codes offline.
2. **Credential:** a successful pairing hands the device a random 256-bit secret, sealed with the SPAKE2
   key. The code is used once; it never becomes a key.
3. **Session:** every connection does a fresh X25519 exchange and mixes it with the device secret
   through HKDF-SHA256 into one key per direction. Both sides prove the keys before anything else.
   A leaked device secret does not open old recordings (forward secrecy).
4. **Messages:** XChaCha20-Poly1305, nonce = the message counter. Altered, reordered or replayed
   messages are refused and end the session.
5. **Who watches:** only requests the camera approves get frames, encrypted per viewer session.

Code: `crypto_channel.py`, `handshake.py`, `pairing.py`, `access.py` on the PC; `web/src/lib/crypto/`
in the browser (the audited noble libraries, which work without `crypto.subtle` on plain HTTP).

## Break tests

Tests that attack the real server through a relay in the middle of the TCP connection, the position of
anyone on the LAN on plain HTTP.

| Attack | Test | Expected |
|---|---|---|
| Record a whole session (pairing, camera, approved viewer, a frame) and search it | `tests/backend/test_wire_tap.py::test_an_eavesdropper_sees_no_picture_no_app_message_and_no_secret` | no JPEG marker (`FF D8 FF`, `JFIF`) or pixel bytes, no app word (`camera-start`, `request`, `approve`, …) nor the watch key in binary messages, neither the device secret nor the code's scalar anywhere, only handshake types in plain text; and the viewer did get the picture |
| Spot the same picture sent twice | `…::test_the_same_picture_never_looks_the_same_on_the_wire` | the two ciphertexts differ beyond the public counter |
| Flip one bit of a frame on the wire | `…::test_a_bit_flipped_on_the_wire_ends_the_session_and_nothing_reaches_the_webcam` | the session ends; neither the viewer nor ffmpeg gets the frame |
| Play a recorded camera session back to the server later | `…::test_a_recorded_session_played_back_later_gets_nothing` | the server answers with a fresh key, the old proof fails, no ffmpeg starts and no frame is written |
| Send a captured message back to its sender | `tests/backend/test_crypto_channel.py::test_a_message_sent_back_to_its_sender_is_refused` and the same in `web/src/lib/crypto/crypto.test.ts` | refused: each direction has its own key |
| Rewrite the counter to slip an old message past the replay check | `…::test_the_counter_cannot_be_moved_to_slip_a_message_in` and the browser twin | refused: the counter is the nonce |
| Replay, reorder, alter, truncate, use a wrong key, send plain text after the handshake | `test_crypto_channel.py`, `test_robustness.py`, `crypto.test.ts` | refused, the session ends |
| Wrong code, guessing, malformed pairing | `test_pairing.py`, `test_robustness.py` | not paired, IP blocked, pairing locked, server stays up |
| A real browser on plain HTTP (no `crypto.subtle`) watching through a recording relay | `tests/e2e/camera.spec.mjs`, "an eavesdropper on plain HTTP …" with `tests/e2e/wire-tap.mjs` | at least 3 encrypted frames crossed; no JPEG marker, no app word, not the device secret; only handshakes in plain text |

The relays: `tests/backend/wire_tap.py` (Python, keeps and inflates the compression) and
`tests/e2e/wire-tap.mjs` (Node, removes the compression offer from the upgrade so the payload is read
as encrypted).

### Proof that the break tests bite

A test that always passes proves nothing. `tests/backend/plugin_without_encryption.py` turns the
message encryption off; with it, the eavesdropper, the repeated picture and the flipped bit tests must
fail. `./run-tests.sh` runs this as the layer *break tests fail without encryption* and fails if any of
them passes. By hand:

```bash
PYTHONPATH=.:tests/backend .venv/bin/python -m pytest -p plugin_without_encryption tests/backend/test_wire_tap.py
# expect: 3 failed, 1 passed (the replay test passes: the handshake alone stops it)
```

### Run them

```bash
.venv/bin/python -m pytest tests/backend/test_wire_tap.py tests/backend/test_crypto_channel.py tests/backend/test_robustness.py
corepack pnpm run unit                     # browser crypto, with the server vectors
RUN_E2E=1 ./run-tests.sh                   # everything, with the real browser through the relay
```

## Not done

- No external audit of the protocol. The primitives are standard and from audited libraries
  (libsodium, noble); the way they are put together is this project's own, checked by the tests above
  and by both sides producing the same bytes (`web/src/lib/crypto/vectors.json`).
- Traffic analysis (size and timing) is not padded away.
- No certificate pinning: the HTTPS certificate is self-signed and the browser asks you once.
