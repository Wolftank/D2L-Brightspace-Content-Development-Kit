import { useEffect, useRef, useState } from 'react';
import type { Build } from '../api/types';
import { previewSession } from './session';
import './preview.css';

type Selection = Pick<Build, 'id' | 'version'>;

export function PreviewPanel({ build }: { build: Selection | null }) {
  const [attempt, setAttempt] = useState(0);
  return <section className="card preview-panel" aria-labelledby="preview-title" tabIndex={0}>
    <div className="preview-header">
      <div><p className="eyebrow">03 / PREVIEW</p><h2 id="preview-title">{build ? 'Preview · Version ' + build.version : 'Preview'}</h2>
        <p>Local preview — results are not sent to Brightspace.</p></div>
      {build && <button type="button" onClick={() => setAttempt(value => value + 1)}>Restart preview</button>}
    </div>
    {build ? <PreviewAttempt key={build.id + ':' + attempt} build={build} onRetry={() => setAttempt(value => value + 1)} /> :
      <p className="preview-placeholder">Your activity will appear here when the first build is ready.</p>}
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
