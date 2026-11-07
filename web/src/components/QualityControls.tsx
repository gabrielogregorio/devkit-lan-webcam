import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import {
  bandwidthLabel,
  FPS_OPTIONS,
  JPEG_QUALITY_MAX,
  JPEG_QUALITY_MIN,
  JPEG_QUALITY_STEP,
  percentLabel,
  RESOLUTIONS,
  type QualitySettings,
} from '@/lib/quality';

interface QualityControlsProps {
  settings: QualitySettings;
  averageFrameBytes: number | null;
  onChange: (settings: QualitySettings) => void;
}

export function QualityControls({ settings, averageFrameBytes, onChange }: Readonly<QualityControlsProps>): ReactNode {
  const measured = bandwidthLabel(averageFrameBytes, settings.fps);

  return (
    <fieldset className="quality">
      <legend>{t('Stream quality')}</legend>
      <div className="row">
        <label className="field">
          <span>{t('Resolution')}</span>
          <select
            value={settings.resolution}
            onChange={(event) => onChange({ ...settings, resolution: event.target.value })}>
            {RESOLUTIONS.map((resolution) => (
              <option key={resolution.label} value={resolution.label}>
                {resolution.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Frames per second')}</span>
          <select value={settings.fps} onChange={(event) => onChange({ ...settings, fps: Number(event.target.value) })}>
            {FPS_OPTIONS.map((fps) => (
              <option key={fps} value={fps}>
                {fps}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="zoomrow">
        <label htmlFor="jpegQuality">{t('Image quality')}</label>
        <input
          type="range"
          id="jpegQuality"
          min={JPEG_QUALITY_MIN}
          max={JPEG_QUALITY_MAX}
          step={JPEG_QUALITY_STEP}
          value={settings.jpegQuality}
          onChange={(event) => onChange({ ...settings, jpegQuality: Number(event.target.value) })}
        />
        <span className="zoom-value">{percentLabel(settings.jpegQuality)}</span>
      </div>
      <p className="hint">{measured ?? t('The size of each frame shows up while streaming.')}</p>
    </fieldset>
  );
}
