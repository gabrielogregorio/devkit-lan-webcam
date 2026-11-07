import { render, screen, within } from '@testing-library/react';
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
  it('lists the router, this PC and every other machine, one line each', () => {
    render(<NetworkPanel network={network()} />);
    const panel = screen.getByRole('complementary', { name: 'Network' });
    const lines = within(panel).getAllByRole('listitem');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toHaveTextContent('192.168.0.1router');
    expect(lines[1]).toHaveTextContent('192.168.0.10PC (server and webcam)');
    expect(lines[2]).toHaveTextContent('streaming · Chrome · Android');
    expect(lines[3]).toHaveTextContent('watching · Chrome · Linux');
    expect(screen.getAllByText('you')).toHaveLength(1);
  });

  it('folds a page open on the PC into the PC line, with "you" only once', () => {
    render(
      <NetworkPanel
        network={network({
          you: '192.168.0.10',
          peers: [
            {
              ip: '192.168.0.30',
              device: 'Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile',
              role: 'camera',
              you: false,
            },
            { ip: '192.168.0.10', device: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0', role: 'watching', you: true },
          ],
        })}
      />,
    );
    const lines = screen.getAllByRole('listitem');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toHaveTextContent('PC (server and webcam) · watching · Chrome · Linux');
    expect(lines[1]).toHaveClass('role-watching', 'you');
    expect(screen.getAllByText('you')).toHaveLength(1);
  });

  it('marks the PC as you when this page runs on it but is not listed yet', () => {
    render(<NetworkPanel network={network({ you: '192.168.0.10', peers: [] })} />);

    expect(screen.getAllByRole('listitem')[1]).toHaveClass('you');
    expect(screen.getAllByText('you')).toHaveLength(1);
  });

  it('shows two tabs of one machine as one line with both roles, the most telling first', () => {
    render(
      <NetworkPanel
        network={network({
          peers: [
            { ip: '10.0.0.2', device: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', role: 'idle', you: false },
            { ip: '10.0.0.2', device: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0', role: 'watching', you: false },
            { ip: '10.0.0.2', device: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0', role: 'watching', you: false },
          ],
        })}
      />,
    );
    const lines = screen.getAllByRole('listitem');

    expect(lines).toHaveLength(3);
    expect(lines[2]).toHaveTextContent('watching + page open · Firefox · Linux / Chrome · Linux');
    expect(lines[2]).toHaveClass('role-watching');
  });

  it.each([
    ['pending', 'asked to watch'],
    ['denied', 'denied'],
    ['idle', 'page open'],
  ])('names the role %s', (role, text) => {
    render(<NetworkPanel network={network({ peers: [{ ip: '10.0.0.2', device: '', role, you: false }] })} />);

    expect(screen.getAllByRole('listitem')[2]).toHaveTextContent(`${text} · ?`);
  });

  it('shows "?" without a router and never the pairing code', () => {
    render(<NetworkPanel network={network({ router: null })} />);

    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Network' })).not.toHaveTextContent(/code/i);
  });
});
