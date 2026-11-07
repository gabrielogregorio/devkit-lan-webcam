import { useState, type ReactNode, type SubmitEvent } from 'react';
import { useSessionStore } from '@/lib/SessionContext';
import { t } from '@/lib/i18n';
import { isValidCode, normalizeCode, type PairingOutcome } from '@/lib/pairingClient';

type FormState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'result'; outcome: PairingOutcome };

function outcomeText(outcome: PairingOutcome): string {
  switch (outcome.type) {
    case 'wrong-code':
      return t('Wrong code. Check the code on the PC (it changes every few minutes).');
    case 'blocked':
      return t('Too many wrong codes from this device. Try again in {seconds} s.', { seconds: outcome.retryIn });
    case 'locked':
      return t('Pairing is locked after too many wrong codes. Change the code in the PC icon.');
    case 'failed':
      return t('Could not reach the PC. Check the network and try again.');
    case 'paired':
      return t('Paired.');
  }
}

export function PairingForm(): ReactNode {
  const store = useSessionStore();
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });
  const code = normalizeCode(typed);

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!isValidCode(code)) {
      return;
    }
    setState({ kind: 'busy' });
    void store.pair(code).then((outcome) => setState({ kind: 'result', outcome }));
  };

  return (
    <section className="page pairing" aria-labelledby="pairing-title">
      <h1 id="pairing-title">{t('🔐 Pair this device')}</h1>
      <p className="lead">
        {t('Type the 6-digit code shown on the PC: in the LAN Webcam icon on the top bar, or with ./run.sh code.')}
      </p>
      <form className="pairing-form" onSubmit={submit}>
        <label htmlFor="pairingCode">{t('Pairing code')}</label>
        <input
          id="pairingCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className="primary" disabled={!isValidCode(code) || state.kind === 'busy'}>
          {t('Pair')}
        </button>
      </form>
      {state.kind === 'result' && (
        <p role="alert" className={state.outcome.type === 'paired' ? 'ok' : 'err'}>
          {outcomeText(state.outcome)}
        </p>
      )}
      <p className="hint">
        {t(
          'Pairing happens once per browser: the code never travels over the network, and everything after it is encrypted, even over plain HTTP.',
        )}
      </p>
    </section>
  );
}
