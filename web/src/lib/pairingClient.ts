import { bytesToHex, hexToBytes, secureRandom, type RandomSource } from '@/lib/crypto/bytes';
import { openCredential, startPairing, type Credential } from '@/lib/crypto/spake2';
import type { SocketFactory } from '@/lib/secureConnection';

export type PairingOutcome =
  | { type: 'paired'; credential: Credential }
  | { type: 'wrong-code' }
  | { type: 'blocked'; retryIn: number }
  | { type: 'locked' }
  | { type: 'failed' };

const CODE_FORMAT = /^\d{6}$/;
const PAIRING_TIMEOUT_MS = 15_000;

export const normalizeCode = (typed: string): string => typed.replace(/\D/g, '');

export const isValidCode = (code: string): boolean => CODE_FORMAT.test(code);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(data);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// One pairing attempt over /ws/pair: share -> challenge -> tags -> credential (or why it failed).
export function pairWithCode(
  code: string,
  url: string,
  createSocket: SocketFactory,
  random: RandomSource = secureRandom,
): Promise<PairingOutcome> {
  return new Promise((resolve) => {
    const pairing = startPairing(code, random);
    let candidates: ReturnType<typeof pairing.finish> = [];
    let settled = false;
    const socket = createSocket(url);
    const finish = (outcome: PairingOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ type: 'failed' }), PAIRING_TIMEOUT_MS);

    socket.onopen = () => socket.send(JSON.stringify({ type: 'pair', share: bytesToHex(pairing.share) }));
    socket.onclose = () => finish({ type: 'failed' });
    socket.onmessage = (event: MessageEvent<unknown>) => {
      const message = readMessage(event.data);
      try {
        handle(message);
      } catch {
        finish({ type: 'failed' });
      }
    };

    function handle(message: Record<string, unknown> | null): void {
      switch (message?.type) {
        case 'challenge': {
          const shares = Array.isArray(message.shares) ? message.shares : [];
          candidates = pairing.finish(shares.map((share) => hexToBytes(String(share))));
          socket.send(
            JSON.stringify({ type: 'confirm', tags: candidates.map((candidate) => bytesToHex(candidate.clientTag)) }),
          );

          return;
        }
        case 'paired': {
          const credential = openCredential(
            candidates,
            hexToBytes(String(message.confirm)),
            hexToBytes(String(message.credential)),
          );
          finish({ type: 'paired', credential });

          return;
        }
        case 'wrong-code':
          finish({ type: 'wrong-code' });

          return;
        case 'blocked':
          finish({ type: 'blocked', retryIn: typeof message.retryIn === 'number' ? message.retryIn : 0 });

          return;
        case 'locked':
          finish({ type: 'locked' });

          return;
        default:
          finish({ type: 'failed' });
      }
    }
  });
}
