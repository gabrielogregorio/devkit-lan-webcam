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
import { HomePage } from '@/pages/HomePage';
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
            {route === ROUTES.home && <HomePage />}
            {/* Always mounted: streaming from this device keeps going while you look at the other pages. */}
            <StreamPage hidden={route !== ROUTES.stream} />
            {route === ROUTES.watch && <WatchPage />}
            {session.network && <NetworkPanel network={session.network} />}
          </>
        )}
      </main>
    </>
  );
}
