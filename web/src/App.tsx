import { Camera, Eye } from 'lucide-react';
import type { ReactNode } from 'react';
import { LanguagePicker } from '@/components/LanguagePicker';
import { NavLink } from '@/components/NavLink';
import { NetworkPanel } from '@/components/NetworkPanel';
import { PairingForm } from '@/components/PairingForm';
import { t, useLanguage } from '@/lib/i18n';
import { ROUTES, useRoute } from '@/lib/router';
import { SessionProvider, useSession } from '@/lib/SessionContext';
import type { SessionStore } from '@/lib/sessionStore';
import { StreamPage } from '@/pages/StreamPage';
import { WatchPage } from '@/pages/WatchPage';

interface AppProps {
  store?: SessionStore;
}

export function App({ store }: Readonly<AppProps>): ReactNode {
  return (
    <SessionProvider store={store}>
      <Shell />
    </SessionProvider>
  );
}

function Shell(): ReactNode {
  const route = useRoute();
  const session = useSession();
  // Re-renders the whole page in place when the language changes.
  useLanguage();

  return (
    <>
      <a className="skip-link" href="#content">
        {t('Skip to content')}
      </a>
      <header className="site-header">
        <NavLink to={ROUTES.home} current={route} className="brand">
          {t('LAN Webcam')}
        </NavLink>
        <nav aria-label={t('Pages')} className="site-nav">
          <NavLink to={ROUTES.stream} current={route}>
            <Camera className="icon" aria-hidden="true" />
            {t('Stream')}
          </NavLink>
          <NavLink to={ROUTES.watch} current={route}>
            <Eye className="icon" aria-hidden="true" />
            {t('Watch')}
          </NavLink>
        </nav>
        <LanguagePicker />
      </header>
      <main id="content" className="site-main">
        {session.phase === 'unpaired' ? (
          <PairingForm />
        ) : (
          <>
            {/* The home page is the network: who is where, nothing else. */}
            {route === ROUTES.home && !session.network && <p className="hint">{t('Connecting…')}</p>}
            {/* Always mounted: streaming from this device keeps going while you look at the other pages. */}
            <StreamPage hidden={route !== ROUTES.stream} />
            {route === ROUTES.watch && <WatchPage />}
            {/* The Stream and Watch pages place the network themselves, next to what it explains. */}
            {session.network && route === ROUTES.home && <NetworkPanel network={session.network} heading />}
          </>
        )}
      </main>
    </>
  );
}
