import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import {
  PROTOCOL,
  bytesToHex,
  concatBytes,
  equalBytes,
  hexToBytes,
  lengthPrefixed,
  secureRandom,
  utf8ToBytes,
  type RandomSource,
} from '@/lib/crypto/bytes';

/*
 * The browser's side of SPAKE2 (RFC 9382) over edwards25519, the same math as crypto_channel.py.
 * The 6-digit code never travels: the server proves it knew the same code, and only then sends the
 * device credential, encrypted with the SPAKE2 key.
 */
const Point = ed25519.Point;
type EdPoint = InstanceType<typeof Point>;
const GROUP_ORDER = Point.Fn.ORDER;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const SCALAR_SOURCE_BYTES = 64;
const POINT_M_HEX = 'd048032c6ea0b6d697ddc2e86bda85a33adac920f1bf18e1b0c6d166a5cecdaf';
const POINT_N_HEX = 'd3bfb518f44f3430f29d0c92af503865a1ed3281dc69b35dd868ba85f886c4ab';
const POINT_M = Point.fromHex(POINT_M_HEX);
const POINT_N = Point.fromHex(POINT_N_HEX);

export interface Credential {
  deviceId: string;
  secret: Uint8Array;
}

export interface PairingCandidate {
  clientTag: Uint8Array;
  serverTag: Uint8Array;
  encryptionKey: Uint8Array;
}

export interface PairingStart {
  share: Uint8Array;
  finish: (serverShares: readonly Uint8Array[]) => PairingCandidate[];
}

const littleEndianToNumber = (bytes: Uint8Array): bigint =>
  bytes.reduceRight((total, value) => (total << 8n) + BigInt(value), 0n);

function numberToLittleEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(KEY_BYTES);
  let remaining = value;
  for (let index = 0; index < KEY_BYTES; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
}

const reduceScalar = (bytes: Uint8Array): bigint => littleEndianToNumber(bytes) % GROUP_ORDER;

export const scalarFromCode = (code: string): bigint =>
  reduceScalar(sha512(concatBytes(PROTOCOL, utf8ToBytes(` spake2 ${code}`))));

function randomScalar(random: RandomSource): bigint {
  const scalar = reduceScalar(random(SCALAR_SOURCE_BYTES));
  if (scalar === 0n) {
    throw new Error('random scalar was zero');
  }

  return scalar;
}

export function decodeServerPoint(bytes: Uint8Array): EdPoint {
  const point = Point.fromBytes(bytes);
  if (point.is0() || !point.isTorsionFree()) {
    throw new Error('not a valid point');
  }

  return point;
}

export function startPairing(code: string, random: RandomSource = secureRandom): PairingStart {
  const codeScalar = scalarFromCode(code);
  const secret = randomScalar(random);
  const clientShare = Point.BASE.multiply(secret).add(POINT_M.multiply(codeScalar)).toBytes();

  const finish = (serverShares: readonly Uint8Array[]): PairingCandidate[] =>
    serverShares.map((serverShareBytes) => {
      const serverShare = decodeServerPoint(serverShareBytes);
      const sharedPoint = serverShare.subtract(POINT_N.multiply(codeScalar)).multiply(secret);
      const transcript = lengthPrefixed(
        utf8ToBytes('client'),
        utf8ToBytes('server'),
        hexToBytes(POINT_M_HEX),
        hexToBytes(POINT_N_HEX),
        clientShare,
        serverShareBytes,
        sharedPoint.toBytes(),
        numberToLittleEndian(codeScalar),
      );
      const digest = sha512(transcript);
      const confirmKeys = hkdf(
        sha256,
        digest.slice(KEY_BYTES),
        undefined,
        utf8ToBytes('ConfirmationKeys'),
        2 * KEY_BYTES,
      );

      return {
        clientTag: hmac(sha256, confirmKeys.slice(0, KEY_BYTES), transcript),
        serverTag: hmac(sha256, confirmKeys.slice(KEY_BYTES), transcript),
        encryptionKey: digest.slice(0, KEY_BYTES),
      };
    });

  return { share: clientShare, finish };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Checks the server's proof against the candidates, then opens the credential sealed with that candidate's key.
export function openCredential(
  candidates: readonly PairingCandidate[],
  serverConfirm: Uint8Array,
  sealed: Uint8Array,
): Credential {
  const match = candidates.find((candidate) => equalBytes(candidate.serverTag, serverConfirm));
  if (!match) {
    throw new Error('the PC did not prove the same code');
  }
  const plaintext = xchacha20poly1305(match.encryptionKey, sealed.slice(0, NONCE_BYTES), PROTOCOL).decrypt(
    sealed.slice(NONCE_BYTES),
  );
  const payload: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.secret !== 'string') {
    throw new Error('malformed credential');
  }

  return { deviceId: payload.id, secret: hexToBytes(payload.secret) };
}

export const credentialToJson = (credential: Credential): { id: string; secret: string } => ({
  id: credential.deviceId,
  secret: bytesToHex(credential.secret),
});
