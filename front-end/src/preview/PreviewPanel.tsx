import { useEffect, useRef, useState } from 'react';
import type { Build } from '../api/types';
import { previewSession } from './session';
import './preview.css';

type Selection = Pick<Build, 'id' | 'version'>;

export function PreviewPanel({ build, onClose }: { build: Selection; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return <section className="preview-panel" aria-labelledby="preview-title">
    <div className="preview-header">
      <div><h2 id="preview-title" ref={heading} tabIndex={-1}>Preview — Build {build.version}</h2>
        <p>Local preview — results are not sent to Brightspace.</p></div>
      <div className="preview-controls">
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Restart preview</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
    <PreviewAttempt key={`${build.id}:${attempt}`} build={build} onRetry={() => setAttempt((value) => value + 1)} />
  </section>;
}

function PreviewAttempt({ build, onRetry }: { build: Selection; onRetry: () => void }) {
  const [session] = useState(() => {
    try { return { ...previewSession(build.id), error: null }; }
    catch (error) { return { url: '', origin: '', attempt: '', error: (error as Error).message }; }
  });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(session.error ? 'error' : 'loading');
  const [error, setError] = useState(session.error);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (session.error) return;
    const timer = window.setTimeout(() => {
      setError('The activity could not be opened. Check the preview service and try again.');
      setStatus('error');
    }, 20_000);
    function receive(event: MessageEvent) {
      if (event.origin !== session.origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (!message || message.type !== 'cdk-preview' || message.attempt !== session.attempt || message.buildId !== build.id) return;
      if (message.status !== 'ready' && message.status !== 'error') return;
      window.clearTimeout(timer);
      setStatus(message.status);
      if (message.status === 'error') setError(message.reason === 'unavailable'
        ? 'This saved build is unavailable for preview. Try again.'
        : 'The activity could not be opened. Try again.');
    }
    window.addEventListener('message', receive);
    return () => { window.clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [build.id, session]);

  return <div className="preview-stage">
    {status === 'loading' && <p role="status">Loading preview…</p>}
    {status === 'ready' && <p role="status">Preview ready.</p>}
    {status === 'error' ? <div><p role="alert">{error}</p><button type="button" onClick={onRetry}>Retry preview</button></div>
      : <iframe ref={frame} src={session.url} title={`Interactive preview of build ${build.version}`}
        sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" hidden={status !== 'ready'}
        onError={() => { setError('The activity could not be opened. Try again.'); setStatus('error'); }} />}
  </div>;
}
