import { useSyncExternalStore } from 'react';

export const ROUTES = {
  home: '/',
  stream: '/stream',
  watch: '/watch',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

const KNOWN_PATHS: readonly string[] = Object.values(ROUTES);
const NAVIGATE_EVENT = 'lan-webcam:navigate';

const withoutTrailingSlashes = (pathname: string): string => {
  let trimmed = pathname;
  while (trimmed.length > 1 && trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
};

export function routeFromPathname(pathname: string): RoutePath {
  const normalized = withoutTrailingSlashes(pathname);
  if (KNOWN_PATHS.includes(normalized)) {
    return normalized as RoutePath;
  }

  return ROUTES.home;
}

// Keeps ?lang= and any other query across pages.
export function navigate(path: RoutePath): void {
  window.history.pushState(null, '', `${path}${window.location.search}`);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);

  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

const currentPathname = (): string => window.location.pathname;

export function useRoute(): RoutePath {
  return routeFromPathname(useSyncExternalStore(subscribe, currentPathname));
}
