import { translator } from '@/lib/i18n';
import type { ViewerStatus } from '@/lib/protocol';
import { framesPerSecond, watchMessages, watchPhase } from '@/lib/watchText';

const t = translator('en');
const status = (overrides: Partial<ViewerStatus>): ViewerStatus => ({
  camera: true,
  streaming: false,
  access: 'none',
  code: null,
  ...overrides,
});

describe('watch phase', () => {
  it.each([
    ['lost', null, false, 'lost'],
    ['connecting', null, false, 'connecting'],
    ['open', null, false, 'connecting'],
    ['open', status({ access: 'none' }), false, 'not-requested'],
    ['open', status({ access: 'pending' }), false, 'pending'],
    ['open', status({ access: 'denied' }), false, 'denied'],
    ['open', status({ access: 'approved', camera: false }), false, 'no-camera'],
    ['open', status({ access: 'approved' }), false, 'waiting'],
    ['open', status({ access: 'approved' }), true, 'live'],
  ] as const)('connection %s with %j and frame %s is %s', (connection, viewerStatus, hasFrame, expected) => {
    expect(watchPhase(connection, viewerStatus, hasFrame)).toBe(expected);
  });
});

describe('watch texts', () => {
  it.each([
    ['connecting', { placeholder: 'Connecting…', status: 'Connecting…', kind: '' }],
    ['lost', { placeholder: 'Lost the connection to the PC. Trying again…', status: 'Reconnecting…', kind: 'err' }],
    [
      'not-requested',
      {
        placeholder: 'Ask to watch: the camera device sees your code and approves it.',
        status: 'No permission yet',
        kind: '',
      },
    ],
    [
      'pending',
      {
        placeholder: 'Waiting for the camera device to approve code ab12-cd34.',
        status: 'Request sent - code ab12-cd34',
        kind: 'warn',
      },
    ],
    ['denied', { placeholder: 'The camera device denied code ab12-cd34.', status: 'Denied', kind: 'err' }],
    [
      'no-camera',
      { placeholder: 'Approved. No camera is streaming right now.', status: 'Waiting for the camera…', kind: 'warn' },
    ],
    ['waiting', { placeholder: null, status: 'Approved, waiting for frames…', kind: 'ok' }],
  ] as const)('phase %s', (phase, expected) => {
    expect(watchMessages(t, phase, 'ab12cd34', null)).toEqual(expected);
  });

  it('shows "?" without a code and the frame rate once measured', () => {
    expect(watchMessages(t, 'pending', null, null).status).toBe('Request sent - code ?');
    expect(watchMessages(t, 'live', null, null).status).toBe('🟢 Live');
    expect(watchMessages(t, 'live', null, 24)).toEqual({ placeholder: null, status: '🟢 Live - 24 fps', kind: 'ok' });
  });

  it('measures frames per second over the elapsed time', () => {
    expect(framesPerSecond(25, 1000)).toBe(25);
    expect(framesPerSecond(12, 1500)).toBe(8);
  });
});
