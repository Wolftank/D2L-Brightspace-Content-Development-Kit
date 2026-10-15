import { useLayoutEffect, useRef, useState } from 'react';
import type { StatusLine } from './hooks/useProjectEvents';

export function StatusFeed({ lines, turnId }: { lines: StatusLine[]; turnId: string | null }) {
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTurn = useRef(turnId);
  const [details, setDetails] = useState(false);
  const visibleLines = details ? lines : lines.filter(line => line.failed || !['reading', 'searching', 'other'].includes(line.category ?? 'building'));
  const [paused, setPaused] = useState(false);

  useLayoutEffect(() => {
    if (previousTurn.current !== turnId) {
      previousTurn.current = turnId;
      following.current = true;
      setPaused(false);
    }
    if (following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [lines, turnId, details]);

  function jumpToLatest() {
    following.current = true;
    setPaused(false);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }

  return (
    <div className="status-feed-panel">
      <button type="button" aria-expanded={details} aria-controls="progress-steps" onClick={() => setDetails(value => !value)}>{details ? 'Hide details' : 'Show details'}</button>
      <div id="progress-steps" className="status-feed-viewport" ref={viewport} role="log" aria-label="Build progress"
        aria-live="polite" aria-relevant="additions text" tabIndex={0}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            following.current = false;
            setPaused(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'End') {
            event.preventDefault();
            jumpToLatest();
            return;
          }
          if (['Home', 'PageUp', 'ArrowUp'].includes(event.key)) {
            following.current = false;
            setPaused(true);
            if (event.key === 'Home') {
              event.preventDefault();
              event.currentTarget.scrollTop = 0;
            }
          }
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 4;
          setPaused(!following.current);
        }}>
        <ol className="status-feed">
          {visibleLines.map((line) => <li key={line.seq}>{line.text}</li>)}
        </ol>
      </div>
      <div className="status-feed-controls">
        {paused && <button type="button" onClick={jumpToLatest}>Jump to latest</button>}
      </div>
    </div>
  );
}
