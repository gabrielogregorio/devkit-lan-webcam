/*
 * Every key this app keeps in the browser goes through here, with the project prefix, and every access
 * survives a blocked or full storage (private windows): the app then just forgets between visits.
 */
const PREFIX = 'devkit-lan-webcam.';

export const storageKey = (name: string): string => `${PREFIX}${name}`;

type Area = 'local' | 'session';

function areaOf(area: Area): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson(area: Area, name: string): unknown {
  try {
    const text = areaOf(area)?.getItem(storageKey(name));

    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeJson(area: Area, name: string, value: unknown): void {
  try {
    areaOf(area)?.setItem(storageKey(name), JSON.stringify(value));
  } catch {
    // Blocked or full storage: the value only lives until the page closes.
  }
}

export function removeKey(area: Area, name: string): void {
  try {
    areaOf(area)?.removeItem(storageKey(name));
  } catch {
    // Nothing to remove when storage is blocked.
  }
}
