import { forgetCredential, loadCredential, loadWatchKey, newWatchKey, saveCredential } from '@/lib/credentialStore';
import { storageKey } from '@/lib/storage';
import { TEST_CREDENTIAL } from '@/testDoubles';

describe('credential store', () => {
  afterEach(() => {
    forgetCredential();
    window.sessionStorage.removeItem(storageKey('watch-key'));
  });

  it('saves, loads and forgets the device credential', () => {
    expect(loadCredential()).toBeNull();

    saveCredential(TEST_CREDENTIAL);

    expect(loadCredential()).toEqual(TEST_CREDENTIAL);

    forgetCredential();

    expect(loadCredential()).toBeNull();
  });

  it.each([
    ['not an object', '"text"'],
    ['a short id', JSON.stringify({ id: 'ab', secret: 'cd'.repeat(32) })],
    ['a short secret', JSON.stringify({ id: 'ab'.repeat(16), secret: 'cd' })],
    ['a missing secret', JSON.stringify({ id: 'ab'.repeat(16) })],
  ])('ignores a stored credential with %s', (_description, stored) => {
    window.localStorage.setItem(storageKey('device'), stored);

    expect(loadCredential()).toBeNull();
  });

  it('makes one random watch key per tab and reads it back', () => {
    expect(loadWatchKey()).toBeNull();

    const first = newWatchKey();
    const second = newWatchKey();

    expect(first.key).toMatch(/^[0-9a-f]{32}$/);
    expect(second.key).not.toBe(first.key);
    expect(loadWatchKey()).toEqual({ key: second.key, requested: true });
  });

  it('ignores a damaged watch key', () => {
    window.sessionStorage.setItem(storageKey('watch-key'), JSON.stringify({ key: 'XYZ', requested: true }));

    expect(loadWatchKey()).toBeNull();

    window.sessionStorage.setItem(storageKey('watch-key'), JSON.stringify({ key: 'a'.repeat(32) }));

    expect(loadWatchKey()).toEqual({ key: 'a'.repeat(32), requested: false });
  });
});
