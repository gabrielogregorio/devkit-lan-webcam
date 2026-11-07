import type { RandomSource } from '@/lib/crypto/bytes';
import { KIND_FRAME, KIND_JSON, startSession, type ClientHello, type MessageCipher } from '@/lib/crypto/session';
import type { Credential } from '@/lib/crypto/spake2';

export const RECONNECT_DELAY_MS = 2000;

export type SocketFactory = (url: string) => WebSocket;
export type ConnectionPhase = 'connecting' | 'open' | 'unpaired' | 'lost';

export interface ConnectionCallbacks {
  onPhase: (phase: ConnectionPhase) => void;
  onJson: (message: Record<string, unknown>) => void;
  onFrame: (frame: Uint8Array) => void;
}

const browserSocket: SocketFactory = (url) => new WebSocket(url);

// ws:// on plain HTTP, wss:// on HTTPS: the encryption below does not depend on it.
export const serverUrl = (path: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseText(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/*
 * The page's one session to /ws/session: handshake (hello -> welcome -> ready), then every message
 * encrypted both ways. Reconnects on its own, except when the PC says the device is no longer paired.
 */
export class SecureConnection {
  private socket: WebSocket | null = null;
  private cipher: MessageCipher | null = null;
  private hello: ClientHello | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(
    private readonly url: string,
    private readonly credential: Credential,
    private readonly callbacks: ConnectionCallbacks,
    private readonly createSocket: SocketFactory = browserSocket,
    private readonly random?: RandomSource,
  ) {}

  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0;
  }

  get isOpen(): boolean {
    return this.cipher !== null;
  }

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
  }

  sendJson(message: object): boolean {
    if (!this.cipher || !this.socket) {
      return false;
    }
    this.socket.send(this.cipher.encryptJson(message) as Uint8Array<ArrayBuffer>);

    return true;
  }

  sendFrame(frame: Uint8Array): boolean {
    if (!this.cipher || !this.socket) {
      return false;
    }
    this.socket.send(this.cipher.encrypt(KIND_FRAME, frame) as Uint8Array<ArrayBuffer>);

    return true;
  }

  private connect(): void {
    this.reconnectTimer = null;
    this.callbacks.onPhase('connecting');
    const socket = this.createSocket(this.url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      this.hello = startSession(this.credential, this.random);
      socket.send(JSON.stringify(this.hello.message));
    };
    socket.onmessage = (event: MessageEvent<unknown>) => this.handleMessage(socket, event.data);
    socket.onclose = () => this.handleClose(socket);
    this.socket = socket;
  }

  private handleMessage(socket: WebSocket, data: unknown): void {
    try {
      if (typeof data === 'string') {
        this.handleHandshake(socket, parseText(data));

        return;
      }
      if (this.cipher && data instanceof ArrayBuffer) {
        this.handleEncrypted(this.cipher, new Uint8Array(data));
      }
    } catch {
      // A failed handshake or a message that does not decrypt ends this connection; it reconnects.
      socket.close();
    }
  }

  private handleHandshake(socket: WebSocket, message: Record<string, unknown> | null): void {
    if (message?.type === 'unpaired') {
      this.active = false;
      this.callbacks.onPhase('unpaired');
      socket.close();

      return;
    }
    if (message?.type !== 'welcome' || !this.hello || this.cipher) {
      throw new Error('unexpected handshake message');
    }
    const { ready, cipher } = this.hello.finish(message);
    socket.send(JSON.stringify(ready));
    this.cipher = cipher;
    this.callbacks.onPhase('open');
  }

  private handleEncrypted(cipher: MessageCipher, data: Uint8Array): void {
    const { kind, payload } = cipher.decrypt(data);
    if (kind === KIND_FRAME) {
      this.callbacks.onFrame(payload);

      return;
    }
    if (kind === KIND_JSON) {
      const message = parseText(new TextDecoder().decode(payload));
      if (message) {
        this.callbacks.onJson(message);
      }
    }
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.cipher = null;
    this.hello = null;
    if (!this.active) {
      return;
    }
    this.callbacks.onPhase('lost');
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.cipher = null;
    this.hello = null;
    socket?.close();
  }
}
