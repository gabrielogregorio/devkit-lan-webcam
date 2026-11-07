import {
  bytesToHex,
  equalBytes,
  hexToBytes,
  lengthPrefixed,
  secureRandom,
  type RandomSource,
} from '@/lib/crypto/bytes';
import { KIND_FRAME, KIND_JSON, MessageCipher, startSession } from '@/lib/crypto/session';
import { credentialToJson, decodeServerPoint, openCredential, scalarFromCode, startPairing } from '@/lib/crypto/spake2';
import vectors from '@/lib/crypto/vectors.json';

const pairingVectors = vectors.pairing;
const sessionVectors = vectors.session;
const SEND_KEY = new Uint8Array(32).fill(1);
const RECEIVE_KEY = new Uint8Array(32).fill(2);

function fixedRandom(...chunks: string[]): RandomSource {
  const pending = chunks.map((chunk) => hexToBytes(chunk));

  return (length) => {
    const next = pending.shift();
    if (next?.length !== length) {
      throw new Error(`unexpected random request of ${length} bytes`);
    }

    return next;
  };
}

describe('pairing (SPAKE2) matches the server', () => {
  it('makes the same share from the same code and randomness', () => {
    const pairing = startPairing(pairingVectors.code, fixedRandom(pairingVectors.clientScalarSource));

    expect(bytesToHex(pairing.share)).toBe(pairingVectors.clientShare);
  });

  it('proves the code for both accepted windows and opens the credential', () => {
    const pairing = startPairing(pairingVectors.code, fixedRandom(pairingVectors.clientScalarSource));
    const candidates = pairing.finish(pairingVectors.serverShares.map((share) => hexToBytes(share)));

    expect(candidates.map((candidate) => bytesToHex(candidate.clientTag))).toEqual(pairingVectors.clientTags);

    const credential = openCredential(
      candidates,
      hexToBytes(pairingVectors.serverConfirm),
      hexToBytes(pairingVectors.sealedCredential),
    );

    expect(credentialToJson(credential)).toEqual(pairingVectors.credential);
  });

  it('refuses a server that did not prove the same code', () => {
    const pairing = startPairing('000000', fixedRandom(pairingVectors.clientScalarSource));
    const candidates = pairing.finish(pairingVectors.serverShares.map((share) => hexToBytes(share)));

    expect(() =>
      openCredential(candidates, hexToBytes(pairingVectors.serverConfirm), hexToBytes(pairingVectors.sealedCredential)),
    ).toThrow('the PC did not prove the same code');
  });

  it('refuses a credential that is not the expected JSON', () => {
    const pairing = startPairing(pairingVectors.code, fixedRandom(pairingVectors.clientScalarSource));
    const candidates = pairing.finish(pairingVectors.serverShares.map((share) => hexToBytes(share)));
    const forged = startPairing(pairingVectors.code, () => new Uint8Array(64).fill(7));

    expect(() => forged.finish([new Uint8Array(32)])).toThrow();
    expect(() =>
      openCredential(
        candidates,
        hexToBytes(pairingVectors.serverConfirm),
        hexToBytes(pairingVectors.sealedCredential).slice(0, 40),
      ),
    ).toThrow();
  });

  it('refuses a zero random scalar and points outside the group', () => {
    expect(() => startPairing('123456', () => new Uint8Array(64))).toThrow('random scalar was zero');
    expect(() => decodeServerPoint(hexToBytes('01' + '00'.repeat(31)))).toThrow('not a valid point');
    expect(scalarFromCode('123456')).not.toBe(scalarFromCode('123457'));
  });
});

describe('session matches the server', () => {
  const credential = { deviceId: sessionVectors.deviceId, secret: hexToBytes(sessionVectors.deviceSecret) };

  it('sends the same hello, accepts the same welcome and proves the same key', () => {
    const hello = startSession(credential, fixedRandom(sessionVectors.clientPrivate, sessionVectors.clientNonce));

    expect(hello.message).toEqual({
      type: 'hello',
      device: sessionVectors.deviceId,
      epk: sessionVectors.clientPublic,
      nonce: sessionVectors.clientNonce,
    });

    const { ready, cipher } = hello.finish(sessionVectors.welcome);
    const received = cipher.decrypt(hexToBytes(sessionVectors.serverMessage));

    expect(ready).toEqual({ type: 'ready', confirm: sessionVectors.readyConfirm });
    expect(received.kind).toBe(KIND_JSON);
    expect(JSON.parse(new TextDecoder().decode(received.payload))).toEqual({ type: 'status', camera: true });
    expect(bytesToHex(cipher.encrypt(KIND_FRAME, new TextEncoder().encode('jpeg')))).toBe(sessionVectors.clientFrame);
  });

  it('refuses a welcome with a wrong proof or malformed fields', () => {
    const start = (): ReturnType<typeof startSession> =>
      startSession(credential, fixedRandom(sessionVectors.clientPrivate, sessionVectors.clientNonce));

    expect(() => start().finish({ ...sessionVectors.welcome, confirm: '00'.repeat(32) })).toThrow(
      'the PC did not prove the session key',
    );
    expect(() => start().finish({ ...sessionVectors.welcome, epk: 'abcd' })).toThrow('epk has the wrong length');
    expect(() => start().finish({ ...sessionVectors.welcome, nonce: undefined })).toThrow('missing nonce');
  });
});

describe('MessageCipher', () => {
  const pair = (): [MessageCipher, MessageCipher] => [
    new MessageCipher(SEND_KEY, RECEIVE_KEY),
    new MessageCipher(RECEIVE_KEY, SEND_KEY),
  ];

  it('round-trips frames and JSON with their kind', () => {
    const [sender, receiver] = pair();

    expect(receiver.decrypt(sender.encrypt(KIND_FRAME, Uint8Array.of(9, 8)))).toEqual({
      kind: KIND_FRAME,
      payload: Uint8Array.of(9, 8),
    });
    expect(receiver.decrypt(sender.encryptJson({ type: 'x' })).kind).toBe(KIND_JSON);
  });

  it('refuses a replayed, an older, a tampered and a short message', () => {
    const [sender, receiver] = pair();
    const first = sender.encrypt(KIND_FRAME, Uint8Array.of(1));
    const second = sender.encrypt(KIND_FRAME, Uint8Array.of(2));
    receiver.decrypt(second);
    const tampered = sender.encrypt(KIND_FRAME, Uint8Array.of(3));
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;

    expect(() => receiver.decrypt(second)).toThrow('replayed');
    expect(() => receiver.decrypt(first)).toThrow('replayed');
    expect(() => receiver.decrypt(tampered)).toThrow();
    expect(() => receiver.decrypt(new Uint8Array(8))).toThrow('message too short');
  });

  it('refuses a message sent back to its sender and a message with a rewritten counter', () => {
    const [sender, receiver] = pair();
    const reflected = sender.encrypt(KIND_FRAME, Uint8Array.of(1));
    const moved = sender.encrypt(KIND_FRAME, Uint8Array.of(2));
    moved[7] = (moved[7] ?? 0) ^ 5;

    expect(() => sender.decrypt(reflected)).toThrow();
    expect(() => receiver.decrypt(moved)).toThrow();
  });

  it('carries an empty payload with its kind', () => {
    const [sender, receiver] = pair();

    expect(receiver.decrypt(sender.encrypt(KIND_FRAME, new Uint8Array(0)))).toEqual({
      kind: KIND_FRAME,
      payload: new Uint8Array(0),
    });
  });
});

describe('bytes helpers', () => {
  it('frames parts with their 8-byte little-endian length', () => {
    expect(bytesToHex(lengthPrefixed(Uint8Array.of(0xaa), new Uint8Array(0)))).toBe(
      '0100000000000000aa' + '0000000000000000',
    );
  });

  it('compares bytes by value and length', () => {
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(equalBytes(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });

  it('draws real random bytes of the asked length', () => {
    const first = secureRandom(16);

    expect(first).toHaveLength(16);
    expect(bytesToHex(first)).not.toBe(bytesToHex(secureRandom(16)));
  });
});

describe('edge cases', () => {
  it('refuses a message whose plaintext is empty', async () => {
    const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js');
    const { PROTOCOL } = await import('@/lib/crypto/bytes');
    const header = new Uint8Array(8);
    const nonce = new Uint8Array(24);
    const ciphertext = xchacha20poly1305(SEND_KEY, nonce, PROTOCOL).encrypt(new Uint8Array(0));
    const receiver = new MessageCipher(RECEIVE_KEY, SEND_KEY);
    const message = new Uint8Array(header.length + ciphertext.length);
    message.set(ciphertext, header.length);

    expect(() => receiver.decrypt(message)).toThrow('empty message');
  });

  it.each([
    ['a list', '[]'],
    ['a numeric id', JSON.stringify({ id: 1, secret: 'cd' })],
    ['a missing secret', JSON.stringify({ id: 'ab' })],
  ])('refuses a sealed credential that is %s', async (_description, payload) => {
    const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js');
    const { PROTOCOL, concatBytes, utf8ToBytes } = await import('@/lib/crypto/bytes');
    const pairing = startPairing(pairingVectors.code, fixedRandom(pairingVectors.clientScalarSource));
    const candidates = pairing.finish(pairingVectors.serverShares.map((share) => hexToBytes(share)));
    const nonce = new Uint8Array(24).fill(3);
    const match = candidates[0];
    if (!match) {
      throw new Error('no candidate');
    }
    const sealed = concatBytes(
      nonce,
      xchacha20poly1305(match.encryptionKey, nonce, PROTOCOL).encrypt(utf8ToBytes(payload)),
    );

    expect(() => openCredential(candidates, match.serverTag, sealed)).toThrow('malformed credential');
  });
});
