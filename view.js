/*
 * Lógica pura de "view-state": sem DOM e sem canvas, só estado e matemática.
 * O index.html importa como ES module e tests/frontend/view.test.mjs importa o
 * mesmo arquivo no Node, então nada aqui pode depender do navegador.
 */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 5;

export const DEFAULT_VIEW = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  mirror: false,
  rotation: 0,
  fit: 'contain',
};

export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const normalizeRotation = (rotation) => ((rotation % 360) + 360) % 360;

export const resetView = () => ({ ...DEFAULT_VIEW });

export const toggleMirror = (view) => ({ ...view, mirror: !view.mirror });

export const cycleRotation = (view) => ({
  ...view,
  rotation: normalizeRotation(view.rotation + 90),
});

export const toggleFit = (view) => ({
  ...view,
  fit: view.fit === 'cover' ? 'contain' : 'cover',
});

export const panBy = (view, deltaX, deltaY) => ({
  ...view,
  offsetX: view.offsetX + deltaX,
  offsetY: view.offsetY + deltaY,
});

export const setZoom = (view, zoom) => ({ ...view, zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) });

export const zoomFromPinch = (startZoom, startDistance, currentDistance) =>
  clamp((startZoom * currentDistance) / startDistance, ZOOM_MIN, ZOOM_MAX);

/*
 * Traduz o view-state para os argumentos que o drawFrame() do index.html aplica,
 * nesta ordem:
 *
 *   ctx.translate(translateX, translateY)
 *   ctx.rotate(rotation * PI/180)
 *   ctx.scale(mirrorX, 1)
 *   ctx.drawImage(video, -drawWidth/2, -drawHeight/2, drawWidth, drawHeight)
 */
export function computeDrawParams(view, videoWidth, videoHeight, canvasWidth, canvasHeight) {
  const rotation = normalizeRotation(view.rotation);
  const swapsAxes = rotation === 90 || rotation === 270;
  const availableWidth = swapsAxes ? canvasHeight : canvasWidth;
  const availableHeight = swapsAxes ? canvasWidth : canvasHeight;
  const baseScale = view.fit === 'cover'
    ? Math.max(availableWidth / videoWidth, availableHeight / videoHeight)
    : Math.min(availableWidth / videoWidth, availableHeight / videoHeight);
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
