import { fireEvent, render, screen } from '@testing-library/react';
import { NavLink } from '@/components/NavLink';
import { ROUTES } from '@/lib/router';

describe('NavLink', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('marks the current page and leaves the others unmarked', () => {
    render(
      <>
        <NavLink to={ROUTES.stream} current={ROUTES.stream}>
          Stream
        </NavLink>
        <NavLink to={ROUTES.watch} current={ROUTES.stream}>
          Watch
        </NavLink>
      </>,
    );

    expect(screen.getByRole('link', { name: 'Stream' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Watch' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('lets the browser handle a %s click (new tab or window)', (_description, modifiers) => {
    render(
      <NavLink to={ROUTES.watch} current={ROUTES.home}>
        Watch
      </NavLink>,
    );

    let preventedByTheLink = true;
    // Runs after the link's own handler; it stops jsdom from really opening the page.
    const recordAndStop = (event: Event): void => {
      preventedByTheLink = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener('click', recordAndStop);

    fireEvent.click(screen.getByRole('link', { name: 'Watch' }), modifiers);
    window.removeEventListener('click', recordAndStop);

    expect(preventedByTheLink).toBe(false);
    expect(window.location.pathname).toBe('/');
  });
});
