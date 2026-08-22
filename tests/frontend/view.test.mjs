import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW, ZOOM_MIN, ZOOM_MAX, clamp, normalizeRotation, resetView,
  toggleMirror, cycleRotation, toggleFit, setZoom, zoomFromPinch, panBy, computeDrawParams,
} from '../../view.js';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

test('reset volta ao default (testplan 6.7): zoom=1, sem pan/espelho, rotation=0, contain', () => {
  const view = resetView();
  assert.equal(view.zoom, 1);
  assert.equal(view.offsetX, 0);
  assert.equal(view.offsetY, 0);
  assert.equal(view.mirror, false);
  assert.equal(view.rotation, 0);
  assert.equal(view.fit, 'contain');
  assert.notEqual(view, DEFAULT_VIEW, 'reset devolve cópia nova, não a referência do default');
});

test('mirror inverte horizontal (mirrorX = -1) e alterna o flag', () => {
  let view = resetView();
  assert.equal(computeDrawParams(view, 1920, 1080, CANVAS_WIDTH, CANVAS_HEIGHT).mirrorX, 1);
  view = toggleMirror(view);
  assert.equal(view.mirror, true);
  assert.equal(computeDrawParams(view, 1920, 1080, CANVAS_WIDTH, CANVAS_HEIGHT).mirrorX, -1);
  view = toggleMirror(view);
  assert.equal(view.mirror, false);
});

test('rotation cicla 0->90->180->270->0 (testplan 6.5)', () => {
  let view = resetView();
  const rotations = [];
  for (let step = 0; step < 5; step++) {
    view = cycleRotation(view);
    rotations.push(view.rotation);
  }
  assert.deepEqual(rotations, [90, 180, 270, 0, 90]);
});

test('normalizeRotation normaliza negativos e maiores que 360', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(360), 0);
});

test('fit alterna contain (Math.min) <-> cover (Math.max) e a escala base bate', () => {
  const videoWidth = 1000;
  const videoHeight = 1000;
  let view = resetView();
  let drawParams = computeDrawParams(view, videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.equal(
    drawParams.baseScale,
    Math.min(CANVAS_WIDTH / videoWidth, CANVAS_HEIGHT / videoHeight),
  );
  assert.equal(drawParams.baseScale, CANVAS_HEIGHT / videoHeight);

  view = toggleFit(view);
  assert.equal(view.fit, 'cover');
  drawParams = computeDrawParams(view, videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.equal(
    drawParams.baseScale,
    Math.max(CANVAS_WIDTH / videoWidth, CANVAS_HEIGHT / videoHeight),
  );
  assert.equal(drawParams.baseScale, CANVAS_WIDTH / videoWidth);
});

test('cover preenche o canvas inteiro; contain cabe dentro', () => {
  const videoWidth = 1000;
  const videoHeight = 1000;
  const contain = computeDrawParams(resetView(), videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.ok(contain.drawWidth <= CANVAS_WIDTH + 1e-9 && contain.drawHeight <= CANVAS_HEIGHT + 1e-9);

  const cover = computeDrawParams(
    toggleFit(resetView()), videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT,
  );
  assert.ok(cover.drawWidth >= CANVAS_WIDTH - 1e-9 && cover.drawHeight >= CANVAS_HEIGHT - 1e-9);
});

test('zoom pelo slider e pela pinça produzem o MESMO estado', () => {
  const zoomViaSlider = setZoom(resetView(), 2).zoom;
  const zoomViaPinch = zoomFromPinch(1, 100, 200);
  assert.equal(zoomViaSlider, 2);
  assert.equal(zoomViaPinch, 2);
  assert.equal(zoomViaSlider, zoomViaPinch);
});

test('zoom faz clamp nos limites 0.3..5 (slider e pinça)', () => {
  assert.equal(setZoom(resetView(), 99).zoom, ZOOM_MAX);
  assert.equal(setZoom(resetView(), 0).zoom, ZOOM_MIN);
  assert.equal(zoomFromPinch(1, 100, 100000), ZOOM_MAX);
  assert.equal(zoomFromPinch(1, 100000, 100), ZOOM_MIN);
  assert.equal(clamp(7, ZOOM_MIN, ZOOM_MAX), ZOOM_MAX);
});

test('zoom escala as dimensões desenhadas linearmente', () => {
  const videoWidth = 1920;
  const videoHeight = 1080;
  const atZoom1 = computeDrawParams(resetView(), videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
  const atZoom2 = computeDrawParams(
    setZoom(resetView(), 2), videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT,
  );
  assert.ok(Math.abs(atZoom2.drawWidth - atZoom1.drawWidth * 2) < 1e-9);
  assert.ok(Math.abs(atZoom2.drawHeight - atZoom1.drawHeight * 2) < 1e-9);
});

test('pan desloca a translação (translateX, translateY) pelo offset acumulado', () => {
  let view = resetView();
  view = panBy(view, 40, -30);
  view = panBy(view, 10, 5);
  assert.equal(view.offsetX, 50);
  assert.equal(view.offsetY, -25);

  const drawParams = computeDrawParams(view, 1920, 1080, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.equal(drawParams.translateX, CANVAS_WIDTH / 2 + 50);
  assert.equal(drawParams.translateY, CANVAS_HEIGHT / 2 - 25);
});

test('rotation 90/270 troca largura<->altura no cálculo da escala', () => {
  const videoWidth = 1920;
  const videoHeight = 1080;
  const withoutRotation = computeDrawParams(resetView(), videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.equal(withoutRotation.swapsAxes, false);

  const rotated90 = computeDrawParams(
    cycleRotation(resetView()), videoWidth, videoHeight, CANVAS_WIDTH, CANVAS_HEIGHT,
  );
  assert.equal(rotated90.swapsAxes, true);
  assert.equal(rotated90.baseScale, Math.min(CANVAS_HEIGHT / videoWidth, CANVAS_WIDTH / videoHeight));
});

test('as funções são puras: não mutam o view de entrada', () => {
  const view = resetView();
  const snapshot = JSON.stringify(view);
  toggleMirror(view);
  cycleRotation(view);
  toggleFit(view);
  setZoom(view, 3);
  panBy(view, 10, 10);
  assert.equal(JSON.stringify(view), snapshot);
});
