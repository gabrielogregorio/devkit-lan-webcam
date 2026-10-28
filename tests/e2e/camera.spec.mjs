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
  const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US' });
  await context.grantPermissions(['camera']);
  const page = await context.newPage();
  try {
    await runScenario(page);
  } finally {
    await browser.close();
  }
}

const waitForCameraOpened = (page) => page.waitForFunction(
  () => !/Opening/.test(document.getElementById('status').textContent),
  { timeout: STATUS_TIMEOUT_MS },
);

test('page loads over self-signed HTTPS and the preview shows without streaming', async () => {
  await withPage(async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    assert.ok(await page.$('#preview'), 'preview canvas exists');
    assert.equal(await page.textContent('#startBtn'), 'Start streaming');

    // tap Back: the fake camera opens and the status leaves its initial state
    await page.click('#backBtn');
    await page.waitForFunction(
      () => /Previewing|Streaming|camera/i.test(document.getElementById('status').textContent),
      { timeout: STATUS_TIMEOUT_MS },
    );
  });
});

test('switching Back/Front does not hang and the status follows', async () => {
  await withPage(async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.click('#backBtn');
    await waitForCameraOpened(page);
    const statusAfterBackCamera = await page.textContent('#status');

    await page.click('#frontBtn');
    await waitForCameraOpened(page);
    const statusAfterFrontCamera = await page.textContent('#status');

    assert.ok(statusAfterBackCamera, 'status filled after opening the back camera');
    assert.ok(statusAfterFrontCamera, 'status filled after opening the front camera');
  });
});

test('fast Back/Front clicks are serialized (no unhandled error)', async () => {
  await withPage(async (page) => {
    const pageErrors = [];
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message));
    await page.goto(BASE_URL, { waitUntil: 'load' });

    for (let clickIndex = 0; clickIndex < CAMERA_SWITCH_CLICKS; clickIndex++) {
      await page.click(clickIndex % 2 ? '#frontBtn' : '#backBtn');
    }
    await page.waitForTimeout(1500);

    assert.deepEqual(pageErrors, [], 'no page error when switching fast');
  });
});

test('Start streaming opens the WebSocket and the server gets the blobs', async () => {
  await withPage(async (page) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.click('#backBtn');
    await waitForCameraOpened(page);

    await page.click('#startBtn');
    await page.waitForFunction(
      () => /Streaming/.test(document.getElementById('status').textContent),
      { timeout: STATUS_TIMEOUT_MS },
    );
    await page.waitForTimeout(FRAME_COLLECTION_MS);

    // Checked on the server side (sturdier than Playwright's `framesent` event,
    // which does not fire reliably in headless Chromium).
    const { frames } = await page.evaluate(async () => {
      const response = await fetch('/frames');
      return response.json();
    });
    assert.ok(frames > 0, 'at least 1 frame reached the server');

    await page.click('#stopBtn');
  });
});
