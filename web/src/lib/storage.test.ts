import { readJson, removeKey, storageKey, writeJson } from '@/lib/storage';

describe('storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(storageKey('thing'));
  });

  it('prefixes every key with the project name', () => {
    writeJson('local', 'thing', { value: 1 });

    expect(window.localStorage.getItem('devkit-lan-webcam.thing')).toBe('{"value":1}');
    expect(readJson('local', 'thing')).toEqual({ value: 1 });

    removeKey('local', 'thing');

    expect(readJson('local', 'thing')).toBeNull();
  });

  it('keeps other projects keys untouched', () => {
    window.localStorage.setItem('other-project.thing', 'kept');
    writeJson('local', 'thing', 1);
    removeKey('local', 'thing');

    expect(window.localStorage.getItem('other-project.thing')).toBe('kept');
    window.localStorage.removeItem('other-project.thing');
  });

  it('survives damaged values and blocked or full storage', () => {
    window.localStorage.setItem(storageKey('thing'), '{not json');

    expect(readJson('local', 'thing')).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => writeJson('session', 'thing', 1)).not.toThrow();
    expect(() => removeKey('session', 'thing')).not.toThrow();
  });

  it('works without any storage at all', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(readJson('local', 'thing')).toBeNull();
    expect(() => writeJson('local', 'thing', 1)).not.toThrow();
  });
});
