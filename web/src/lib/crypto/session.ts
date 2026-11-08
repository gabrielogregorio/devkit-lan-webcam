import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
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
import type { Credential } from '@/lib/crypto/spake2';

/*
 * The browser's side of a session, the same as crypto_channel.py: ephemeral X25519 + the device secret
 * through HKDF give one key per direction; both sides prove the keys; messages carry a counter as nonce
 * and a replayed or reordered message is refused.
 */
export const KIND_JSON = 1;
export const KIND_FRAME = 2;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const COUNTER_BYTES = 8;
const SESSION_NONCE_BYTES = 16;

export interface SessionKeys {
  clientToServer: Uint8Array;
  serverToClient: Uint8Array;
  clientConfirm: Uint8Array;
  serverConfirm: Uint8Array;
  transcript: Uint8Array;
}

export interface KeyMaterial {
  deviceSecret: Uint8Array;
  deviceId: string;
  clientPublic: Uint8Array;
  clientNonce: Uint8Array;
  serverPublic: Uint8Array;
  serverNonce: Uint8Array;
  sharedSecret: Uint8Array;
}

export function deriveSessionKeys(material: KeyMaterial): SessionKeys {
  const transcript = lengthPrefixed(
    PROTOCOL,
    utf8ToBytes(material.deviceId),
    material.clientPublic,
    material.clientNonce,
    material.serverPublic,
    material.serverNonce,
  );
  const keys = hkdf(sha256, material.sharedSecret, material.deviceSecret, transcript, 4 * KEY_BYTES);

  return {
    clientToServer: keys.slice(0, KEY_BYTES),
    serverToClient: keys.slice(KEY_BYTES, 2 * KEY_BYTES),
    clientConfirm: keys.slice(2 * KEY_BYTES, 3 * KEY_BYTES),
    serverConfirm: keys.slice(3 * KEY_BYTES),
    transcript,
  };
}

export interface ReceivedMessage {
  kind: number;
  payload: Uint8Array;
}

export class MessageCipher {
  private sendCounter = 0n;
  private lastReceived = -1n;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array,
  ) {}

  encrypt(kind: number, payload: Uint8Array): Uint8Array {
    const header = new Uint8Array(COUNTER_BYTES);
    new DataView(header.buffer).setBigUint64(0, this.sendCounter, false);
    this.sendCounter += 1n;
    const nonce = concatBytes(new Uint8Array(NONCE_BYTES - COUNTER_BYTES), header);
    const ciphertext = xchacha20poly1305(this.sendKey, nonce, PROTOCOL).encrypt(
      concatBytes(Uint8Array.of(kind), payload),
    );

    return concatBytes(header, ciphertext);
  }

  encryptJson(message: object): Uint8Array {
    return this.encrypt(KIND_JSON, utf8ToBytes(JSON.stringify(message)));
  }

  decrypt(message: Uint8Array): ReceivedMessage {
    if (message.length <= COUNTER_BYTES) {
      throw new Error('message too short');
    }
    const header = message.slice(0, COUNTER_BYTES);
    const counter = new DataView(header.buffer).getBigUint64(0, false);
    if (counter <= this.lastReceived) {
      throw new Error('replayed or reordered message');
    }
    const nonce = concatBytes(new Uint8Array(NONCE_BYTES - COUNTER_BYTES), header);
    const plaintext = xchacha20poly1305(this.receiveKey, nonce, PROTOCOL).decrypt(message.slice(COUNTER_BYTES));
    if (plaintext.length === 0) {
      throw new Error('empty message');
    }
    this.lastReceived = counter;

    return { kind: Number(plaintext[0]), payload: plaintext.slice(1) };
  }
}

export interface ClientHello {
  message: { type: 'hello'; device: string; epk: string; nonce: string };
  finish: (welcome: Record<string, unknown>) => { ready: { type: 'ready'; confirm: string }; cipher: MessageCipher };
}

const hexField = (record: Record<string, unknown>, name: string, length: number): Uint8Array => {
  const value = record[name];
  if (typeof value !== 'string') {
    throw new Error(`missing ${name}`);
  }
  const bytes = hexToBytes(value);
  if (bytes.length !== length) {
    throw new Error(`${name} has the wrong length`);
  }

  return bytes;
};

export function startSession(credential: Credential, random: RandomSource = secureRandom): ClientHello {
  const privateKey = random(KEY_BYTES);
  const clientPublic = x25519.getPublicKey(privateKey);
  const clientNonce = random(SESSION_NONCE_BYTES);

  const finish: ClientHello['finish'] = (welcome) => {
    const serverPublic = hexField(welcome, 'epk', KEY_BYTES);
    const keys = deriveSessionKeys({
      deviceSecret: credential.secret,
      deviceId: credential.deviceId,
      clientPublic,
      clientNonce,
      serverPublic,
      serverNonce: hexField(welcome, 'nonce', SESSION_NONCE_BYTES),
      sharedSecret: x25519.getSharedSecret(privateKey, serverPublic),
    });
    if (!equalBytes(hexField(welcome, 'confirm', KEY_BYTES), hmac(sha256, keys.serverConfirm, keys.transcript))) {
      throw new Error('the PC did not prove the session key');
    }

    return {
      ready: { type: 'ready', confirm: bytesToHex(hmac(sha256, keys.clientConfirm, keys.transcript)) },
      cipher: new MessageCipher(keys.clientToServer, keys.serverToClient),
    };
  };

  return {
    message: {
      type: 'hello',
      device: credential.deviceId,
      epk: bytesToHex(clientPublic),
      nonce: bytesToHex(clientNonce),
    },
    finish,
  };
}
