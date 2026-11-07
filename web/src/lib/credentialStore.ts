import { bytesToHex, hexToBytes, secureRandom } from '@/lib/crypto/bytes';
import { credentialToJson, type Credential } from '@/lib/crypto/spake2';
import { readJson, removeKey, writeJson } from '@/lib/storage';

const CREDENTIAL_NAME = 'device';
const WATCH_KEY_NAME = 'watch-key';
const WATCH_KEY_BYTES = 16;
const DEVICE_ID = /^[0-9a-f]{32}$/;
const SECRET = /^[0-9a-f]{64}$/;
const WATCH_KEY = /^[0-9a-f]{32}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The device credential lives per browser and origin: http:// and https:// pair separately.
export function loadCredential(): Credential | null {
  const stored = readJson('local', CREDENTIAL_NAME);
  if (!isRecord(stored) || typeof stored.id !== 'string' || typeof stored.secret !== 'string') {
    return null;
  }
  if (!DEVICE_ID.test(stored.id) || !SECRET.test(stored.secret)) {
    return null;
  }

  return { deviceId: stored.id, secret: hexToBytes(stored.secret) };
}

export const saveCredential = (credential: Credential): void =>
  writeJson('local', CREDENTIAL_NAME, credentialToJson(credential));

export const forgetCredential = (): void => removeKey('local', CREDENTIAL_NAME);

export interface WatchKey {
  key: string;
  requested: boolean;
}

// One key per tab (sessionStorage): every tab is its own watch request, and a reload keeps it.
export function loadWatchKey(): WatchKey | null {
  const stored = readJson('session', WATCH_KEY_NAME);
  if (!isRecord(stored) || typeof stored.key !== 'string' || !WATCH_KEY.test(stored.key)) {
    return null;
  }

  return { key: stored.key, requested: stored.requested === true };
}

export function newWatchKey(): WatchKey {
  const watchKey = { key: bytesToHex(secureRandom(WATCH_KEY_BYTES)), requested: true };
  writeJson('session', WATCH_KEY_NAME, watchKey);

  return watchKey;
}
