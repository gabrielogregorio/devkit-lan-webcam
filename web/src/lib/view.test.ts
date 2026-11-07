import {
  DEFAULT_VIEW,
  ZOOM_MAX,
  ZOOM_MIN,
  clamp,
  computeDrawParams,
  cycleRotation,
  normalizeRotation,
  panBy,
  resetView,
  scaleOffsets,
  setZoom,
  toggleFit,
  toggleMirror,
  zoomFromPinch,
} from '@/lib/view';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FULL_HD_WIDTH = 1920;
const FULL_HD_HEIGHT = 1080;
const SQUARE_SIDE = 1000;

describe('view state', () => {
  it('resets to zoom 1, no pan or mirror, no rotation and contain, as a new copy', () => {
    const view = resetView();

    expect(view).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, mirror: false, rotation: 0, fit: 'contain' });
    expect(view).not.toBe(DEFAULT_VIEW);
  });

  it('mirror flips the drawing horizontally and toggles back', () => {
    const mirrored = toggleMirror(resetView());

    expect(computeDrawParams(resetView(), FULL_HD_WIDTH, FULL_HD_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT).mirrorX).toBe(1);
    expect(computeDrawParams(mirrored, FULL_HD_WIDTH, FULL_HD_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT).mirrorX).toBe(-1);
    expect(toggleMirror(mirrored).mirror).toBe(false);
  });

  it('rotation steps 90 degrees and wraps from 270 to 0', () => {
    const once = cycleRotation(resetView());
    const fourTimes = cycleRotation(cycleRotation(cycleRotation(once)));

    expect(once.rotation).toBe(90);
    expect(cycleRotation({ ...resetView(), rotation: 270 }).rotation).toBe(0);
    expect(fourTimes.rotation).toBe(0);
  });

  it.each([
    [-90, 270],
    [450, 90],
    [360, 0],
  ])('normalizes rotation %i to %i', (rotation, expected) => {
    expect(normalizeRotation(rotation)).toBe(expected);
  });

  it('contain scales by the smaller ratio and cover by the larger one', () => {
    const contain = computeDrawParams(resetView(), SQUARE_SIDE, SQUARE_SIDE, CANVAS_WIDTH, CANVAS_HEIGHT);
    const cover = computeDrawParams(toggleFit(resetView()), SQUARE_SIDE, SQUARE_SIDE, CANVAS_WIDTH, CANVAS_HEIGHT);

    expect(contain.baseScale).toBe(CANVAS_HEIGHT / SQUARE_SIDE);
    expect(cover.baseScale).toBe(CANVAS_WIDTH / SQUARE_SIDE);
    expect(toggleFit(toggleFit(resetView())).fit).toBe('contain');
  });

  it('zoom from the slider and from a pinch give the same value', () => {
    expect(setZoom(resetView(), 2).zoom).toBe(2);
    expect(zoomFromPinch(1, 100, 200)).toBe(2);
  });

  it('zoom is clamped to the limits on both inputs', () => {
    expect(setZoom(resetView(), 99).zoom).toBe(ZOOM_MAX);
    expect(setZoom(resetView(), 0).zoom).toBe(ZOOM_MIN);
    expect(zoomFromPinch(1, 100, 100_000)).toBe(ZOOM_MAX);
    expect(zoomFromPinch(1, 100_000, 100)).toBe(ZOOM_MIN);
    expect(clamp(ZOOM_MAX, ZOOM_MIN, ZOOM_MAX)).toBe(ZOOM_MAX);
  });

  it('zoom scales the drawn size linearly', () => {
    const atOne = computeDrawParams(resetView(), FULL_HD_WIDTH, FULL_HD_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT);
    const atTwo = computeDrawParams(
      setZoom(resetView(), 2),
      FULL_HD_WIDTH,
      FULL_HD_HEIGHT,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    expect(atTwo.drawWidth).toBeCloseTo(atOne.drawWidth * 2);
    expect(atTwo.drawHeight).toBeCloseTo(atOne.drawHeight * 2);
    expect(atTwo.scale).toBeCloseTo(atOne.baseScale * 2);
  });

  it('pan accumulates into the translation from the canvas center', () => {
    const view = panBy(panBy(resetView(), 40, -30), 10, 5);
    const params = computeDrawParams(view, FULL_HD_WIDTH, FULL_HD_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT);

    expect(params.translateX).toBe(CANVAS_WIDTH / 2 + 50);
    expect(params.translateY).toBe(CANVAS_HEIGHT / 2 - 25);
  });

  it.each([90, 270])('rotation %i swaps width and height in the scale', (rotation) => {
    const params = computeDrawParams(
      { ...resetView(), rotation },
      FULL_HD_WIDTH,
      FULL_HD_HEIGHT,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    expect(params.swapsAxes).toBe(true);
    expect(params.baseScale).toBe(Math.min(CANVAS_HEIGHT / FULL_HD_WIDTH, CANVAS_WIDTH / FULL_HD_HEIGHT));
  });

  it('rotation 180 keeps the axes', () => {
    const params = computeDrawParams(
      { ...resetView(), rotation: 180 },
      FULL_HD_WIDTH,
      FULL_HD_HEIGHT,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    expect(params.swapsAxes).toBe(false);
  });

  it('scaling the canvas scales the pan offsets and keeps the rest', () => {
    const view = { ...panBy(resetView(), 40, -20), zoom: 2 };

    expect(scaleOffsets(view, 0.5)).toEqual({ ...view, offsetX: 20, offsetY: -10 });
  });

  it('never mutates the view it receives', () => {
    const view = resetView();
    const snapshot = { ...view };
    toggleMirror(view);
    cycleRotation(view);
    toggleFit(view);
    setZoom(view, 3);
    panBy(view, 10, 10);

    expect(view).toEqual(snapshot);
  });
});
