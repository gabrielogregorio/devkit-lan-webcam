import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { SessionStore } from '@/lib/sessionStore';
import { FakeCameraStreamer, FakeServer, FakeSocket, fakeSocketFactory } from '@/testDoubles';
import { NETWORK_MESSAGE, clearSessionStorage, pairedStore } from '@/testRender';

vi.mock('@/lib/cameraStreamer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cameraStreamer')>('@/lib/cameraStreamer');
  const doubles = await import('@/testDoubles');

  return { ...actual, CameraStreamer: doubles.FakeCameraStreamer };
});

function renderPaired(): FakeServer {
  render(<App store={pairedStore()} />);

  return FakeServer.accept(FakeSocket.latest());
}

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(clearSessionStorage);

  it('asks for the pairing code until the device is paired', () => {
    render(<App store={new SessionStore({ createSocket: fakeSocketFactory })} />);

    expect(screen.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeVisible();
  });

  it('starts on the home page, which is only the network panel', () => {
    const server = renderPaired();

    expect(screen.getByText('Connecting…')).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();

    act(() => server.pushJson(NETWORK_MESSAGE));

    expect(screen.getByRole('heading', { level: 1, name: 'Network' })).toBeVisible();
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stream' })).toHaveAttribute('href', '/stream');
    expect(screen.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/watch');
  });

  it('shows the network panel once the PC sends it, inside the picture window while watching', async () => {
    const user = userEvent.setup();
    const server = renderPaired();

    act(() => server.pushJson(NETWORK_MESSAGE));

    expect(screen.getByRole('complementary', { name: 'Network' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Stream' }));

    expect(screen.getByRole('complementary', { name: 'Network' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Watch' }));

    expect(screen.getByRole('complementary', { name: 'Network' }).closest('.watch-window')).not.toBeNull();
  });

  it('moves between the pages without reloading and marks the current one', async () => {
    const user = userEvent.setup();
    renderPaired();
    const navigation = screen.getByRole('navigation', { name: 'Pages' });

    await user.click(screen.getByRole('link', { name: 'Watch' }));

    expect(window.location.pathname).toBe('/watch');
    expect(screen.getByRole('heading', { name: 'Watching the LAN Webcam' })).toBeVisible();
    expect(navigation.querySelector('[aria-current="page"]')).toHaveTextContent('Watch');

    await user.click(screen.getByRole('link', { name: 'Stream' }));

    expect(screen.getByRole('heading', { name: 'Camera → PC webcam' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'LAN Webcam' }));

    expect(window.location.pathname).toBe('/');
  });

  it('keeps the Stream page mounted while another page is shown, so streaming goes on', async () => {
    const user = userEvent.setup();
    renderPaired();
    const streamer = FakeCameraStreamer.latest();

    await user.click(screen.getByRole('link', { name: 'Watch' }));

    expect(streamer.destroy).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Camera → PC webcam', hidden: true })).not.toBeVisible();
  });
});
