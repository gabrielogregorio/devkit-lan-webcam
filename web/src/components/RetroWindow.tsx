import type { ReactNode } from 'react';

export type WindowTone = 'violet' | 'teal' | 'pink' | 'blue';

interface RetroWindowProps {
  title: ReactNode;
  /** With an id the title is a real heading (for aria-labelledby); without it the title is decoration only. */
  titleId?: string;
  level?: 1 | 2;
  tone?: WindowTone;
  className?: string;
  children: ReactNode;
}

// A Y2K desktop window: a coloured title bar with three little buttons, a thick outline and a hard shadow.
export function RetroWindow({
  title,
  titleId,
  level = 1,
  tone = 'violet',
  className,
  children,
}: Readonly<RetroWindowProps>): ReactNode {
  const Heading = level === 1 ? 'h1' : 'h2';
  const classes = ['window', `tone-${tone}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="window-bar">
        {titleId ? (
          <Heading id={titleId} className="window-title">
            {title}
          </Heading>
        ) : (
          <span className="window-title" aria-hidden="true">
            {title}
          </span>
        )}
        <span className="window-buttons" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div className="window-body">{children}</div>
    </div>
  );
}
