import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex, concatBytes, hexToBytes, utf8ToBytes };

export type RandomSource = (length: number) => Uint8Array;

// crypto.getRandomValues works over plain HTTP too; only crypto.subtle needs HTTPS.
export const secureRandom: RandomSource = (length) => randomBytes(length);

export const PROTOCOL = utf8ToBytes('lan-webcam v1');

const LENGTH_PREFIX_BYTES = 8;

// The same framing as crypto_channel.length_prefixed: every part preceded by its length, 8 bytes little-endian.
export function lengthPrefixed(...parts: Uint8Array[]): Uint8Array {
  return concatBytes(
    ...parts.flatMap((part) => {
      const prefix = new Uint8Array(LENGTH_PREFIX_BYTES);
      new DataView(prefix.buffer).setBigUint64(0, BigInt(part.length), true);

      return [prefix, part];
    }),
  );
}

export function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) {
    return false;
  }
  let difference = 0;
  first.forEach((value, index) => {
    difference |= value ^ Number(second[index]);
  });

  return difference === 0;
}
