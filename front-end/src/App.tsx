import { useEffect, useRef, useState } from 'react';
import { ApiError, createProject, getProject, sendMessage } from './api/client';
import type { Build, Project } from '@cdk/contract';
import { useProjectEvents } from './hooks/useProjectEvents';
import type { ConnectionStatus } from './WorkingIndicator';
import type { ProjectEventState } from './hooks/useProjectEvents';
import { WorkingIndicator } from './WorkingIndicator';
import { StatusFeed } from './StatusFeed';
import './App.css';
import { BuildDownload } from './d2l/BuildDownload';
import { PreviewPanel } from './preview/PreviewPanel';

function BuildPanel({ build, turn, statusLines, connection, outcome }: {
  build: Build | null;
  turn: ProjectEventState['turn'];
  statusLines: ProjectEventState['statusLines'];
  connection: ConnectionStatus;
  outcome?: string;
}) {
  return <section className="card build-panel" aria-labelledby="build-title" tabIndex={0}>
    <h2 id="build-title">Build</h2>
    {turn.status === 'running' && turn.startedAt !== null && <WorkingIndicator startedAt={turn.startedAt} step={turn.currentStep} connection={connection} />}
    {turn.status === 'running' && statusLines.length > 0 && <StatusFeed lines={statusLines} turnId={turn.id} />}
    {turn.status !== 'running' && turn.status !== 'idle' && <p className="turn-summary">{turn.status === 'completed' ? 'Request complete' : outcome}</p>}
    {!build ? <p className="empty">No build yet.</p> :
      <article className={`build-result build-${build.status}`} aria-labelledby="build-result-title">
        <p className="result-label">Version {build.version}</p>
        <h3 id="build-result-title">{build.status === 'ready' ? 'Ready to download' : build.status === 'failed' ? 'QA needs attention' : 'Build is being checked'}</h3>
        {build.error && <p>{build.error.message}</p>}
        {!!build.qa?.findings.length && <ul className="findings">{build.qa.findings.map((finding, index) =>
          <li key={index}><strong>{finding.severity === 'warn' ? 'WARNING' : 'ERROR'}</strong> {finding.message}{finding.because && <p>{finding.because}</p>}</li>)}</ul>}
        {build.status === 'ready' && <BuildDownload key={build.id} build={build} />}
      </article>}
  </section>;
}

export function App() {
  const reopenId = new URLSearchParams(window.location.search).get('project');
  const [opening, setOpening] = useState(!!reopenId);
  const [project, setProject] = useState<Project | null>(() => {
    if (reopenId) return null;
    try { return JSON.parse(sessionStorage.getItem('active-project') ?? 'null') as Project | null; } catch { return null; }
  });
  const [title, setTitle] = useState('');
  const [requestText, setRequestText] = useState(() => sessionStorage.getItem('request-draft') ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<string | null>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const { statusLines, streamingMessages, messages, outcomes, builds, turn, connection, historyError, addMessage } = useProjectEvents(project?.id ?? null);
  const isBuilding = opening || sending || turn.status === 'running' || (pendingTurn !== null && turn.id !== pendingTurn);
  const latestBuild = [...builds].sort((a, b) => b.version - a.version)[0] ?? null;
  const readyBuild = [...builds].filter(build => build.status === 'ready').sort((a, b) => b.version - a.version)[0] ?? null;
  const latestAgent = messages.filter(message => message.role === 'agent').at(-1);
  const chatHistory = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reopenId) return;
    let cancelled = false;
    void getProject(reopenId).then(result => { if (!cancelled) setProject(result.project); })
      .catch(() => { if (!cancelled) setError(new ApiError('not_found', 'Unable to open this project. Check the project link and reload.')); })
      .finally(() => { if (!cancelled) setOpening(false); });
    return () => { cancelled = true; };
  }, [reopenId]);
  useEffect(() => { if (project) sessionStorage.setItem('active-project', JSON.stringify(project)); }, [project]);
  useEffect(() => { sessionStorage.setItem('request-draft', requestText); }, [requestText]);
  useEffect(() => { const element = chatHistory.current; if (element) element.scrollTop = element.scrollHeight; }, [messages, streamingMessages]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBuilding) return;
    const text = requestText.trim();
    if (!text || (!project && !title.trim())) {
      setError(new ApiError('invalid_request', 'Enter a project title and a request before building.')); return;
    }
    setError(null); setSending(true);
    try {
      const currentProject = project ?? (await createProject({ title: title.trim(), avenue: 'scorm' })).project;
      setProject(currentProject);
      const result = await sendMessage(currentProject.id, { content: [{ type: 'text', text }] });
      addMessage(result.message);
      setPendingTurn(result.turn.id);
      setRequestText(current => current.trim() === text ? '' : current);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('request_failed', 'Unable to send your request.'));
    } finally {
      setSending(false);
      messageBox.current?.focus();
    }
  }

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="D2L Content Development Kit home"><span aria-hidden="true">C</span>D2L Content Development Kit</a></header>
    <section className="intro" aria-labelledby="page-title">
      <h1 id="page-title">{project?.title ?? 'Create an activity'}</h1>
    </section>
    <div className="workspace">
      <section className="card chat-panel" aria-labelledby="chat-title" tabIndex={0}>
        <h2 id="chat-title">Conversation</h2>
        <div ref={chatHistory} className="chat-history" role="group" tabIndex={0} aria-label="Conversation history">
          {messages.map(message => <article className={`chat-message message-${message.role}`} key={message.id}>
            <p className="speaker">{message.role === 'instructor' ? 'You' : 'CDK'}</p>
            <p>{message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')}</p>
            {message.role === 'instructor' && message.turnId && ['failed', 'cancelled'].includes(outcomes[message.turnId]?.status ?? '') &&
              <p className="error">{outcomes[message.turnId]?.message}</p>}
          </article>)}
          {streamingMessages.map(message => <article key={message.id} className="chat-message message-agent"><p className="speaker">CDK</p><p>{message.text}</p></article>)}
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{latestAgent ? `CDK: ${latestAgent.content.filter(block => block.type === 'text').map(block => block.text).join('')}` : ''}</div>
        {historyError && <p className="error" role="alert">{historyError}</p>}
        <form onSubmit={handleSend} className="composer">
          {!project && <><label htmlFor="project-title">Project title</label><input id="project-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g., Cell division practice" maxLength={160} disabled={sending} /></>}
          <label htmlFor="request-text" className={project ? 'sr-only' : undefined}>{project ? 'Describe a change' : 'What should students learn or do?'}</label>
          <textarea ref={messageBox} id="request-text" value={requestText} onChange={event => setRequestText(event.target.value)} placeholder={project ? 'Describe a change or ask a question…' : 'Create a ten-question practice quiz on cell division…'} rows={3} maxLength={20000} />
          <div className="composer-footer">{opening && <p role="status">Opening your project…</p>}<button disabled={isBuilding} type="submit">{sending ? 'Sending…' : isBuilding ? 'Working…' : 'Send'}</button></div>
          {error && <p className="error" role="alert">{error.message}</p>}
        </form>
      </section>
      <BuildPanel build={latestBuild} turn={turn} statusLines={statusLines} connection={connection} outcome={outcomes[turn.id ?? '']?.message} />
      <PreviewPanel build={readyBuild} />
    </div>
  </main>;
}
