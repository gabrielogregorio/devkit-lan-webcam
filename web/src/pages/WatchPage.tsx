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

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();

      return;
    }
    void stageRef.current?.requestFullscreen?.();
  };

  return (
    <section className="page watch" aria-labelledby="watch-title">
      <RetroWindow title={t('👀 Watching the LAN Webcam')} titleId="watch-title" className="watch-window">
        <div className="watch-stage" ref={stageRef} onDoubleClick={toggleFullscreen}>
          {frameUrl && <img className="watch-frame" src={frameUrl} alt={t('Live camera')} />}
          {messages.placeholder && <p className="watch-placeholder">{messages.placeholder}</p>}
        </div>
        <div id="watchStatus" role="status" className={`status ${messages.kind}`}>
          {messages.status}
        </div>
      </RetroWindow>
      <div className="row">
        {phase === 'not-requested' && (
          <button type="button" className="primary" onClick={() => store.requestToWatch(false)}>
            {t('Ask to watch')}
          </button>
        )}
        {phase === 'denied' && (
          <button type="button" className="primary" onClick={() => store.requestToWatch(true)}>
            {t('Ask again with a new code')}
          </button>
        )}
        <button type="button" onClick={toggleFullscreen}>
          {t('⛶ Full screen')}
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
