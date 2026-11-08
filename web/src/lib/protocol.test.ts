import { CAMERA_START, CAMERA_STOP, decisionMessage, parseServerMessage, watchRequestMessage } from '@/lib/protocol';

const PEER = { ip: '192.168.0.20', device: 'UA', role: 'watching', you: true };
const NETWORK = {
  type: 'network',
  you: '192.168.0.20',
  server: '192.168.0.10',
  router: null,
  camera: { ip: '192.168.0.30', device: 'Phone' },
  peers: [
    PEER,
    { ip: 7 },
    { ip: 7, device: 'UA', role: 'idle', you: false },
    { ip: '192.168.0.9', device: null, role: 'idle', you: false },
  ],
};
const REQUEST = {
  id: 'f'.repeat(64),
  code: 'ffffffff',
  ip: '192.168.0.20',
  device: 'UA',
  state: 'pending',
  connected: true,
};

describe('server messages', () => {
  it('reads the viewer status', () => {
    expect(
      parseServerMessage({ type: 'status', camera: true, streaming: false, access: 'pending', code: 'ab12cd34' }),
    ).toEqual({ type: 'status', status: { camera: true, streaming: false, access: 'pending', code: 'ab12cd34' } });
  });

  it('reads the network panel and drops malformed peers', () => {
    expect(parseServerMessage(NETWORK)).toEqual({
      type: 'network',
      network: {
        you: '192.168.0.20',
        server: '192.168.0.10',
        router: null,
        camera: { ip: '192.168.0.30', device: 'Phone' },
        peers: [PEER],
      },
    });
  });

  it('reads a network without a camera and a camera with missing fields', () => {
    const withoutCamera = parseServerMessage({ ...NETWORK, camera: null, peers: [] });
    const partialCamera = parseServerMessage({ ...NETWORK, camera: {} });

    expect(withoutCamera?.type === 'network' && withoutCamera.network.camera).toBeNull();
    expect(partialCamera?.type === 'network' && partialCamera.network.camera).toEqual({ ip: '', device: '' });
  });

  it('reads the requests and drops malformed ones', () => {
    expect(
      parseServerMessage({
        type: 'requests',
        requests: [
          REQUEST,
          { ...REQUEST, state: 'maybe' },
          { ...REQUEST, ip: 5 },
          { ...REQUEST, id: null },
          { ...REQUEST, code: null },
          { ...REQUEST, device: null },
          { ...REQUEST, connected: 'yes' },
        ],
      }),
    ).toEqual({ type: 'requests', requests: [REQUEST] });
  });

  it('reads the camera messages', () => {
    expect(parseServerMessage({ type: 'camera-stopped', reason: 'taken' })).toEqual({
      type: 'camera-stopped',
      reason: 'taken',
    });
    expect(parseServerMessage({ type: 'camera-stopped' })).toEqual({ type: 'camera-stopped', reason: '' });
    expect(parseServerMessage({ type: 'camera-error' })).toEqual({ type: 'camera-error' });
  });

  it.each([
    ['an unknown type', { type: 'other' }],
    ['a status with a wrong field', { type: 'status', camera: 'yes', streaming: false, access: 'none' }],
    ['a status with an unknown access', { type: 'status', camera: true, streaming: false, access: 'maybe' }],
    ['a network without peers', { ...NETWORK, peers: null }],
    ['requests that are not a list', { type: 'requests', requests: {} }],
  ])('ignores %s', (_description, message) => {
    expect(parseServerMessage(message)).toBeNull();
  });

  it('builds the messages the server expects', () => {
    expect(watchRequestMessage('ab')).toEqual({ type: 'request', key: 'ab' });
    expect(decisionMessage('id', 'revoke')).toEqual({ type: 'decide', id: 'id', decision: 'revoke' });
    expect(CAMERA_START).toEqual({ type: 'camera-start' });
    expect(CAMERA_STOP).toEqual({ type: 'camera-stop' });
  });
});
