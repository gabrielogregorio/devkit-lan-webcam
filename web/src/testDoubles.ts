import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { StreamerCallbacks } from '@/lib/cameraStreamer';
import { bytesToHex, hexToBytes } from '@/lib/crypto/bytes';
import { KIND_JSON, MessageCipher, deriveSessionKeys, type SessionKeys } from '@/lib/crypto/session';
import type { Credential } from '@/lib/crypto/spake2';
import { resetView } from '@/lib/view';

export const TEST_CREDENTIAL: Credential = { deviceId: 'ab'.repeat(16), secret: hexToBytes('cd'.repeat(32)) };
const SERVER_PRIVATE = new Uint8Array(32).fill(5);
const SERVER_NONCE = new Uint8Array(16).fill(6);

// Stand-in for CameraStreamer in component tests: records calls and exposes the callbacks the page gave it.
export class FakeCameraStreamer {
  static readonly instances: FakeCameraStreamer[] = [];

  readonly setView = vi.fn();
  readonly setQuality = vi.fn(() => resetView());
  readonly handleServerMessage = vi.fn();
  readonly openCamera = vi.fn(() => Promise.resolve());
  readonly start = vi.fn(() => Promise.resolve());
  readonly stop = vi.fn();
  readonly destroy = vi.fn();
  readonly listCameras = vi.fn();

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly callbacks: StreamerCallbacks,
  ) {
    FakeCameraStreamer.instances.push(this);
  }

  static latest(): FakeCameraStreamer {
    const latest = FakeCameraStreamer.instances.at(-1);
    if (!latest) {
      throw new Error('No CameraStreamer was created');
    }

    return latest;
  }
}

export class FakeSocket {
  static readonly instances: FakeSocket[] = [];

  binaryType = '';
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static latest(): FakeSocket {
    const latest = FakeSocket.instances.at(-1);
    if (!latest) {
      throw new Error('No socket was opened');
    }

    return latest;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  receiveJson(message: object): void {
    this.receive(JSON.stringify(message));
  }

  lastSentJson(): Record<string, unknown> {
    const last = this.sent.at(-1);
    if (typeof last !== 'string') {
      throw new Error('the last message sent was not text');
    }

    return JSON.parse(last) as Record<string, unknown>;
  }
}

export const fakeSocketFactory = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

// The server's side of a session, in the test: answers the hello with a real welcome and talks encrypted.
export class FakeServer {
  readonly cipher: MessageCipher;

  private constructor(
    readonly socket: FakeSocket,
    private readonly keys: SessionKeys,
  ) {
    this.cipher = new MessageCipher(keys.serverToClient, keys.clientToServer);
  }

  static accept(socket: FakeSocket, credential: Credential = TEST_CREDENTIAL): FakeServer {
    socket.open();
    const hello = socket.lastSentJson();
    const clientPublic = hexToBytes(String(hello.epk));
    const serverPublic = x25519.getPublicKey(SERVER_PRIVATE);
    const keys = deriveSessionKeys({
      deviceSecret: credential.secret,
      deviceId: credential.deviceId,
      clientPublic,
      clientNonce: hexToBytes(String(hello.nonce)),
      serverPublic,
      serverNonce: SERVER_NONCE,
      sharedSecret: x25519.getSharedSecret(SERVER_PRIVATE, clientPublic),
    });
    socket.receiveJson({
      type: 'welcome',
      epk: bytesToHex(serverPublic),
      nonce: bytesToHex(SERVER_NONCE),
      confirm: bytesToHex(hmac(sha256, keys.serverConfirm, keys.transcript)),
    });

    return new FakeServer(socket, keys);
  }

  pushJson(message: object): void {
    this.socket.receive(this.cipher.encryptJson(message).slice().buffer);
  }

  pushFrame(frame: Uint8Array, kind = 2): void {
    this.socket.receive(this.cipher.encrypt(kind, frame).slice().buffer);
  }

  // Every encrypted message the page sent since the handshake, decrypted in order.
  received(): { kind: number; json: Record<string, unknown> | null; payload: Uint8Array }[] {
    const reader = new MessageCipher(this.keys.serverToClient, this.keys.clientToServer);

    return this.socket.sent
      .filter((message): message is Uint8Array => message instanceof Uint8Array)
      .map((message) => {
        const { kind, payload } = reader.decrypt(message);
        const json =
          kind === KIND_JSON ? (JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>) : null;

        return { kind, json, payload };
      });
  }
}
