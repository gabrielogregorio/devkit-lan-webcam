import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLanguage } from '@/lib/i18n';
import { loadQuality } from '@/lib/quality';
import { StreamPage } from '@/pages/StreamPage';
import { FakeCameraStreamer } from '@/testDoubles';
import { clearSessionStorage, renderConnected, type Rendered } from '@/testRender';

vi.mock('@/lib/cameraStreamer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cameraStreamer')>('@/lib/cameraStreamer');
  const doubles = await import('@/testDoubles');

  return { ...actual, CameraStreamer: doubles.FakeCameraStreamer };
});

const CANVAS_WIDTH = 1280;
const DISPLAYED_WIDTH = CANVAS_WIDTH / 2;
const REQUEST = {
  id: 'a'.repeat(64),
  code: 'ab12cd34',
  ip: '192.168.0.20',
  device: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36',
  state: 'pending',
  connected: true,
};

function renderPage(): Rendered & { streamer: FakeCameraStreamer } {
  const rendered = renderConnected(<StreamPage hidden={false} />);

  return { ...rendered, streamer: FakeCameraStreamer.latest() };
}

const preview = (): HTMLElement => screen.getByRole('img', { name: 'Camera preview, exactly what the PC gets' });

describe('StreamPage', () => {
  afterEach(clearSessionStorage);

  it('starts with the hint, Stop disabled and the saved quality applied', () => {
    const { streamer } = renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Tap "Start streaming"');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(streamer.setQuality).toHaveBeenCalledWith(loadQuality());
    expect(screen.getByText('Start streaming to see and approve who asks to watch.')).toBeInTheDocument();
  });

  it('starts and stops the streaming through the streamer', async () => {
    const user = userEvent.setup();
    const { streamer } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Start streaming' }));

    expect(streamer.start).toHaveBeenCalledTimes(1);

    act(() => streamer.callbacks.onStreamingChange(true));

    expect(screen.getByRole('button', { name: 'Start streaming' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(streamer.stop).toHaveBeenCalledTimes(1);
  });

  it('lists who asks to watch while streaming and sends the decision encrypted', async () => {
    const user = userEvent.setup();
    const { streamer, server } = renderPage();
    act(() => {
      streamer.callbacks.onStreamingChange(true);
      server.pushJson({ type: 'requests', requests: [REQUEST] });
    });

    await user.click(screen.getByRole('button', { name: /^Approve 192.168.0.20/ }));

    expect(server.received().at(-1)?.json).toEqual({ type: 'decide', id: REQUEST.id, decision: 'approve' });
  });

  it('passes the server messages to the streamer', () => {
    const { streamer, server } = renderPage();

    act(() => server.pushJson({ type: 'camera-stopped', reason: 'taken' }));

    expect(streamer.handleServerMessage).toHaveBeenCalledWith({ type: 'camera-stopped', reason: 'taken' });
  });

  it('changes and saves the quality, and shows the measured frame size', async () => {
    const user = userEvent.setup();
    const { streamer } = renderPage();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Resolution' }), '360p');
    act(() => streamer.callbacks.onFrameSize(20 * 1024));

    expect(streamer.setQuality).toHaveBeenLastCalledWith({ resolution: '360p', fps: 25, jpegQuality: 0.6 });
    expect(loadQuality().resolution).toBe('360p');
    expect(screen.getByText('20 KB/frame · 500 KB/s')).toBeInTheDocument();
  });

  it('opens the back and front cameras by facing mode, and a lens by device id', async () => {
    const user = userEvent.setup();
    const { streamer } = renderPage();
    act(() =>
      streamer.callbacks.onCamerasChange([
        { deviceId: 'wide', label: 'Wide' },
        { deviceId: 'tele', label: 'Tele' },
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Front' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lens' }), 'tele');

    expect(streamer.openCamera).toHaveBeenNthCalledWith(1, { facingMode: { exact: 'environment' } });
    expect(streamer.openCamera).toHaveBeenNthCalledWith(2, { facingMode: { exact: 'user' } });
    expect(streamer.openCamera).toHaveBeenNthCalledWith(3, { deviceId: { exact: 'tele' } });
  });

  it('shows the status the streamer reports', () => {
    const { streamer } = renderPage();

    act(() => streamer.callbacks.onStatus({ text: 'Opening camera…', kind: 'warn' }));

    expect(screen.getByRole('status')).toHaveTextContent('Opening camera…');
    expect(screen.getByRole('status')).toHaveClass('warn');
  });

  it('writes the status again when the language changes', () => {
    const { streamer } = renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Tap "Start streaming"');

    act(() => setLanguage('es'));

    expect(screen.getByRole('status')).toHaveTextContent('Toca "Iniciar transmisión"');
    expect(streamer.refreshStatus).toHaveBeenCalled();

    act(() => setLanguage('en'));
  });

  it('framing buttons update the view the streamer draws', async () => {
    const user = userEvent.setup();
    const { streamer } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Mirror' }));

    expect(screen.getByRole('button', { name: 'Mirror' })).toHaveAttribute('aria-pressed', 'true');
    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ mirror: true }));

    await user.click(screen.getByRole('button', { name: 'Rotate 90°' }));
    await user.click(screen.getByRole('button', { name: 'Fit ✓' }));

    expect(screen.getByRole('button', { name: 'Crop ✓' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(streamer.setView).toHaveBeenLastCalledWith(
      expect.objectContaining({ mirror: false, rotation: 0, fit: 'contain' }),
    );
  });

  it('the zoom slider sets the zoom and its label', () => {
    const { streamer } = renderPage();

    fireEvent.change(screen.getByRole('slider', { name: /Zoom/ }), { target: { value: '2.5' } });

    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 2.5 }));
    expect(screen.getByText('2.5x')).toBeVisible();
  });

  it('dragging pans by canvas pixels, pinching zooms, a hidden preview pans at scale 1', () => {
    const { streamer } = renderPage();
    const canvas = preview() as HTMLCanvasElement;
    canvas.width = CANVAS_WIDTH;
    const rect = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: DISPLAYED_WIDTH } as DOMRect);

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 15 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ offsetX: 20, offsetY: 10 }));

    rect.mockReturnValue({ width: 0 } as DOMRect);
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 200, clientY: 0 });

    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 2 }));

    fireEvent.pointerCancel(canvas, { pointerId: 2 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 3, clientY: 4 });

    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ offsetX: 23, offsetY: 14 }));
  });

  it('twisting two fingers rotates the camera, and lands on a quarter turn when close to one', () => {
    const { streamer } = renderPage();
    const canvas = preview() as HTMLCanvasElement;

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 100, clientY: 36 });

    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ rotation: 20 }));

    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 5, clientY: 100 });

    expect(streamer.setView).toHaveBeenLastCalledWith(expect.objectContaining({ rotation: 90 }));
  });

  it('a pointer move without a gesture changes nothing', () => {
    const { streamer } = renderPage();

    fireEvent.pointerMove(preview(), { pointerId: 9, clientX: 3, clientY: 4 });

    expect(streamer.setView).not.toHaveBeenCalled();
  });

  it('frees the camera when the page goes away', () => {
    const { streamer, unmount } = renderPage();

    unmount();

    expect(streamer.destroy).toHaveBeenCalledTimes(1);
  });
});
