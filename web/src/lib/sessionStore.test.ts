import { forgetCredential, loadCredential, newWatchKey, saveCredential } from '@/lib/credentialStore';
import { SessionStore } from '@/lib/sessionStore';
import { storageKey } from '@/lib/storage';
import { FakeServer, FakeSocket, TEST_CREDENTIAL, fakeSocketFactory } from '@/testDoubles';

const NETWORK = {
  type: 'network',
  you: '192.168.0.20',
  server: '192.168.0.10',
  router: '192.168.0.1',
  camera: null,
  peers: [],
};

function pairedStore(): SessionStore {
  saveCredential(TEST_CREDENTIAL);

  return new SessionStore({ createSocket: fakeSocketFactory });
}

describe('SessionStore', () => {
  afterEach(() => {
    forgetCredential();
    window.sessionStorage.removeItem(storageKey('watch-key'));
  });

  it('starts unpaired without a credential', () => {
    const store = new SessionStore({ createSocket: fakeSocketFactory });
    const listener = vi.fn();
    store.subscribe(listener);

    store.start();

    expect(store.getSnapshot().phase).toBe('unpaired');
    expect(listener).toHaveBeenCalled();
    expect(store.isOpen).toBe(false);
    expect(store.bufferedAmount).toBe(0);
    expect(store.sendJson({})).toBe(false);
    expect(store.sendFrame(Uint8Array.of(1))).toBe(false);
  });

  it('connects with the saved credential and keeps status, network and requests', () => {
    const store = pairedStore();
    const messages = vi.fn();
    store.onMessage(messages);
    store.start();
    const server = FakeServer.accept(FakeSocket.latest());

    server.pushJson({ type: 'status', camera: true, streaming: false, access: 'none', code: null });
    server.pushJson(NETWORK);
    server.pushJson({ type: 'requests', requests: [] });
    server.pushJson({ type: 'camera-error' });
    server.pushJson({ type: 'nonsense' });

    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe('open');
    expect(snapshot.status?.camera).toBe(true);
    expect(snapshot.network?.server).toBe('192.168.0.10');
    expect(snapshot.requests).toEqual([]);
    expect(messages).toHaveBeenCalledTimes(4);
    expect(store.isOpen).toBe(true);
  });

  it('passes frames to the listeners until they unsubscribe', () => {
    const store = pairedStore();
    const frames = vi.fn();
    const unsubscribe = store.onFrame(frames);
    store.start();
    const server = FakeServer.accept(FakeSocket.latest());

    server.pushFrame(Uint8Array.of(7));
    unsubscribe();
    server.pushFrame(Uint8Array.of(8));

    expect(frames).toHaveBeenCalledTimes(1);
  });

  it('asks to watch with the tab key, and with a fresh key after a denial', () => {
    const store = pairedStore();
    store.start();
    const server = FakeServer.accept(FakeSocket.latest());

    store.requestToWatch(false);
    store.requestToWatch(false);
    store.requestToWatch(true);
    store.decide('abc', 'approve');

    const sent = server.received().map((message) => message.json);
    expect(sent[0]?.key).toBe(sent[1]?.key);
    expect(sent[2]?.key).not.toBe(sent[0]?.key);
    expect(sent[3]).toEqual({ type: 'decide', id: 'abc', decision: 'approve' });
  });

  it('asks again on reconnect when the tab had asked before', () => {
    const watchKey = newWatchKey();
    const store = pairedStore();
    store.start();

    const server = FakeServer.accept(FakeSocket.latest());

    expect(server.received()[0]?.json).toEqual({ type: 'request', key: watchKey.key });
  });

  it('forgets the credential when the PC no longer knows the device', () => {
    const store = pairedStore();
    store.start();
    const socket = FakeSocket.latest();
    socket.open();

    socket.receiveJson({ type: 'unpaired' });

    expect(store.getSnapshot().phase).toBe('unpaired');
    expect(loadCredential()).toBeNull();
  });

  it('pairs with a code and connects; a failed pairing keeps it unpaired', async () => {
    const pair = vi
      .fn()
      .mockResolvedValueOnce({ type: 'wrong-code' })
      .mockResolvedValueOnce({ type: 'paired', credential: TEST_CREDENTIAL });
    const store = new SessionStore({ createSocket: fakeSocketFactory, pair });
    store.start();

    await expect(store.pair('000000')).resolves.toEqual({ type: 'wrong-code' });
    expect(loadCredential()).toBeNull();

    await store.pair('123456');

    expect(loadCredential()).toEqual(TEST_CREDENTIAL);
    expect(store.getSnapshot().phase).toBe('connecting');
  });

  it('forget drops the session and the credential', () => {
    const store = pairedStore();
    store.start();
    const unsubscribe = store.subscribe(vi.fn());

    store.forget();
    unsubscribe();

    expect(store.getSnapshot().phase).toBe('unpaired');
    expect(loadCredential()).toBeNull();
  });

  it('opens the pairing socket with the browser WebSocket when no factory is given', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const store = new SessionStore();

    void store.pair('123456');

    expect(FakeSocket.latest().url).toBe(`ws://${window.location.host}/ws/pair`);
    vi.unstubAllGlobals();
  });

  it('pairs over the real pairing client by default', () => {
    const store = new SessionStore({ createSocket: fakeSocketFactory });

    void store.pair('123456');

    expect(FakeSocket.latest().url).toBe(`ws://${window.location.host}/ws/pair`);
  });
});
