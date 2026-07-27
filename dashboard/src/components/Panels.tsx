import type { MessageStatus, Stats } from '../types';

const STATUS_ORDER: MessageStatus[] = [
  'queued',
  'deferred',
  'delivered',
  'bounced',
  'suppressed',
];

const STATUS_TONE: Record<MessageStatus, string> = {
  queued: 'queued',
  deferred: 'defer',
  delivered: 'ok',
  bounced: 'fail',
  suppressed: 'supp',
};

export function Outcomes({ stats }: { stats: Stats | null }) {
  const counts = new Map(stats?.statuses.map((s) => [s.status, s.count]));
  return (
    <section className="panel">
      <h2 className="panel-title">outcomes</h2>
      <dl className="outcomes">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="outcome">
            <dt className={`tone-${STATUS_TONE[status]}`}>{status}</dt>
            <dd>{counts.get(status) ?? 0}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Queues({ stats }: { stats: Stats | null }) {
  // Retry buckets are ephemeral TTL queues — only interesting while they
  // hold messages; the core queues stay visible even at zero.
  const queues = (stats?.queues ?? []).filter(
    (q) => !q.name.startsWith('emails.retry.') || q.messages > 0,
  );
  const max = Math.max(1, ...queues.map((q) => q.messages));
  return (
    <section className="panel">
      <h2 className="panel-title">queue depths</h2>
      {queues.length === 0 ? (
        <p className="empty">No queues visible — is RabbitMQ up?</p>
      ) : (
        <ul className="queues">
          {queues.map((q) => (
            <li key={q.name}>
              <span className="queue-name">{q.name}</span>
              <span className="queue-bar-track">
                <span
                  className="queue-bar"
                  style={{ width: `${(q.messages / max) * 100}%` }}
                />
              </span>
              <span className="queue-count">{q.messages}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Placements({ stats }: { stats: Stats | null }) {
  const rows = stats?.placements ?? [];
  const providers = [...new Set(rows.map((r) => r.provider))].sort();
  return (
    <section className="panel">
      <h2 className="panel-title">inbox vs spam</h2>
      {providers.length === 0 ? (
        <p className="empty">
          Nothing placed yet. Accepted (250) mail lands here — inbox or spam.
        </p>
      ) : (
        <ul className="placements">
          {providers.map((provider) => {
            const inbox =
              rows.find((r) => r.provider === provider && r.folder === 'inbox')
                ?.count ?? 0;
            const spam =
              rows.find((r) => r.provider === provider && r.folder === 'spam')
                ?.count ?? 0;
            const total = Math.max(1, inbox + spam);
            return (
              <li key={provider}>
                <span className="queue-name">{provider}</span>
                <span className="placement-track">
                  <span
                    className="placement-inbox"
                    style={{ width: `${(inbox / total) * 100}%` }}
                  />
                  <span
                    className="placement-spam"
                    style={{ width: `${(spam / total) * 100}%` }}
                  />
                </span>
                <span className="queue-count">
                  <span className="tone-ok">{inbox}</span>
                  {' / '}
                  <span className="tone-defer">{spam}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
