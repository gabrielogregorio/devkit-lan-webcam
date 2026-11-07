import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { OPCODE_BINARY, OPCODE_TEXT, startWireTap } from './wire-tap.mjs';

const BASE_URL = process.env.E2E_BASE_URL || `https://localhost:${process.env.PORT || 19443}`;
const HTTP_URL = process.env.E2E_HTTP_URL || 'http://localhost:19080';
const STREAM_URL = `${BASE_URL}/stream`;
const PROJECT_ROOT = new URL('../..', import.meta.url).pathname;

const LAUNCH_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const STATUS_TIMEOUT_MS = 8000;
const FRAME_COLLECTION_MS = 800;
const CAMERA_SWITCH_CLICKS = 6;
const REQUEST_CODE = /Your code: ([0-9a-f]{4}-[0-9a-f]{4})/;
const WIRE_WATCH_MS = 1500;
const MIN_ENCRYPTED_FRAMES = 3;
// The only messages that may cross in the clear: pairing and session handshakes, made of public values.
const HANDSHAKE_TYPES = new Set(['pair', 'challenge', 'confirm', 'paired', 'hello', 'welcome', 'ready']);
// What a JPEG from canvas.toBlob starts with, and words the app says after the handshake.
const JPEG_MARKERS = [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('JFIF')];
const APP_WORDS = ['camera-start', 'request', 'approve', 'status', 'network'];

// The code the PC shows now, read the same way the person reads it: ./run.sh code (pairing.py).
function pairingCode() {
  const output = execFileSync(`${PROJECT_ROOT}.venv/bin/python`, ['pairing.py', 'code'], {
    cwd: PROJECT_ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  const match = output.match(/(\d{3}) (\d{3})/);
  assert.ok(match, `no code in "${output}"`);

  return `${match[1]}${match[2]}`;
}

async function withBrowser(runScenario) {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const openDevice = async () => {
    // Every device is its own context: its own storage, so it pairs on its own.
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US' });
    await context.grantPermissions(['camera']);

    return context.newPage();
  };
  try {
    await runScenario(openDevice);
  } finally {
    await browser.close();
  }
}

async function pairAndOpen(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.getByLabel('Pairing code').fill(pairingCode());
  await page.getByRole('button', { name: 'Pair' }).click();
  // The network panel only comes through the encrypted session, so it proves the session is up.
  await page.getByRole('complementary', { name: 'Network' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
}

const waitForCameraOpened = (page) =>
  page.waitForFunction(() => !/Opening/.test(document.getElementById('status').textContent), {
    timeout: STATUS_TIMEOUT_MS,
  });

async function startStreaming(page) {
  await page.click('#backBtn');
  await waitForCameraOpened(page);
  await page.click('#startBtn');
  await page.waitForFunction(() => /Streaming/.test(document.getElementById('status').textContent), {
    timeout: STATUS_TIMEOUT_MS,
  });
}

test('a device that is not paired sees only the pairing form, and a wrong code does not pair', async () => {
  await withBrowser(async (openDevice) => {
    const page = await openDevice();
    await page.goto(STREAM_URL, { waitUntil: 'load' });

    assert.equal(await page.locator('#preview').count(), 0, 'no camera page before pairing');

    const code = pairingCode();
    const wrong = code === '000000' ? '111111' : '000000';
    await page.getByLabel('Pairing code').fill(wrong);
    await page.getByRole('button', { name: 'Pair' }).click();
    await page.getByRole('alert').waitFor({ timeout: STATUS_TIMEOUT_MS });

    assert.match(await page.getByRole('alert').textContent(), /Wrong code/);
  });
});

test('after pairing, the preview shows and Back/Front switching does not hang', async () => {
  await withBrowser(async (openDevice) => {
    const page = await openDevice();
    await pairAndOpen(page, STREAM_URL);

    await page.click('#backBtn');
    await waitForCameraOpened(page);
    await page.click('#frontBtn');
    await waitForCameraOpened(page);

    assert.ok(await page.textContent('#status'), 'status filled after switching cameras');
  });
});

test('fast Back/Front clicks are serialized (no unhandled error)', async () => {
  await withBrowser(async (openDevice) => {
    const page = await openDevice();
    const pageErrors = [];
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message));
    await pairAndOpen(page, STREAM_URL);

    for (let clickIndex = 0; clickIndex < CAMERA_SWITCH_CLICKS; clickIndex += 1) {
      await page.click(clickIndex % 2 ? '#frontBtn' : '#backBtn');
    }
    await page.waitForTimeout(1500);

    assert.deepEqual(pageErrors, [], 'no page error when switching fast');
  });
});

test('streaming sends encrypted frames that reach the PC webcam, at the chosen quality', async () => {
  await withBrowser(async (openDevice) => {
    const page = await openDevice();
    await pairAndOpen(page, STREAM_URL);
    await page.getByRole('combobox', { name: 'Resolution' }).selectOption('360p');
    await startStreaming(page);
    await page.waitForTimeout(FRAME_COLLECTION_MS);

    // Counted on the server after decryption (sturdier than Playwright's framesent event).
    const { frames } = await page.evaluate(async () => (await fetch('/frames')).json());
    assert.ok(frames > 0, 'at least 1 decrypted frame reached the server');
    assert.equal(await page.locator('#preview').evaluate((canvas) => canvas.width), 640);

    await page.click('#stopBtn');
  });
});

test('the home page is the network panel and the navigation moves between the pages', async () => {
  await withBrowser(async (openDevice) => {
    const page = await openDevice();
    await pairAndOpen(page, BASE_URL);
    await page.getByRole('heading', { level: 1, name: 'Network' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Watch' }).click();
    await page.getByRole('heading', { name: 'Watching the LAN Webcam' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
    assert.equal(new URL(page.url()).pathname, '/watch');

    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Stream' }).click();
    await page.getByRole('heading', { name: 'Camera → PC webcam' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
    assert.equal(new URL(page.url()).pathname, '/stream');
  });
});

test('over plain HTTP, only the request the camera approves gets the picture', async () => {
  await withBrowser(async (openDevice) => {
    const camera = await openDevice();
    await pairAndOpen(camera, STREAM_URL);
    await startStreaming(camera);

    const laptop = await openDevice();
    await pairAndOpen(laptop, `${HTTP_URL}/watch`);
    assert.deepEqual(
      await laptop.evaluate(() => ({ secure: window.isSecureContext, subtle: typeof window.crypto.subtle })),
      { secure: false, subtle: 'undefined' },
      'the laptop really is on plain HTTP, without the browser crypto API',
    );
    await laptop.getByRole('button', { name: 'Ask to watch' }).click();
    await laptop.getByText(REQUEST_CODE).waitFor({ timeout: STATUS_TIMEOUT_MS });
    const laptopCode = (await laptop.getByText(REQUEST_CODE).textContent()).match(REQUEST_CODE)[1];

    const intruder = await openDevice();
    await pairAndOpen(intruder, `${HTTP_URL}/watch`);
    await intruder.getByRole('button', { name: 'Ask to watch' }).click();
    await intruder.getByText(REQUEST_CODE).waitFor({ timeout: STATUS_TIMEOUT_MS });

    await camera.getByRole('button', { name: `Approve ${laptopCode}` }).click();

    await laptop.getByRole('img', { name: 'Live camera' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
    await intruder.waitForTimeout(FRAME_COLLECTION_MS);
    assert.equal(await intruder.getByRole('img', { name: 'Live camera' }).count(), 0, 'the other request sees nothing');
    assert.match(await intruder.locator('#watchStatus').textContent(), /Request sent/);

    await camera.getByRole('button', { name: `Revoke ${laptopCode}` }).click();
    await laptop.locator('#watchStatus', { hasText: 'Denied' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
    assert.equal(await laptop.getByRole('img', { name: 'Live camera' }).count(), 0, 'revoked: the picture is gone');

    await camera.click('#stopBtn');
  });
});

test('an eavesdropper on plain HTTP records the whole watch session and finds no picture and no secret', async () => {
  const tap = await startWireTap(HTTP_URL);
  try {
    await withBrowser(async (openDevice) => {
      const camera = await openDevice();
      await pairAndOpen(camera, STREAM_URL);
      await startStreaming(camera);

      const laptop = await openDevice();
      await pairAndOpen(laptop, `${tap.url}/watch`);
      await laptop.getByRole('button', { name: 'Ask to watch' }).click();
      await laptop.getByText(REQUEST_CODE).waitFor({ timeout: STATUS_TIMEOUT_MS });
      const laptopCode = (await laptop.getByText(REQUEST_CODE).textContent()).match(REQUEST_CODE)[1];
      await camera.getByRole('button', { name: `Approve ${laptopCode}` }).click();
      await laptop.getByRole('img', { name: 'Live camera' }).waitFor({ timeout: STATUS_TIMEOUT_MS });
      await laptop.waitForTimeout(WIRE_WATCH_MS);
      const stored = await laptop.evaluate(() => localStorage.getItem('devkit-lan-webcam.device'));
      const secret = JSON.parse(stored).secret;
      await camera.click('#stopBtn');

      const messages = tap.messages();
      const wire = tap.bytes();
      const frames = messages.filter((m) => m.direction === 'server->client' && m.opcode === OPCODE_BINARY);
      assert.ok(frames.length >= MIN_ENCRYPTED_FRAMES, `the picture crossed the tap (${frames.length} messages)`);
      for (const marker of JPEG_MARKERS) {
        assert.ok(!messages.some((m) => m.payload.includes(marker)), `JPEG marker ${marker.toString('hex')} visible`);
      }
      for (const word of APP_WORDS) {
        const binary = messages.filter((m) => m.opcode === OPCODE_BINARY);
        assert.ok(!binary.some((m) => m.payload.includes(word)), `"${word}" readable after the handshake`);
      }
      assert.ok(!wire.includes(Buffer.from(secret, 'hex')) && !wire.includes(secret), 'the device secret leaked');
      const textTypes = messages.filter((m) => m.opcode === OPCODE_TEXT).map((m) => JSON.parse(m.payload).type);
      assert.deepEqual(
        textTypes.filter((type) => !HANDSHAKE_TYPES.has(type)),
        [],
        'only handshakes travel as plain text',
      );
    });
  } finally {
    await tap.close();
  }
});
