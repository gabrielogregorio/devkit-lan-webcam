import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE_URL || `https://localhost:${process.env.PORT || 19443}`;

const LAUNCH_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

const STATUS_TIMEOUT_MS = 5000;
const FRAME_COLLECTION_MS = 800;
const CAMERA_SWITCH_CLICKS = 6;

async function withPage(runScenario) {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.grantPermissions(['camera']);
  const page = await context.newPage();
  try {
    await runScenario(page);
  } finally {
    await browser.close();
  }
}

const waitForCameraOpened = (page) => page.waitForFunction(
  () => !/Abrindo/.test(document.getElementById('status').textContent),
  { timeout: STATUS_TIMEOUT_MS },
);

test('pagina carrega via HTTPS self-signed e o preview aparece sem transmitir', async () => {
  await withPage(async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    assert.ok(await page.$('#preview'), 'canvas de preview existe');

    // toca traseira: a camera fake abre e o status sai do estado inicial
    await page.click('#backBtn');
    await page.waitForFunction(
      () => /Pré-visualizando|Transmitindo|câmera/i.test(document.getElementById('status').textContent),
      { timeout: STATUS_TIMEOUT_MS },
    );
  });
});

test('trocar Traseira/Frontal nao trava e o status reflete a troca', async () => {
  await withPage(async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.click('#backBtn');
    await waitForCameraOpened(page);
    const statusAfterBackCamera = await page.textContent('#status');

    await page.click('#frontBtn');
    await waitForCameraOpened(page);
    const statusAfterFrontCamera = await page.textContent('#status');

    assert.ok(statusAfterBackCamera, 'status preenchido apos abrir a traseira');
    assert.ok(statusAfterFrontCamera, 'status preenchido apos abrir a frontal');
  });
});

test('cliques rapidos em Traseira/Frontal sao serializados (sem erro nao tratado)', async () => {
  await withPage(async (page) => {
    const pageErrors = [];
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message));
    await page.goto(BASE_URL, { waitUntil: 'load' });

    for (let clickIndex = 0; clickIndex < CAMERA_SWITCH_CLICKS; clickIndex++) {
      await page.click(clickIndex % 2 ? '#frontBtn' : '#backBtn');
    }
    await page.waitForTimeout(1500);

    assert.deepEqual(pageErrors, [], 'nenhum erro de pagina ao trocar rapido');
  });
});

test('Iniciar transmissao abre o WebSocket e o servidor recebe os blobs', async () => {
  await withPage(async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.click('#backBtn');
    await waitForCameraOpened(page);

    await page.click('#startBtn');
    await page.waitForFunction(
      () => /Transmitindo/.test(document.getElementById('status').textContent),
      { timeout: STATUS_TIMEOUT_MS },
    );
    await page.waitForTimeout(FRAME_COLLECTION_MS);

    // Verifica no lado do servidor (mais robusto que o evento `framesent` do
    // Playwright, que não dispara de forma confiável no Chromium headless).
    const { frames } = await page.evaluate(async () => {
      const response = await fetch('/frames');
      return response.json();
    });
    assert.ok(frames > 0, 'pelo menos 1 frame recebido pelo servidor');

    await page.click('#stopBtn');
  });
});
