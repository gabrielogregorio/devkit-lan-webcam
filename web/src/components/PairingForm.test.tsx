import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PairingForm } from '@/components/PairingForm';
import type { PairingOutcome } from '@/lib/pairingClient';
import { SessionProvider } from '@/lib/SessionContext';
import { SessionStore } from '@/lib/sessionStore';
import { TEST_CREDENTIAL, fakeSocketFactory } from '@/testDoubles';
import { clearSessionStorage } from '@/testRender';

function renderForm(outcome: PairingOutcome): ReturnType<typeof vi.fn> {
  const pair = vi.fn().mockResolvedValue(outcome);
  render(
    <SessionProvider store={new SessionStore({ createSocket: fakeSocketFactory, pair })}>
      <PairingForm />
    </SessionProvider>,
  );

  return pair;
}

describe('PairingForm', () => {
  afterEach(clearSessionStorage);

  it('only accepts six digits and sends them without spaces', async () => {
    const user = userEvent.setup();
    const pair = renderForm({ type: 'wrong-code' });
    const button = screen.getByRole('button', { name: 'Pair' });

    await user.type(screen.getByLabelText('Pairing code'), '12345');

    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Pairing code'), ' 6');
    await user.click(button);

    expect(pair).toHaveBeenCalledWith('123456');
  });

  it('does nothing when submitted without a full code', async () => {
    const user = userEvent.setup();
    const pair = renderForm({ type: 'wrong-code' });

    await user.type(screen.getByLabelText('Pairing code'), '12');
    fireEvent.submit(screen.getByRole('button', { name: 'Pair' }));

    expect(pair).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: 'wrong-code' }, 'Wrong code. Check the code on the PC (it changes every few minutes).'],
    [{ type: 'blocked', retryIn: 90 }, 'Too many wrong codes from this device. Try again in 90 s.'],
    [{ type: 'locked' }, 'Pairing is locked after too many wrong codes. Change the code in the PC icon.'],
    [{ type: 'failed' }, 'Could not reach the PC. Check the network and try again.'],
    [{ type: 'paired', credential: TEST_CREDENTIAL }, 'Paired.'],
  ] as const)('explains the outcome %j', async (outcome, message) => {
    const user = userEvent.setup();
    renderForm(outcome);

    await user.type(screen.getByLabelText('Pairing code'), '123456{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});
