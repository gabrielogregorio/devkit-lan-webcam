/*
 * Framing of the camera on the canvas that is sent: only state and math, no DOM.
 * The canvas applies computeDrawParams in this order:
 *
 *   ctx.translate(translateX, translateY)
 *   ctx.rotate(rotation * PI/180)
 *   ctx.scale(mirrorX, 1)
 *   ctx.drawImage(video, -drawWidth/2, -drawHeight/2, drawWidth, drawHeight)
 */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 5;
const FULL_TURN_DEGREES = 360;
const ROTATION_STEP_DEGREES = 90;
const QUARTER_TURN_DEGREES = 90;
const THREE_QUARTER_TURN_DEGREES = 270;
// A twist that ends this close to a quarter turn lands on it: an upright picture is easy to get back.
export const ROTATION_SNAP_DEGREES = 6;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export type FitMode = 'contain' | 'cover';

export interface ViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
  mirror: boolean;
  rotation: number;
  fit: FitMode;
}

export interface DrawParams {
  rotation: number;
  swapsAxes: boolean;
  baseScale: number;
  scale: number;
  drawWidth: number;
  drawHeight: number;
  translateX: number;
  translateY: number;
  mirrorX: 1 | -1;
}

export const DEFAULT_VIEW: Readonly<ViewState> = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  mirror: false,
  rotation: 0,
  fit: 'contain',
};

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const normalizeRotation = (rotation: number): number =>
  ((rotation % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

export const resetView = (): ViewState => ({ ...DEFAULT_VIEW });

export const toggleMirror = (view: ViewState): ViewState => ({ ...view, mirror: !view.mirror });

// The button goes to the next quarter turn, also from a free angle left by a twist.
export const cycleRotation = (view: ViewState): ViewState => ({
  ...view,
  rotation: normalizeRotation(
    (Math.floor(normalizeRotation(view.rotation) / ROTATION_STEP_DEGREES) + 1) * ROTATION_STEP_DEGREES,
  ),
});

/** Whole degrees, snapped to the nearest quarter turn when within ROTATION_SNAP_DEGREES of it. */
export function snapRotation(degrees: number): number {
  const nearestQuarter = Math.round(degrees / ROTATION_STEP_DEGREES) * ROTATION_STEP_DEGREES;
  const snapped = Math.abs(degrees - nearestQuarter) <= ROTATION_SNAP_DEGREES ? nearestQuarter : Math.round(degrees);

  return normalizeRotation(snapped);
}

export const setRotation = (view: ViewState, degrees: number): ViewState => ({
  ...view,
  rotation: snapRotation(degrees),
});

/** The angle of the line between two fingers, in degrees (screen y grows downwards, so clockwise is positive). */
export const fingerAngle = (deltaX: number, deltaY: number): number => Math.atan2(deltaY, deltaX) * RADIANS_TO_DEGREES;

export const toggleFit = (view: ViewState): ViewState => ({
  ...view,
  fit: view.fit === 'cover' ? 'contain' : 'cover',
});

export const panBy = (view: ViewState, deltaX: number, deltaY: number): ViewState => ({
  ...view,
  offsetX: view.offsetX + deltaX,
  offsetY: view.offsetY + deltaY,
});

export const scaleOffsets = (view: ViewState, factor: number): ViewState => ({
  ...view,
  offsetX: view.offsetX * factor,
  offsetY: view.offsetY * factor,
});

export const setZoom = (view: ViewState, zoom: number): ViewState => ({
  ...view,
  zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX),
});

export const zoomFromPinch = (startZoom: number, startDistance: number, currentDistance: number): number =>
  clamp((startZoom * currentDistance) / startDistance, ZOOM_MIN, ZOOM_MAX);

export function computeDrawParams(
  view: ViewState,
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): DrawParams {
  const rotation = normalizeRotation(view.rotation);
  const swapsAxes = rotation === QUARTER_TURN_DEGREES || rotation === THREE_QUARTER_TURN_DEGREES;
  const availableWidth = swapsAxes ? canvasHeight : canvasWidth;
  const availableHeight = swapsAxes ? canvasWidth : canvasHeight;
  const widthRatio = availableWidth / videoWidth;
  const heightRatio = availableHeight / videoHeight;
  const baseScale = view.fit === 'cover' ? Math.max(widthRatio, heightRatio) : Math.min(widthRatio, heightRatio);
  const scale = baseScale * view.zoom;

  return {
    rotation,
    swapsAxes,
    baseScale,
    scale,
    drawWidth: videoWidth * scale,
    drawHeight: videoHeight * scale,
    translateX: canvasWidth / 2 + view.offsetX,
    translateY: canvasHeight / 2 + view.offsetY,
    mirrorX: view.mirror ? -1 : 1,
  };
}
