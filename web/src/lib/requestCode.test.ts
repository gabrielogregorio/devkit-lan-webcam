import { formatPairingCode, formatRequestCode } from '@/lib/requestCode';
import { clockLabel, secondsRemaining } from '@/lib/useCountdown';

describe('codes and countdown', () => {
  it('splits the codes so two screens are easy to compare', () => {
    expect(formatRequestCode('ab12cd34')).toBe('ab12-cd34');
    expect(formatPairingCode('123456')).toBe('123 456');
  });

  it('counts down from what the server said and stops at zero', () => {
    expect(secondsRemaining(120, 10_000, 10_000)).toBe(120);
    expect(secondsRemaining(120, 10_000, 15_999)).toBe(115);
    expect(secondsRemaining(5, 0, 60_000)).toBe(0);
  });

  it('shows minutes and seconds', () => {
    expect(clockLabel(245)).toBe('4:05');
    expect(clockLabel(9)).toBe('0:09');
  });
});
