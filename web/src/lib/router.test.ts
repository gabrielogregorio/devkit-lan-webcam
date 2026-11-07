import { act, renderHook } from '@testing-library/react';
import { ROUTES, navigate, routeFromPathname, useRoute } from '@/lib/router';

describe('router', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['/', ROUTES.home],
    ['/stream', ROUTES.stream],
    ['/stream/', ROUTES.stream],
    ['/watch//', ROUTES.watch],
    ['/watch', ROUTES.watch],
    ['/nope', ROUTES.home],
  ])('maps "%s" to "%s"', (pathname, expected) => {
    expect(routeFromPathname(pathname)).toBe(expected);
  });

  it('navigate changes the route and keeps the query string', () => {
    window.history.replaceState(null, '', '/?lang=pt-BR');
    const { result } = renderHook(() => useRoute());

    act(() => navigate(ROUTES.watch));

    expect(result.current).toBe(ROUTES.watch);
    expect(window.location.search).toBe('?lang=pt-BR');
  });

  it('follows the browser back button', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate(ROUTES.stream));

    act(() => {
      window.history.replaceState(null, '', '/watch');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current).toBe(ROUTES.watch);
  });
});
