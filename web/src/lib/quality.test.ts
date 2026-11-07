import {
  DEFAULT_QUALITY,
  JPEG_QUALITY_MAX,
  JPEG_QUALITY_MIN,
  bandwidthLabel,
  loadQuality,
  percentLabel,
  resolutionOf,
  sanitizeQuality,
  saveQuality,
} from '@/lib/quality';
import { storageKey } from '@/lib/storage';

describe('quality settings', () => {
  afterEach(() => {
    window.localStorage.removeItem(storageKey('quality'));
  });

  it('starts at 720p, 25 fps and 60%', () => {
    expect(loadQuality()).toEqual({ resolution: '720p', fps: 25, jpegQuality: 0.6 });
    expect(resolutionOf(DEFAULT_QUALITY)).toEqual({ label: '720p', width: 1280, height: 720 });
  });

  it('saves and loads the choice', () => {
    saveQuality({ resolution: '360p', fps: 15, jpegQuality: 0.4 });

    expect(loadQuality()).toEqual({ resolution: '360p', fps: 15, jpegQuality: 0.4 });
    expect(resolutionOf(loadQuality())).toEqual({ label: '360p', width: 640, height: 360 });
  });

  it('falls back on anything stored that is not a valid choice', () => {
    expect(sanitizeQuality('text')).toEqual(DEFAULT_QUALITY);
    expect(sanitizeQuality({ resolution: '4k', fps: 7, jpegQuality: 'high' })).toEqual(DEFAULT_QUALITY);
    expect(sanitizeQuality({ resolution: '540p', fps: 30, jpegQuality: 2 }).jpegQuality).toBe(JPEG_QUALITY_MAX);
    expect(sanitizeQuality({ jpegQuality: 0 }).jpegQuality).toBe(JPEG_QUALITY_MIN);
    expect(resolutionOf({ ...DEFAULT_QUALITY, resolution: '4k' }).label).toBe('720p');
  });

  it('labels the quality and the measured bandwidth', () => {
    expect(percentLabel(0.65)).toBe('65%');
    expect(bandwidthLabel(null, 25)).toBeNull();
    expect(bandwidthLabel(40 * 1024, 25)).toBe('40 KB/frame · 1000 KB/s');
  });
});
