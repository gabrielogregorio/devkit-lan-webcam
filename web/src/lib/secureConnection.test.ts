import { KIND_JSON } from '@/lib/crypto/session';
import { RECONNECT_DELAY_MS, SecureConnection, serverUrl, type ConnectionCallbacks } from '@/lib/secureConnection';
import { FakeServer, FakeSocket, TEST_CREDENTIAL, fakeSocketFactory } from '@/testDoubles';

const SESSION_URL = 'wss://pc.local:9443/ws/session';

function setup(): { callbacks: ConnectionCallbacks; connection: SecureConnection } {
  const callbacks: ConnectionCallbacks = { onPhase: vi.fn(), onJson: vi.fn(), onFrame: vi.fn() };
  const connection = new SecureConnection(SESSION_URL, TEST_CREDENTIAL, callbacks, fakeSocketFactory);

  return { callbacks, connection };
}

describe('SecureConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds ws:// over HTTP and wss:// over HTTPS', () => {
    expect(serverUrl('/ws/session', { protocol: 'http:', host: 'pc:9080' })).toBe('ws://pc:9080/ws/session');
    expect(serverUrl('/ws/pair', { protocol: 'https:', host: 'pc:9443' })).toBe('wss://pc:9443/ws/pair');
  });

  it('completes the handshake and then talks encrypted both ways', () => {
    const { callbacks, connection } = setup();
    connection.start();
    connection.start();

    expect(connection.sendJson({ type: 'early' })).toBe(false);

    const server = FakeServer.accept(FakeSocket.latest());

    expect(FakeSocket.instances.filter((socket) => socket.url === SESSION_URL)).toHaveLength(1);
    expect(FakeSocket.latest().binaryType).toBe('arraybuffer');
    expect(FakeSocket.latest().lastSentJson().type).toBe('ready');
    expect(callbacks.onPhase).toHaveBeenLastCalledWith('open');
    expect(connection.isOpen).toBe(true);

    server.pushJson({ type: 'status' });
    server.pushFrame(Uint8Array.of(1, 2, 3));
    connection.sendJson({ type: 'camera-start' });
    connection.sendFrame(Uint8Array.of(9));

    expect(callbacks.onJson).toHaveBeenCalledWith({ type: 'status' });
    expect(callbacks.onFrame).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
    expect(server.received().map((message) => message.kind)).toEqual([KIND_JSON, 2]);
    expect(server.received()[0]?.json).toEqual({ type: 'camera-start' });
  });

  it('ignores encrypted JSON that is not an object and unknown kinds', () => {
    const { callbacks, connection } = setup();
    connection.start();
    const server = FakeServer.accept(FakeSocket.latest());

    server.pushFrame(new TextEncoder().encode('[1]'), KIND_JSON);
    server.pushFrame(Uint8Array.of(1), 9);

    expect(callbacks.onJson).not.toHaveBeenCalled();
    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(FakeSocket.latest().closed).toBe(false);
  });

  it('closes on a message that does not decrypt, then reconnects after the delay', () => {
    const { callbacks, connection } = setup();
    connection.start();
    FakeServer.accept(FakeSocket.latest());
    const first = FakeSocket.latest();

    first.receive(new Uint8Array(40).buffer);

    expect(first.closed).toBe(true);
    expect(callbacks.onPhase).toHaveBeenLastCalledWith('lost');
    expect(connection.isOpen).toBe(false);
    expect(connection.sendFrame(Uint8Array.of(1))).toBe(false);

    vi.advanceTimersByTime(RECONNECT_DELAY_MS);

    expect(FakeSocket.latest()).not.toBe(first);
    expect(callbacks.onPhase).toHaveBeenLastCalledWith('connecting');
  });

  it('closes on a bad welcome or an unexpected text message', () => {
    const { connection } = setup();
    connection.start();
    const socket = FakeSocket.latest();
    socket.open();

    socket.receiveJson({ type: 'something-else' });

    expect(socket.closed).toBe(true);

    vi.advanceTimersByTime(RECONNECT_DELAY_MS);
    const next = FakeSocket.latest();
    next.receive('not json');

    expect(next.closed).toBe(true);
  });

  it('stops reconnecting when the PC says the device is not paired', () => {
    const { callbacks, connection } = setup();
    connection.start();
    const socket = FakeSocket.latest();
    socket.open();

    socket.receiveJson({ type: 'unpaired' });
    vi.advanceTimersByTime(RECONNECT_DELAY_MS * 2);

    expect(callbacks.onPhase).toHaveBeenLastCalledWith('unpaired');
    expect(FakeSocket.latest()).toBe(socket);
  });

  it('stop closes the socket, cancels a pending reconnect and reports buffered bytes', () => {
    const { connection } = setup();

    expect(connection.bufferedAmount).toBe(0);

    connection.start();
    FakeSocket.latest().bufferedAmount = 42;

    expect(connection.bufferedAmount).toBe(42);

    FakeSocket.latest().close();
    connection.stop();
    connection.stop();
    vi.advanceTimersByTime(RECONNECT_DELAY_MS * 2);

    expect(FakeSocket.latest().closed).toBe(true);
  });

  it('ignores binary data before the handshake ends', () => {
    const { callbacks, connection } = setup();
    connection.start();
    FakeSocket.latest().open();

    FakeSocket.latest().receive(new Uint8Array(40).buffer);

    expect(FakeSocket.latest().closed).toBe(false);
    expect(callbacks.onFrame).not.toHaveBeenCalled();
  });

  it('uses the browser WebSocket when no factory is given', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const connection = new SecureConnection(SESSION_URL, TEST_CREDENTIAL, {
      onPhase: vi.fn(),
      onJson: vi.fn(),
      onFrame: vi.fn(),
    });

    connection.start();

    expect(FakeSocket.latest().url).toBe(SESSION_URL);
    connection.stop();
    vi.unstubAllGlobals();
  });

  it('ignores the close of a socket it already replaced', () => {
    const { callbacks, connection } = setup();
    connection.start();
    const first = FakeSocket.latest();
    connection.stop();
    connection.start();
    vi.mocked(callbacks.onPhase).mockClear();

    first.onclose?.();

    expect(callbacks.onPhase).not.toHaveBeenCalled();
  });
});
