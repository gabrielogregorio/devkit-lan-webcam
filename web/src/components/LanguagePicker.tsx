import { Languages } from 'lucide-react';
import type { ReactNode } from 'react';
import { LANGUAGES, setLanguage, t, useLanguage, type Language } from '@/lib/i18n';

// The language menu of the top bar: every language under its own name, saved in this browser.
export function LanguagePicker(): ReactNode {
  const language = useLanguage();

  return (
    <label className="language-picker">
      <Languages className="icon" aria-hidden="true" />
      <select
        aria-label={t('Language')}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}>
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} lang={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
