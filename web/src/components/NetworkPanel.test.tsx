import { act, render, screen, within } from '@testing-library/react';
import { NetworkPanel } from '@/components/NetworkPanel';
import { parseServerMessage, type NetworkPanelData } from '@/lib/protocol';
import { NETWORK_MESSAGE } from '@/testRender';

function network(overrides: Record<string, unknown> = {}): NetworkPanelData {
  const parsed = parseServerMessage({ ...NETWORK_MESSAGE, ...overrides });
  if (parsed?.type !== 'network') {
    throw new Error('bad fixture');
  }

  return parsed.network;
}

describe('NetworkPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the router, this PC and every open page with its role', () => {
    render(<NetworkPanel network={network()} receivedAt={10_000} />);
    const panel = screen.getByRole('complementary', { name: 'Network' });
    const pages = within(panel).getByRole('list', { name: 'Open pages' });

    expect(panel).toHaveTextContent('192.168.0.1');
    expect(panel).toHaveTextContent('router');
    expect(panel).toHaveTextContent('PC (server and webcam)');
    expect(within(pages).getAllByRole('listitem')).toHaveLength(2);
    expect(pages).toHaveTextContent('streaming · Chrome · Android');
    expect(pages).toHaveTextContent('watching · Chrome · Linux');
  });

  it('marks you, and the PC when you are on the PC', () => {
    const { rerender } = render(<NetworkPanel network={network()} receivedAt={10_000} />);

    expect(screen.getAllByText('you')).toHaveLength(1);

    rerender(<NetworkPanel network={network({ you: '192.168.0.10' })} receivedAt={10_000} />);

    expect(screen.getAllByText('you')).toHaveLength(2);
  });

  it.each([
    ['pending', 'asked to watch'],
    ['denied', 'denied'],
    ['idle', 'page open'],
  ])('names the role %s', (role, text) => {
    render(
      <NetworkPanel
        network={network({ peers: [{ ip: '10.0.0.2', device: '', role, you: false }] })}
        receivedAt={10_000}
      />,
    );

    expect(screen.getByRole('list', { name: 'Open pages' })).toHaveTextContent(`${text} · ?`);
  });

  it('shows the pairing code and counts down, and "?" without a router', () => {
    render(<NetworkPanel network={network({ router: null })} receivedAt={10_000} />);

    expect(screen.getByText('Code to pair another device: 123 456 (changes in 4:05)')).toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('Code to pair another device: 123 456 (changes in 4:04)')).toBeInTheDocument();
  });
});
