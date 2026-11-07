import type { ReactNode } from 'react';
import { NavLink } from '@/components/NavLink';
import { t } from '@/lib/i18n';
import { ROUTES } from '@/lib/router';

export function HomePage(): ReactNode {
  return (
    <section className="page home" aria-labelledby="home-title">
      <h1 id="home-title">{t('LAN Webcam')}</h1>
      <p className="lead">{t('Any camera on your network becomes a webcam on the PC.')}</p>
      <div className="cards">
        <NavLink to={ROUTES.stream} current={ROUTES.home} className="card">
          <span className="card-title">{t('📷 Stream')}</span>
          <strong>{t('Stream this camera')}</strong>
          <span>{t('Use the camera of this device as the "LAN Webcam" on the PC, and approve who may watch it.')}</span>
        </NavLink>
        <NavLink to={ROUTES.watch} current={ROUTES.home} className="card">
          <span className="card-title">{t('👀 Watch')}</span>
          <strong>{t('Watch the camera')}</strong>
          <span>{t('Ask to watch the camera another device is streaming; it approves your code.')}</span>
        </NavLink>
      </div>
      <p className="hint">
        {t('Open the Stream page on the phone and the Watch page on the PC: both are linked at the top of every page.')}
      </p>
    </section>
  );
}
