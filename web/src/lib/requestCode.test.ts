import { formatRequestCode } from '@/lib/requestCode';

describe('request code', () => {
  it('splits the code so two screens are easy to compare', () => {
    expect(formatRequestCode('ab12cd34')).toBe('ab12-cd34');
  });
});
