import { useEffect, useState } from 'react';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'lost';

export function WorkingIndicator({ startedAt, step, connection }: {
  startedAt: number;
  step: string;
  connection: ConnectionStatus;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const text = connection === 'lost'
    ? 'Connection lost. Reload the page to reconnect.'
    : connection === 'reconnecting'
      ? 'Reconnecting to your request…'
      : step || 'Working on your request';
  return (
    <div className={`working-indicator connection-${connection}`} aria-label="Request progress">
      <span className="working-dot" aria-hidden="true" />
      <span role="status">{text}</span>
      <span className="elapsed-time" aria-live="off" aria-label="Elapsed time">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
    </div>
  );
}
