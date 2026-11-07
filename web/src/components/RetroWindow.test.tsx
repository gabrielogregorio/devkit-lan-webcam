import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RetroWindow } from '@/components/RetroWindow';

describe('RetroWindow', () => {
  it('turns the title into a heading of the chosen level when it has an id', () => {
    render(
      <RetroWindow title="Settings" titleId="settings-title" level={2} tone="teal" className="extra">
        <p>body</p>
      </RetroWindow>,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Settings' });

    expect(heading).toHaveAttribute('id', 'settings-title');
    expect(heading.closest('.window')).toHaveClass('window', 'tone-teal', 'extra');
    expect(screen.getByText('body')).toBeVisible();
  });

  it('keeps a title without an id as decoration, hidden from screen readers', () => {
    render(
      <RetroWindow title={'C:\\controls'}>
        <p>body</p>
      </RetroWindow>,
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('C:\\controls')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('C:\\controls').closest('.window')).toHaveClass('tone-violet');
  });
});
