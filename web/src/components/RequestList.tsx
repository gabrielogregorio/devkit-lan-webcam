import type { ReactNode } from 'react';
import { deviceLabel, DEVICE_ICONS } from '@/lib/deviceLabel';
import { t } from '@/lib/i18n';
import type { Decision, WatchRequest } from '@/lib/protocol';

interface RequestListProps {
  requests: readonly WatchRequest[];
  onDecide: (id: string, decision: Decision) => void;
}

function stateText(request: WatchRequest): string {
  if (request.state === 'approved') {
    return request.connected ? t('watching') : t('approved, page closed');
  }

  return request.state === 'denied' ? t('denied') : t('waiting for you');
}

// The camera decides who watches: each request shows the code its tab shows, the IP and the device.
export function RequestList({ requests, onDecide }: Readonly<RequestListProps>): ReactNode {
  if (requests.length === 0) {
    return <p className="hint">{t('Nobody asked to watch yet. Other devices ask on the Watch page.')}</p>;
  }

  return (
    <ul className="requests" aria-label={t('Watch requests')}>
      {requests.map((request) => {
        const label = deviceLabel(request.device);
        const DeviceIcon = DEVICE_ICONS[label.kind];
        // Who asked, as the camera sees it: the address and the device.
        const who = `${request.ip} · ${label.name}`;

        return (
          <li key={request.id} className={`request state-${request.state}`}>
            <span className="node-icon" aria-hidden="true">
              <DeviceIcon className="icon" />
            </span>
            <span className="node-text">
              <strong>{request.ip}</strong>
              <span>
                {label.name} · {stateText(request)}
              </span>
            </span>
            <span className="request-actions">
              {request.state !== 'approved' && (
                <button
                  type="button"
                  className="primary"
                  aria-label={t('Approve {who}', { who })}
                  onClick={() => onDecide(request.id, 'approve')}>
                  {t('Approve')}
                </button>
              )}
              {request.state === 'pending' && (
                <button
                  type="button"
                  aria-label={t('Deny {who}', { who })}
                  onClick={() => onDecide(request.id, 'deny')}>
                  {t('Deny')}
                </button>
              )}
              {request.state === 'approved' && (
                <button
                  type="button"
                  aria-label={t('Revoke {who}', { who })}
                  onClick={() => onDecide(request.id, 'revoke')}>
                  {t('Revoke')}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
