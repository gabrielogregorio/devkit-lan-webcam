import type { Translate } from '@/lib/i18n';
import type { ViewerStatus } from '@/lib/protocol';
import { formatRequestCode } from '@/lib/requestCode';
import type { ConnectionPhase } from '@/lib/secureConnection';
import type { StatusKind } from '@/lib/streamText';

export type WatchPhase =
  'connecting' | 'lost' | 'not-requested' | 'pending' | 'denied' | 'no-camera' | 'waiting' | 'live';

export interface WatchMessages {
  placeholder: string | null;
  status: string;
  kind: StatusKind;
}

const MILLISECONDS_PER_SECOND = 1000;

export function watchPhase(connection: ConnectionPhase, status: ViewerStatus | null, hasFrame: boolean): WatchPhase {
  if (connection === 'lost') {
    return 'lost';
  }
  if (connection !== 'open' || status === null) {
    return 'connecting';
  }
  if (status.access === 'none') {
    return 'not-requested';
  }
  if (status.access !== 'approved') {
    return status.access;
  }
  if (!status.camera) {
    return 'no-camera';
  }

  return hasFrame ? 'live' : 'waiting';
}

export function watchMessages(
  t: Translate,
  phase: WatchPhase,
  requestCode: string | null,
  framesPerSecond: number | null,
): WatchMessages {
  const code = requestCode ? formatRequestCode(requestCode) : '?';
  switch (phase) {
    case 'connecting':
      return { placeholder: t('Connecting…'), status: t('Connecting…'), kind: '' };
    case 'lost':
      return {
        placeholder: t('Lost the connection to the PC. Trying again…'),
        status: t('Reconnecting…'),
        kind: 'err',
      };
    case 'not-requested':
      return {
        placeholder: t('Ask to watch: the camera device sees your code and approves it.'),
        status: t('No permission yet'),
        kind: '',
      };
    case 'pending':
      return {
        placeholder: t('Waiting for the camera device to approve.'),
        status: t('Request sent - code {code}', { code }),
        kind: 'warn',
      };
    case 'denied':
      return { placeholder: t('The camera device denied the request.'), status: t('Denied'), kind: 'err' };
    case 'no-camera':
      return {
        placeholder: t('Approved. No camera is streaming right now.'),
        status: t('Waiting for the camera…'),
        kind: 'warn',
      };
    case 'waiting':
      return { placeholder: null, status: t('Approved, waiting for frames…'), kind: 'ok' };
    case 'live':
      return { placeholder: null, status: liveStatus(t, framesPerSecond), kind: 'ok' };
  }
}

function liveStatus(t: Translate, framesPerSecond: number | null): string {
  if (framesPerSecond === null) {
    return t('Live');
  }

  return t('Live - {fps} fps', { fps: framesPerSecond });
}

export const framesPerSecond = (frameCount: number, elapsedMilliseconds: number): number =>
  Math.round((frameCount * MILLISECONDS_PER_SECOND) / elapsedMilliseconds);
