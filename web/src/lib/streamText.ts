import type { Translate } from '@/lib/i18n';

export type StatusKind = '' | 'ok' | 'warn' | 'err';

export interface StatusMessage {
  text: string;
  kind: StatusKind;
}

export function cameraListStatus(t: Translate, cameraCount: number, streaming: boolean): StatusMessage {
  const multipleCameras = cameraCount > 1;
  if (streaming) {
    return { text: t('{count} camera(s) found - streaming', { count: cameraCount }), kind: 'ok' };
  }

  return { text: t('{count} camera(s) found', { count: cameraCount }), kind: multipleCameras ? 'ok' : '' };
}

export function previewStatus(t: Translate, cameraLabel: string, streaming: boolean): StatusMessage {
  if (streaming) {
    return { text: t('Streaming - {camera}', { camera: cameraLabel }), kind: 'ok' };
  }

  return { text: t('Previewing - {camera}', { camera: cameraLabel }), kind: '' };
}

export function cameraFailureStatus(t: Translate, reason: string, revertedToPrevious: boolean): StatusMessage {
  if (revertedToPrevious) {
    return { text: t('That camera did not open ({reason}). Back to the previous one.', { reason }), kind: 'err' };
  }

  return { text: t('That camera did not open ({reason}). None available.', { reason }), kind: 'err' };
}

export const fitButtonLabel = (t: Translate, fit: 'contain' | 'cover'): string =>
  fit === 'cover' ? t('Crop ✓') : t('Fit ✓');

export const zoomLabel = (zoom: number): string => `${zoom.toFixed(1)}x`;
