import { readJson, writeJson } from '@/lib/storage';

/*
 * What the camera device sends: canvas size, frames per second and JPEG quality. The PC webcam keeps its own
 * size (ffmpeg scales), so a smaller canvas trades sharpness for less Wi-Fi and less CPU on the phone.
 */
export interface Resolution {
  label: string;
  width: number;
  height: number;
}

export interface QualitySettings {
  resolution: string;
  fps: number;
  jpegQuality: number;
}

export const RESOLUTIONS: readonly Resolution[] = [
  { label: '360p', width: 640, height: 360 },
  { label: '540p', width: 960, height: 540 },
  { label: '720p', width: 1280, height: 720 },
];
export const FPS_OPTIONS: readonly number[] = [10, 15, 20, 25, 30];
export const JPEG_QUALITY_MIN = 0.3;
export const JPEG_QUALITY_MAX = 0.95;
export const JPEG_QUALITY_STEP = 0.05;
export const DEFAULT_QUALITY: Readonly<QualitySettings> = { resolution: '720p', fps: 25, jpegQuality: 0.6 };

const STORAGE_NAME = 'quality';
const DEFAULT_RESOLUTION: Resolution = { label: '720p', width: 1280, height: 720 };
const BYTES_PER_KILOBYTE = 1024;

export const resolutionOf = (settings: QualitySettings): Resolution =>
  RESOLUTIONS.find((resolution) => resolution.label === settings.resolution) ?? DEFAULT_RESOLUTION;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function sanitizeQuality(value: unknown): QualitySettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_QUALITY };
  }
  const resolution = RESOLUTIONS.some((option) => option.label === value.resolution)
    ? String(value.resolution)
    : DEFAULT_QUALITY.resolution;
  const fps = typeof value.fps === 'number' && FPS_OPTIONS.includes(value.fps) ? value.fps : DEFAULT_QUALITY.fps;
  const jpegQuality =
    typeof value.jpegQuality === 'number'
      ? Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, value.jpegQuality))
      : DEFAULT_QUALITY.jpegQuality;

  return { resolution, fps, jpegQuality };
}

export const loadQuality = (): QualitySettings => sanitizeQuality(readJson('local', STORAGE_NAME));

export const saveQuality = (settings: QualitySettings): void => writeJson('local', STORAGE_NAME, settings);

export const percentLabel = (fraction: number): string => `${Math.round(fraction * 100)}%`;

export function bandwidthLabel(averageFrameBytes: number | null, fps: number): string | null {
  if (averageFrameBytes === null) {
    return null;
  }
  const perFrame = averageFrameBytes / BYTES_PER_KILOBYTE;

  return `${perFrame.toFixed(0)} KB/frame · ${(perFrame * fps).toFixed(0)} KB/s`;
}
