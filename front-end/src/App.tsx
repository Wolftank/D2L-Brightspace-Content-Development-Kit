import { useEffect, useRef, useState } from 'react';
import { ApiError, buildDownloadUrl, createProject, projectEventsUrl, sendMessage } from './api/client';
import type { Build, EventKind, EventPayloads, Project } from './api/types';
import './App.css';

type FeedItem = { id: number; text: string };

const eventKinds: EventKind[] = ['turn.started', 'turn.status', 'message.delta', 'message.completed', 'tool.started', 'tool.finished', 'build.created', 'build.updated', 'deployment.updated', 'turn.completed', 'turn.failed', 'turn.cancelled'];

function eventText(kind: EventKind, payload: unknown): string | null {
  switch (kind) {
    case 'turn.started': return 'Starting your build';
    case 'turn.status': return (payload as EventPayloads['turn.status']).text;
    case 'message.completed': return 'The agent has finished its response';
    case 'tool.started': return (payload as EventPayloads['tool.started']).summary;
    case 'tool.finished': return (payload as EventPayloads['tool.finished']).summary;
    case 'build.created': return 'Creating the build';
    case 'turn.completed': return 'Build complete';
    case 'turn.failed': return (payload as EventPayloads['turn.failed']).error.message;
    case 'turn.cancelled': return 'Build cancelled';
    default: return null;
  }
}

function InlineError({ error }: { error: ApiError | null }) {
  return error ? <p className="error" role="alert">{error.message}</p> : null;
}

export function App() {
  const [title, setTitle] = useState('');
  const [requestText, setRequestText] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => () => streamRef.current?.close(), []);

  function addFeed(id: number, text: string | null): void {
    if (text) setFeed((items) => [...items, { id, text }]);
  }

  function openEventStream(projectId: string): void {
    streamRef.current?.close();
    const stream = new EventSource(projectEventsUrl(projectId));
    streamRef.current = stream;
    for (const kind of eventKinds) {
      stream.addEventListener(kind, (event) => {
        const payload: unknown = JSON.parse((event as MessageEvent<string>).data);
        addFeed(Number(event.lastEventId), eventText(kind, payload));
        if (kind === 'build.created' || kind === 'build.updated') setBuild((payload as EventPayloads['build.created']).build);
        if (kind === 'turn.completed' || kind === 'turn.failed' || kind === 'turn.cancelled') {
          setIsBuilding(false);
          stream.close();
        }
      });
    }
    stream.onerror = () => {
      if (stream.readyState !== EventSource.CLOSED) setError(new ApiError('stream_interrupted', 'The progress connection was interrupted. Refresh the page to reconnect.'));
    };
  }

  async function handleBuild(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanRequest = requestText.trim();
    if (!cleanTitle || !cleanRequest) {
      setError(new ApiError('invalid_request', 'Enter a project title and a request before building.'));
      return;
    }
    setError(null);
    setFeed([]);
    setBuild(null);
    setIsBuilding(true);
    try {
      const currentProject = project?.title === cleanTitle
        ? project
        : (await createProject({ title: cleanTitle, avenue: 'scorm' })).project;
      setProject(currentProject);
      openEventStream(currentProject.id);
      await sendMessage(currentProject.id, { content: [{ type: 'text', text: cleanRequest }] });
    } catch (caughtError) {
      streamRef.current?.close();
      setIsBuilding(false);
      setError(caughtError instanceof ApiError ? caughtError : new ApiError('request_failed', 'Unable to start the build.'));
    }
  }

  const findings = build?.qa?.findings ?? [];
  return (
    <main className="app-shell">
      <header className="topbar"><a className="brand" href="/" aria-label="D2L Content Development Kit home"><span aria-hidden="true">C</span>D2L Content Development Kit</a><span className="local-label">Local mode</span></header>
      <section className="intro" aria-labelledby="page-title"><p className="eyebrow">COURSE MATERIAL WORKSPACE</p><h1 id="page-title">Describe what you want to build.</h1><p>We will create a SCORM learning activity, check it against the course requirements, and prepare it for download.</p></section>
      <div className="workspace">
        <section className="card" aria-labelledby="configurator-title"><p className="eyebrow">01 / CONFIGURE</p><h2 id="configurator-title">Your request</h2><form onSubmit={handleBuild}>
          <label htmlFor="project-title">Project title</label><input id="project-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g., Cell division practice" maxLength={160} disabled={isBuilding} />
          <label htmlFor="request-text">What should students learn or do?</label><textarea id="request-text" value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="For example: Create a ten-question multiple-choice practice set on cell division. Students can retake it, with the best score sent to the gradebook." rows={8} maxLength={20_000} disabled={isBuilding} />
          <p className="hint">The initial version creates a SCORM activity. More content types will be added in a later layer.</p><button type="submit" disabled={isBuilding}>{isBuilding ? 'Building…' : 'Build activity'}</button><InlineError error={error} />
        </form></section>
        <section className="card build-panel" aria-labelledby="build-title"><p className="eyebrow">02 / BUILD STATUS</p><h2 id="build-title">Build panel</h2>
          {feed.length === 0 && !error && <p className="empty">Build progress will appear here after you submit a request.</p>}
          {feed.length > 0 && <ol className="status-feed" aria-live="polite">{feed.map((item) => <li key={item.id}>{item.text}</li>)}</ol>}
          {build && <article className={`build-result build-${build.status}`} aria-labelledby="build-result-title"><p className="result-label">BUILD {build.version}</p><h3 id="build-result-title">{build.status === 'ready' ? 'Ready to download' : 'QA needs attention'}</h3>{build.qa && <p>{build.qa.passed ? 'The QA gate passed.' : `${findings.length} QA finding${findings.length === 1 ? '' : 's'} need review.`}</p>}{findings.length > 0 && <ul className="findings">{findings.map((finding) => <li key={`${finding.rule}-${finding.line ?? 'none'}`}><strong>{finding.severity.toUpperCase()}</strong> {finding.message}</li>)}</ul>}{build.status === 'ready' && <a className="download" href={buildDownloadUrl(build.id)}>Download SCORM package</a>}</article>}
        </section>
      </div>
    </main>
  );
}
