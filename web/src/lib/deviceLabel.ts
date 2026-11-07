import { Laptop, Smartphone, Tablet, type LucideIcon } from 'lucide-react';

/*
 * A short name for a User-Agent, for the network panel and the watch requests: what kind of device it is
 * and which browser on which system. Only for people to recognize their devices, never for decisions.
 */
export type DeviceKind = 'phone' | 'tablet' | 'computer';

export interface DeviceLabel {
  kind: DeviceKind;
  name: string;
}

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Windows/i, 'Windows'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/CrOS/i, 'ChromeOS'],
  [/Linux/i, 'Linux'],
];

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const firstMatch = (userAgent: string, table: readonly (readonly [RegExp, string])[]): string | null =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

function kindOf(userAgent: string): DeviceKind {
  if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) {
    return 'tablet';
  }
  if (/Mobile|iPhone|iPod/i.test(userAgent)) {
    return 'phone';
  }

  return 'computer';
}

export function deviceLabel(userAgent: string): DeviceLabel {
  const parts = [firstMatch(userAgent, BROWSERS), firstMatch(userAgent, SYSTEMS)].filter(
    (part): part is string => part !== null,
  );

  return { kind: kindOf(userAgent), name: parts.length > 0 ? parts.join(' · ') : '?' };
}

export const DEVICE_ICONS: Readonly<Record<DeviceKind, LucideIcon>> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Laptop,
};
