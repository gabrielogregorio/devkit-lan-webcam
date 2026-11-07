import { render, renderHook, screen } from '@testing-library/react';
import { SessionProvider, useSession, useSessionStore } from '@/lib/SessionContext';

function Phase(): string {
  return useSession().phase;
}

describe('SessionContext', () => {
  it('needs the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useSessionStore())).toThrow('useSessionStore outside SessionProvider');
    vi.restoreAllMocks();
  });

  it('makes its own store when none is given and starts it', () => {
    render(
      <SessionProvider>
        <Phase />
      </SessionProvider>,
    );

    expect(screen.getByText('unpaired')).toBeInTheDocument();
  });
});
