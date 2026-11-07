import { Eye, Maximize } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { RetroWindow } from '@/components/RetroWindow';
import { t } from '@/lib/i18n';
import { formatRequestCode } from '@/lib/requestCode';
import { useSession, useSessionStore } from '@/lib/SessionContext';
import { useWatchStream } from '@/lib/useWatchStream';
import { watchMessages, watchPhase } from '@/lib/watchText';

export function WatchPage(): ReactNode {
  const store = useSessionStore();
  const session = useSession();
  const stageRef = useRef<HTMLDivElement>(null);
  const status = session.status;
  const approved = session.phase === 'open' && status?.access === 'approved' && status.camera;
  const { fps, frameUrl } = useWatchStream(store, approved === true);
  const phase = watchPhase(session.phase, status, frameUrl !== null);
  const messages = watchMessages(t, phase, status?.code ?? null, fps);

  // Asking (or asking again after a denial) works from the button and from the message on the picture.
  const ask = phase === 'not-requested' || phase === 'denied' ? () => store.requestToWatch(phase === 'denied') : null;

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();

      return;
    }
    void stageRef.current?.requestFullscreen?.();
  };

  return (
    <section className="page watch" aria-labelledby="watch-title">
      <RetroWindow title={t('Watching the LAN Webcam')} icon={Eye} titleId="watch-title" className="watch-window">
        <div className="watch-stage" ref={stageRef} onDoubleClick={toggleFullscreen}>
          {frameUrl && <img className="watch-frame" src={frameUrl} alt={t('Live camera')} />}
          {messages.placeholder && ask && (
            <button
              type="button"
              className="watch-placeholder"
              onClick={ask}
              onDoubleClick={(event) => event.stopPropagation()}>
              {messages.placeholder}
            </button>
          )}
          {messages.placeholder && !ask && <p className="watch-placeholder">{messages.placeholder}</p>}
        </div>
        <div id="watchStatus" role="status" className={`status ${messages.kind}`}>
          {messages.status}
        </div>
      </RetroWindow>
      <div className="row">
        {ask && (
          <button type="button" className="primary" onClick={ask}>
            {phase === 'denied' ? t('Ask again with a new code') : t('Ask to watch')}
          </button>
        )}
        <button type="button" onClick={toggleFullscreen}>
          <Maximize className="icon" aria-hidden="true" />
          {t('Full screen')}
        </button>
      </div>
      {status?.code && (
        <p className="request-code">{t('Your code: {code}', { code: formatRequestCode(status.code) })}</p>
      )}
      <p className="hint">
        {t(
          'Each tab asks with its own key; the camera device approves the code shown here. Double click the picture for full screen.',
        )}
      </p>
    </section>
  );
}
