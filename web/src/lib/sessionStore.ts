import type { Credential } from '@/lib/crypto/spake2';
import { forgetCredential, loadCredential, loadWatchKey, newWatchKey, saveCredential } from '@/lib/credentialStore';
import { pairWithCode, type PairingOutcome } from '@/lib/pairingClient';
import {
  decisionMessage,
  parseServerMessage,
  watchRequestMessage,
  type Decision,
  type NetworkPanelData,
  type ServerMessage,
  type ViewerStatus,
  type WatchRequest,
} from '@/lib/protocol';
import { SecureConnection, serverUrl, type ConnectionPhase, type SocketFactory } from '@/lib/secureConnection';

export interface SessionSnapshot {
  phase: ConnectionPhase;
  status: ViewerStatus | null;
  network: NetworkPanelData | null;
  requests: WatchRequest[];
  networkReceivedAt: number;
}

// What the camera needs from the session: send frames and control messages, and know when it is congested.
export interface SessionTransport {
  readonly isOpen: boolean;
  readonly bufferedAmount: number;
  sendJson: (message: object) => boolean;
  sendFrame: (frame: Uint8Array) => boolean;
}

type Listener<Value> = (value: Value) => void;

export interface SessionDependencies {
  createSocket?: SocketFactory;
  now?: () => number;
  pair?: (code: string) => Promise<PairingOutcome>;
}

const EMPTY: SessionSnapshot = { phase: 'unpaired', status: null, network: null, requests: [], networkReceivedAt: 0 };

export class SessionStore implements SessionTransport {
  private snapshot: SessionSnapshot = EMPTY;
  private connection: SecureConnection | null = null;
  private readonly snapshotListeners = new Set<() => void>();
  private readonly frameListeners = new Set<Listener<Uint8Array>>();
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly createSocket: SocketFactory | undefined;
  private readonly now: () => number;
  private readonly pairFunction: (code: string) => Promise<PairingOutcome>;

  constructor(dependencies: SessionDependencies = {}) {
    this.createSocket = dependencies.createSocket;
    this.now = dependencies.now ?? Date.now;
    this.pairFunction =
      dependencies.pair ??
      ((code) => pairWithCode(code, serverUrl('/ws/pair'), this.createSocket ?? ((url) => new WebSocket(url))));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.snapshotListeners.add(listener);

    return () => this.snapshotListeners.delete(listener);
  };

  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  get isOpen(): boolean {
    return this.connection?.isOpen ?? false;
  }

  get bufferedAmount(): number {
    return this.connection?.bufferedAmount ?? 0;
  }

  readonly sendJson = (message: object): boolean => this.connection?.sendJson(message) ?? false;

  readonly sendFrame = (frame: Uint8Array): boolean => this.connection?.sendFrame(frame) ?? false;

  onFrame(listener: Listener<Uint8Array>): () => void {
    this.frameListeners.add(listener);

    return () => this.frameListeners.delete(listener);
  }

  onMessage(listener: Listener<ServerMessage>): () => void {
    this.messageListeners.add(listener);

    return () => this.messageListeners.delete(listener);
  }

  start(): void {
    const credential = loadCredential();
    if (!credential) {
      this.update({ ...EMPTY });

      return;
    }
    this.connect(credential);
  }

  stop(): void {
    this.connection?.stop();
    this.connection = null;
  }

  async pair(code: string): Promise<PairingOutcome> {
    const outcome = await this.pairFunction(code);
    if (outcome.type === 'paired') {
      saveCredential(outcome.credential);
      this.connect(outcome.credential);
    }

    return outcome;
  }

  forget(): void {
    this.stop();
    forgetCredential();
    this.update({ ...EMPTY });
  }

  // A fresh key makes a new request (the old one was denied); otherwise the tab keeps its key.
  requestToWatch(fresh: boolean): boolean {
    const stored = loadWatchKey();
    const watchKey = fresh || !stored ? newWatchKey() : stored;

    return this.sendJson(watchRequestMessage(watchKey.key));
  }

  decide(id: string, decision: Decision): boolean {
    return this.sendJson(decisionMessage(id, decision));
  }

  private connect(credential: Credential): void {
    this.stop();
    const connection = new SecureConnection(
      serverUrl('/ws/session'),
      credential,
      {
        onPhase: (phase) => this.handlePhase(phase),
        onJson: (message) => this.handleJson(message),
        onFrame: (frame) => this.frameListeners.forEach((listener) => listener(frame)),
      },
      this.createSocket,
    );
    this.connection = connection;
    connection.start();
  }

  private handlePhase(phase: ConnectionPhase): void {
    if (phase === 'unpaired') {
      forgetCredential();
      this.connection = null;
      this.update({ ...EMPTY });

      return;
    }
    this.update({ ...this.snapshot, phase });
    if (phase === 'open' && loadWatchKey()?.requested) {
      // A reload or a reconnect asks again with the same key, so an approval survives it.
      this.requestToWatch(false);
    }
  }

  private handleJson(raw: Record<string, unknown>): void {
    const message = parseServerMessage(raw);
    if (!message) {
      return;
    }
    if (message.type === 'status') {
      this.update({ ...this.snapshot, status: message.status });
    } else if (message.type === 'network') {
      this.update({ ...this.snapshot, network: message.network, networkReceivedAt: this.now() });
    } else if (message.type === 'requests') {
      this.update({ ...this.snapshot, requests: message.requests });
    }
    this.messageListeners.forEach((listener) => listener(message));
  }

  private update(next: SessionSnapshot): void {
    this.snapshot = next;
    this.snapshotListeners.forEach((listener) => listener());
  }
}
