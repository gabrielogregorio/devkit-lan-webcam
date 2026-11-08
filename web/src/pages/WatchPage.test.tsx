import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WatchPage } from '@/pages/WatchPage';
import { clearSessionStorage, NETWORK_MESSAGE, renderConnected } from '@/testRender';

const FRAME_URL = 'blob:frame';
const SECOND_FRAME_URL = 'blob:frame-2';

const status = (access: string, camera = true, code: string | null = 'ab12cd34'): object => ({
  type: 'status',
  camera,
  streaming: false,
  access,
  code,
});

describe('WatchPage', () => {
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockReset().mockReturnValueOnce(FRAME_URL).mockReturnValue(SECOND_FRAME_URL);
    revokeObjectURL.mockReset();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearSessionStorage();
  });

  it('asks to watch with a key and shows the code the camera device will see', async () => {
    const user = userEvent.setup();
    const { server } = renderConnected(<WatchPage />);
    act(() => server.pushJson(status('none', true, null)));

    expect(screen.getByRole('status')).toHaveTextContent('No permission yet');

    await user.click(screen.getByRole('button', { name: 'Ask to watch' }));

    expect(server.received().at(-1)?.json?.type).toBe('request');

    act(() => server.pushJson(status('pending')));

    expect(screen.getByRole('status')).toHaveTextContent('Request sent');
  });

  it('asks to watch from the message on the picture too, without going full screen', async () => {
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    const { server } = renderConnected(<WatchPage />);
    act(() => server.pushJson(status('none', true, null)));

    await user.dblClick(
      screen.getByRole('button', { name: 'Ask to watch: the camera device sees your code and approves it.' }),
    );

    expect(server.received().filter((message) => message.json?.type === 'request').length).toBeGreaterThan(0);
    expect(requestFullscreen).not.toHaveBeenCalled();

    act(() => server.pushJson(status('denied')));
    await user.click(screen.getByRole('button', { name: 'The camera device denied the request.' }));

    expect(server.received().filter((message) => message.json?.type === 'request').length).toBeGreaterThan(1);
  });

  it('shows the network inside the picture window, under the status', () => {
    const { server } = renderConnected(<WatchPage />);

    expect(screen.queryByRole('complementary', { name: 'Network' })).not.toBeInTheDocument();

    act(() => server.pushJson(NETWORK_MESSAGE));
    const network = screen.getByRole('complementary', { name: 'Network' });

    expect(network.closest('.watch-window')).not.toBeNull();
    expect(within(network).getAllByRole('listitem')).toHaveLength(4);
    expect(within(network).queryByRole('heading')).not.toBeInTheDocument();
  });

  it('asks again with a new key after a denial', async () => {
    const user = userEvent.setup();
    const { server } = renderConnected(<WatchPage />);
    act(() => server.pushJson(status('none', true, null)));
    await user.click(screen.getByRole('button', { name: 'Ask to watch' }));
    act(() => server.pushJson(status('denied')));

    await user.click(screen.getByRole('button', { name: 'Ask again with a new code' }));

    const requests = server.received().filter((message) => message.json?.type === 'request');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.json?.key).not.toBe(requests[0]?.json?.key);
  });

  it('shows each frame once approved, frees the previous one and clears when revoked', () => {
    const { server } = renderConnected(<WatchPage />);
    act(() => server.pushJson(status('approved')));

    expect(screen.getByRole('status')).toHaveTextContent('Approved, waiting for frames…');

    act(() => server.pushFrame(Uint8Array.of(1)));

    expect(screen.getByRole('img', { name: 'Live camera' })).toHaveAttribute('src', FRAME_URL);

    act(() => server.pushFrame(Uint8Array.of(2)));

    expect(screen.getByRole('img', { name: 'Live camera' })).toHaveAttribute('src', SECOND_FRAME_URL);
    expect(revokeObjectURL).toHaveBeenCalledWith(FRAME_URL);

    act(() => server.pushJson(status('denied')));

    expect(screen.queryByRole('img', { name: 'Live camera' })).not.toBeInTheDocument();
  });

  it('shows the frame rate after a second of frames', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { server } = renderConnected(<WatchPage />);
    act(() => server.pushJson(status('approved')));

    now.mockReturnValue(500);
    act(() => server.pushFrame(Uint8Array.of(1)));
    now.mockReturnValue(1000);
    act(() => server.pushFrame(Uint8Array.of(2)));

    expect(screen.getByRole('status')).toHaveTextContent('Live - 2 fps');
  });

  it('says when no camera streams although approved', () => {
    const { server } = renderConnected(<WatchPage />);

    act(() => server.pushJson(status('approved', false)));

    expect(screen.getByText('Approved. No camera is streaming right now.')).toBeInTheDocument();
  });

  it('full screen toggles the picture in and out', async () => {
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const exitFullscreen = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;
    renderConnected(<WatchPage />);

    await user.click(screen.getByRole('button', { name: 'Full screen' }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body });
    await user.click(screen.getByRole('button', { name: 'Full screen' }));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document, 'fullscreenElement');
  });
});
