/*
 * Messages the server (server.py, access.py) sends inside the encrypted session. Every field is read
 * here and nowhere else; anything malformed is dropped.
 */
export type Access = 'none' | 'pending' | 'approved' | 'denied';
export type PeerRole = 'camera' | 'watching' | 'pending' | 'denied' | 'idle';
export type RequestState = 'pending' | 'approved' | 'denied';
export type Decision = 'approve' | 'deny' | 'revoke';

export interface ViewerStatus {
  camera: boolean;
  streaming: boolean;
  access: Access;
  code: string | null;
}

export interface Peer {
  ip: string;
  device: string;
  role: PeerRole;
  you: boolean;
}

export interface NetworkPanelData {
  you: string;
  server: string;
  router: string | null;
  camera: { ip: string; device: string } | null;
  peers: Peer[];
}

export interface WatchRequest {
  id: string;
  code: string;
  ip: string;
  device: string;
  state: RequestState;
  connected: boolean;
}

export type ServerMessage =
  | { type: 'status'; status: ViewerStatus }
  | { type: 'network'; network: NetworkPanelData }
  | { type: 'requests'; requests: WatchRequest[] }
  | { type: 'camera-stopped'; reason: string }
  | { type: 'camera-error' };

const ACCESS_VALUES: readonly string[] = ['none', 'pending', 'approved', 'denied'];
const ROLE_VALUES: readonly string[] = ['camera', 'watching', 'pending', 'denied', 'idle'];
const REQUEST_STATES: readonly string[] = ['pending', 'approved', 'denied'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function parseStatus(message: Record<string, unknown>): ViewerStatus | null {
  const { camera, streaming, access, code } = message;
  if (typeof camera !== 'boolean' || typeof streaming !== 'boolean' || !ACCESS_VALUES.includes(String(access))) {
    return null;
  }

  return { camera, streaming, access: access as Access, code: text(code) };
}

function parsePeer(value: unknown): Peer | null {
  if (!isRecord(value) || !ROLE_VALUES.includes(String(value.role)) || typeof value.you !== 'boolean') {
    return null;
  }
  const ip = text(value.ip);
  const device = text(value.device);
  if (ip === null || device === null) {
    return null;
  }

  return { ip, device, role: value.role as PeerRole, you: value.you };
}

function parseNetwork(message: Record<string, unknown>): NetworkPanelData | null {
  const you = text(message.you);
  const server = text(message.server);
  if (you === null || server === null || !Array.isArray(message.peers)) {
    return null;
  }
  const camera = isRecord(message.camera)
    ? { ip: text(message.camera.ip) ?? '', device: text(message.camera.device) ?? '' }
    : null;
  const peers = message.peers.map(parsePeer).filter((peer): peer is Peer => peer !== null);

  return {
    you,
    server,
    router: text(message.router),
    camera,
    peers,
  };
}

function parseRequest(value: unknown): WatchRequest | null {
  if (!isRecord(value) || !REQUEST_STATES.includes(String(value.state)) || typeof value.connected !== 'boolean') {
    return null;
  }
  const fields = [value.id, value.code, value.ip, value.device].map(text);
  const [id, code, ip, device] = fields;
  if (id == null || code == null || ip == null || device == null) {
    return null;
  }

  return { id, code, ip, device, state: value.state as RequestState, connected: value.connected };
}

export function parseServerMessage(message: Record<string, unknown>): ServerMessage | null {
  switch (message.type) {
    case 'status': {
      const status = parseStatus(message);

      return status ? { type: 'status', status } : null;
    }
    case 'network': {
      const network = parseNetwork(message);

      return network ? { type: 'network', network } : null;
    }
    case 'requests':
      return Array.isArray(message.requests)
        ? {
            type: 'requests',
            requests: message.requests.map(parseRequest).filter((request): request is WatchRequest => request !== null),
          }
        : null;
    case 'camera-stopped':
      return { type: 'camera-stopped', reason: text(message.reason) ?? '' };
    case 'camera-error':
      return { type: 'camera-error' };
    default:
      return null;
  }
}

export const watchRequestMessage = (key: string): object => ({ type: 'request', key });

export const decisionMessage = (id: string, decision: Decision): object => ({ type: 'decide', id, decision });

export const CAMERA_START = { type: 'camera-start' } as const;
export const CAMERA_STOP = { type: 'camera-stop' } as const;
