import type { MouseEvent, ReactNode } from 'react';
import { navigate, type RoutePath } from '@/lib/router';

interface NavLinkProps {
  to: RoutePath;
  current: RoutePath;
  className?: string;
  children: ReactNode;
}

const opensElsewhere = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

export function NavLink({ to, current, className, children }: Readonly<NavLinkProps>): ReactNode {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (opensElsewhere(event)) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} className={className} aria-current={to === current ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  );
}
