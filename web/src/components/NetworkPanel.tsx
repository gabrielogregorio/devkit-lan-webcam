import type { ReactNode } from 'react';
import { RetroWindow } from '@/components/RetroWindow';
import { deviceLabel, DEVICE_ICONS } from '@/lib/deviceLabel';
import { t } from '@/lib/i18n';
import type { NetworkPanelData, Peer, PeerRole } from '@/lib/protocol';
import { formatPairingCode } from '@/lib/requestCode';
import { clockLabel, useCountdown } from '@/lib/useCountdown';

interface NetworkPanelProps {
  network: NetworkPanelData;
  receivedAt: number;
}

function roleText(role: PeerRole): string {
  switch (role) {
    case 'camera':
      return t('streaming');
    case 'watching':
      return t('watching');
    case 'pending':
      return t('asked to watch');
    case 'denied':
      return t('denied');
    case 'idle':
      return t('page open');
  }
}

function PeerNode({ peer }: Readonly<{ peer: Peer }>): ReactNode {
  const label = deviceLabel(peer.device);

  return (
    <li className={`node role-${peer.role}${peer.you ? ' you' : ''}`}>
      <span className="node-icon" aria-hidden="true">
        {DEVICE_ICONS[label.kind]}
      </span>
      <span className="node-text">
        <strong>{peer.ip}</strong>
        <span>
          {roleText(peer.role)} · {label.name}
        </span>
      </span>
      {peer.you && <span className="badge">{t('you')}</span>}
    </li>
  );
}

// Who is where on the network: the router, this PC (the server), the camera, every open page, and "you".
export function NetworkPanel({ network, receivedAt }: Readonly<NetworkPanelProps>): ReactNode {
  const secondsLeft = useCountdown(network.pairing.secondsLeft, receivedAt);
  const youAreTheServer = network.you === network.server;

  return (
    <aside className="network-panel" aria-label={t('Network')}>
      <RetroWindow title={'C:\\network\\lan.exe'} tone="blue">
        <div className="network-hub">
          <span className="node">
            <span className="node-icon" aria-hidden="true">
              📶
            </span>
            <span className="node-text">
              <strong>{network.router ?? '?'}</strong>
              <span>{t('router')}</span>
            </span>
          </span>
          <span className={`node${youAreTheServer ? ' you' : ''}`}>
            <span className="node-icon" aria-hidden="true">
              🖥️
            </span>
            <span className="node-text">
              <strong>{network.server}</strong>
              <span>{t('PC (server and webcam)')}</span>
            </span>
            {youAreTheServer && <span className="badge">{t('you')}</span>}
          </span>
        </div>
        <ul className="network-peers" aria-label={t('Open pages')}>
          {network.peers.map((peer, index) => (
            <PeerNode key={`${peer.ip}-${index}`} peer={peer} />
          ))}
        </ul>
        <p className="hint pairing-code">
          {t('Code to pair another device: {code} (changes in {time})', {
            code: formatPairingCode(network.pairing.code),
            time: clockLabel(secondsLeft),
          })}
        </p>
      </RetroWindow>
    </aside>
  );
}
