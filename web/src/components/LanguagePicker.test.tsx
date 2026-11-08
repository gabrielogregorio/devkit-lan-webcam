import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguagePicker } from '@/components/LanguagePicker';
import { currentLanguage, LANGUAGES, setLanguage } from '@/lib/i18n';

describe('LanguagePicker', () => {
  afterEach(() => {
    act(() => setLanguage('en'));
  });

  it('lists every language under its own name and switches to the one picked', async () => {
    const user = userEvent.setup();
    render(<LanguagePicker />);
    const picker = screen.getByRole('combobox', { name: 'Language' });

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      LANGUAGES.map((language) => language.name),
    );

    await user.selectOptions(picker, '日本語');

    expect(currentLanguage()).toBe('ja');
    expect(screen.getByRole('combobox', { name: '言語' })).toHaveValue('ja');
  });
});
