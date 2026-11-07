import { translator } from '@/lib/i18n';
import { cameraFailureStatus, cameraListStatus, fitButtonLabel, previewStatus, zoomLabel } from '@/lib/streamText';

const t = translator('en');

describe('stream page texts', () => {
  it.each([
    [1, false, { text: '1 camera(s) found', kind: '' }],
    [2, false, { text: '2 camera(s) found', kind: 'ok' }],
    [2, true, { text: '2 camera(s) found - 🟢 streaming', kind: 'ok' }],
  ])('%i camera(s), streaming %s', (count, streaming, expected) => {
    expect(cameraListStatus(t, count, streaming)).toEqual(expected);
  });

  it('describes the preview and the streaming', () => {
    expect(previewStatus(t, 'Back camera', false)).toEqual({ text: '👁️ Previewing - Back camera', kind: '' });
    expect(previewStatus(t, 'Back camera', true)).toEqual({ text: '🟢 Streaming - Back camera', kind: 'ok' });
  });

  it('says whether a failed camera fell back to the previous one', () => {
    expect(cameraFailureStatus(t, 'NotReadableError', true).text).toBe(
      'That camera did not open (NotReadableError). Back to the previous one.',
    );
    expect(cameraFailureStatus(t, 'NotReadableError', false)).toEqual({
      text: 'That camera did not open (NotReadableError). None available.',
      kind: 'err',
    });
  });

  it('labels the fit button and the zoom', () => {
    expect(fitButtonLabel(t, 'contain')).toBe('Fit ✓');
    expect(fitButtonLabel(t, 'cover')).toBe('Crop ✓');
    expect(zoomLabel(1.25)).toBe('1.3x');
  });
});
