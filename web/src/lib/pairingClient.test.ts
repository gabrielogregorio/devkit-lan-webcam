import { hexToBytes } from '@/lib/crypto/bytes';
import vectors from '@/lib/crypto/vectors.json';
import { isValidCode, normalizeCode, pairWithCode } from '@/lib/pairingClient';
import { FakeSocket, fakeSocketFactory } from '@/testDoubles';

const PAIR_URL = 'wss://pc.local:9443/ws/pair';
const fixedRandom = (): Uint8Array => hexToBytes(vectors.pairing.clientScalarSource);

function startPairing(code = vectors.pairing.code): { result: ReturnType<typeof pairWithCode>; socket: FakeSocket } {
  const result = pairWithCode(code, PAIR_URL, fakeSocketFactory, fixedRandom);
  const socket = FakeSocket.latest();
  socket.open();

  return { result, socket };
}

describe('pairing client', () => {
  it('normalizes and validates the typed code', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(isValidCode('123456')).toBe(true);
    expect(isValidCode('12345')).toBe(false);
    expect(isValidCode('12345a')).toBe(false);
  });

  it('runs the whole exchange and returns the credential', async () => {
    const { result, socket } = startPairing();

    expect(socket.lastSentJson()).toEqual({ type: 'pair', share: vectors.pairing.clientShare });

    socket.receiveJson({ type: 'challenge', shares: vectors.pairing.serverShares });

    expect(socket.lastSentJson()).toEqual({ type: 'confirm', tags: vectors.pairing.clientTags });

    socket.receiveJson({
      type: 'paired',
      confirm: vectors.pairing.serverConfirm,
      credential: vectors.pairing.sealedCredential,
    });
    const outcome = await result;

    expect(outcome.type).toBe('paired');
    expect(outcome.type === 'paired' && outcome.credential.deviceId).toBe(vectors.pairing.credential.id);
    expect(socket.closed).toBe(true);
  });

  it.each([
    [{ type: 'wrong-code' }, { type: 'wrong-code' }],
    [
      { type: 'blocked', retryIn: 120 },
      { type: 'blocked', retryIn: 120 },
    ],
    [{ type: 'blocked' }, { type: 'blocked', retryIn: 0 }],
    [{ type: 'locked' }, { type: 'locked' }],
    [{ type: 'unknown' }, { type: 'failed' }],
  ])('reports %j as %j', async (reply, expected) => {
    const { result, socket } = startPairing();

    socket.receiveJson(reply);

    await expect(result).resolves.toEqual(expected);
  });

  it('fails on a server that does not prove the code, on garbage and on a dropped connection', async () => {
    const forged = startPairing();
    forged.socket.receiveJson({ type: 'challenge', shares: vectors.pairing.serverShares });
    forged.socket.receiveJson({
      type: 'paired',
      confirm: '00'.repeat(32),
      credential: vectors.pairing.sealedCredential,
    });

    await expect(forged.result).resolves.toEqual({ type: 'failed' });

    const garbage = startPairing();
    garbage.socket.receive(new ArrayBuffer(2));

    await expect(garbage.result).resolves.toEqual({ type: 'failed' });

    const list = startPairing();
    list.socket.receive('[]');

    await expect(list.result).resolves.toEqual({ type: 'failed' });

    const text = startPairing();
    text.socket.receive('not json');

    await expect(text.result).resolves.toEqual({ type: 'failed' });

    const dropped = startPairing();
    dropped.socket.close();

    await expect(dropped.result).resolves.toEqual({ type: 'failed' });
  });

  it('a challenge without shares fails cleanly', async () => {
    const { result, socket } = startPairing();

    socket.receiveJson({ type: 'challenge' });
    socket.receiveJson({
      type: 'paired',
      confirm: vectors.pairing.serverConfirm,
      credential: vectors.pairing.sealedCredential,
    });

    await expect(result).resolves.toEqual({ type: 'failed' });
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const { result } = startPairing();

    vi.advanceTimersByTime(15_000);

    await expect(result).resolves.toEqual({ type: 'failed' });
    vi.useRealTimers();
  });
});
