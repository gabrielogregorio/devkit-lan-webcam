import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { forgetCredential, saveCredential } from '@/lib/credentialStore';
import { SessionProvider } from '@/lib/SessionContext';
import { SessionStore, type SessionDependencies } from '@/lib/sessionStore';
import { storageKey } from '@/lib/storage';
import { FakeServer, FakeSocket, TEST_CREDENTIAL, fakeSocketFactory } from '@/testDoubles';

export const NOW = 1_000_000;

export function pairedStore(dependencies: SessionDependencies = {}): SessionStore {
  saveCredential(TEST_CREDENTIAL);

  return new SessionStore({ createSocket: fakeSocketFactory, now: () => NOW, ...dependencies });
}

export interface Rendered extends RenderResult {
  store: SessionStore;
  server: FakeServer;
}

// Renders inside a session that already completed its encrypted handshake with a fake server.
export function renderConnected(ui: ReactNode, store: SessionStore = pairedStore()): Rendered {
  const rendered = render(<SessionProvider store={store}>{ui}</SessionProvider>);
  const server = FakeServer.accept(FakeSocket.latest());

  return { ...rendered, store, server };
}

export function clearSessionStorage(): void {
  forgetCredential();
  window.sessionStorage.removeItem(storageKey('watch-key'));
  window.localStorage.removeItem(storageKey('quality'));
}

export const NETWORK_MESSAGE = {
  type: 'network',
  you: '192.168.0.20',
  server: '192.168.0.10',
  router: '192.168.0.1',
  camera: { ip: '192.168.0.30', device: 'Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile Safari/537.36' },
  peers: [
    {
      ip: '192.168.0.30',
      device: 'Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile Safari/537.36',
      role: 'camera',
      you: false,
    },
    {
      ip: '192.168.0.20',
      device: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36',
      role: 'watching',
      you: true,
    },
  ],
  pairing: { code: '123456', secondsLeft: 245 },
};
