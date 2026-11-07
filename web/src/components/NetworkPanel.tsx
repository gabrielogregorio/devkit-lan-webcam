import { Monitor, Network, Router, type LucideIcon } from 'lucide-react';
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

// The most telling role first: it also picks the colour of the line.
const ROLE_ORDER: readonly PeerRole[] = ['camera', 'watching', 'pending', 'denied', 'idle'];

/** Every page open from one address, as one line. */
interface Machine {
  ip: string;
  roles: PeerRole[];
  names: string[];
  icon: LucideIcon;
  you: boolean;
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

const addUnique = <T,>(list: T[], value: T): void => {
  if (!list.includes(value)) {
    list.push(value);
  }
};

// Two tabs on one device are one machine on the network: one line, both roles.
function machinesOf(peers: readonly Peer[]): Machine[] {
  const machines = new Map<string, Machine>();
  for (const peer of peers) {
    const label = deviceLabel(peer.device);
    const machine = machines.get(peer.ip) ?? {
      ip: peer.ip,
      roles: [],
      names: [],
      icon: DEVICE_ICONS[label.kind],
      you: false,
    };
    addUnique(machine.roles, peer.role);
    addUnique(machine.names, label.name);
    machine.you ||= peer.you;
    machines.set(peer.ip, machine);
  }

  return [...machines.values()].map((machine) => ({
    ...machine,
    roles: [...machine.roles].sort((first, second) => ROLE_ORDER.indexOf(first) - ROLE_ORDER.indexOf(second)),
  }));
}

const pagesText = (machine: Machine): string =>
  `${machine.roles.map(roleText).join(' + ')} · ${machine.names.join(' / ')}`;

interface NodeProps {
  icon: LucideIcon;
  ip: string;
  detail: string;
  role?: PeerRole;
  you: boolean;
}

function NetworkNode({ icon: Icon, ip, detail, role, you }: Readonly<NodeProps>): ReactNode {
  const classes = ['node', role && `role-${role}`, you && 'you'].filter(Boolean).join(' ');

  return (
    <li className={classes}>
      <span className="node-icon" aria-hidden="true">
        <Icon className="icon" />
      </span>
      <span className="node-text">
        <strong>{ip}</strong>
        <span>{detail}</span>
      </span>
      {you && <span className="badge">{t('you')}</span>}
    </li>
  );
}

// Who is where on the network, one line per machine: the router, this PC (with any page open on it), the rest.
export function NetworkPanel({ network, receivedAt }: Readonly<NetworkPanelProps>): ReactNode {
  const secondsLeft = useCountdown(network.pairing.secondsLeft, receivedAt);
  const machines = machinesOf(network.peers);
  const onThePc = machines.find((machine) => machine.ip === network.server);
  const others = machines.filter((machine) => machine !== onThePc);
  const pcDetail = [t('PC (server and webcam)'), onThePc && pagesText(onThePc)].filter(Boolean).join(' · ');

  return (
    <aside className="network-panel" aria-label={t('Network')}>
      <RetroWindow title={t('Network')} icon={Network} tone="blue">
        <ul className="network-nodes">
          <NetworkNode icon={Router} ip={network.router ?? '?'} detail={t('router')} you={false} />
          <NetworkNode
            icon={Monitor}
            ip={network.server}
            detail={pcDetail}
            role={onThePc?.roles[0]}
            you={network.you === network.server || onThePc?.you === true}
          />
          {others.map((machine) => (
            <NetworkNode
              key={machine.ip}
              icon={machine.icon}
              ip={machine.ip}
              detail={pagesText(machine)}
              role={machine.roles[0]}
              you={machine.you}
            />
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
