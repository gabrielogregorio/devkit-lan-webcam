import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestList } from '@/components/RequestList';
import type { WatchRequest } from '@/lib/protocol';

const REQUEST: WatchRequest = {
  id: 'a'.repeat(64),
  code: 'ab12cd34',
  ip: '192.168.0.20',
  device: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36',
  state: 'pending',
  connected: true,
};

describe('RequestList', () => {
  it('says when nobody asked', () => {
    render(<RequestList requests={[]} onDecide={vi.fn()} />);

    expect(screen.getByText('Nobody asked to watch yet. Other devices ask on the Watch page.')).toBeInTheDocument();
  });

  it('shows the IP and device, no code, and approves or denies a pending request', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<RequestList requests={[REQUEST]} onDecide={onDecide} />);

    expect(screen.getByRole('list', { name: 'Watch requests' })).toHaveTextContent(
      '192.168.0.20Chrome · Linux · waiting for you',
    );
    expect(screen.queryByText(/ab12/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve 192.168.0.20 · Chrome · Linux' }));
    await user.click(screen.getByRole('button', { name: 'Deny 192.168.0.20 · Chrome · Linux' }));

    expect(onDecide).toHaveBeenNthCalledWith(1, REQUEST.id, 'approve');
    expect(onDecide).toHaveBeenNthCalledWith(2, REQUEST.id, 'deny');
  });

  it('revokes an approved request, connected or not', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { rerender } = render(<RequestList requests={[{ ...REQUEST, state: 'approved' }]} onDecide={onDecide} />);

    expect(screen.getByText(/· watching$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve 192.168.0.20 · Chrome · Linux' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke 192.168.0.20 · Chrome · Linux' }));

    expect(onDecide).toHaveBeenCalledWith(REQUEST.id, 'revoke');

    rerender(<RequestList requests={[{ ...REQUEST, state: 'approved', connected: false }]} onDecide={onDecide} />);

    expect(screen.getByText(/approved, page closed/)).toBeInTheDocument();
  });

  it('can approve a request it denied before', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<RequestList requests={[{ ...REQUEST, state: 'denied' }]} onDecide={onDecide} />);

    expect(screen.getByText(/· denied$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny 192.168.0.20 · Chrome · Linux' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve 192.168.0.20 · Chrome · Linux' }));

    expect(onDecide).toHaveBeenCalledWith(REQUEST.id, 'approve');
  });
});
