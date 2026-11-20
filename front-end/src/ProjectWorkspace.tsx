import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, cancelTurn, createProject, listProjectFiles, sendMessage, uploadProjectFile } from './api/client';
import type { Build, ContentBlock, Message, Project, ProjectFile } from '@cdk/contract';
import { useAgentSignIn } from './hooks/useAgentSignIn';
import { useProjectEvents } from './hooks/useProjectEvents';
import type { ConnectionStatus } from './WorkingIndicator';
import type { ProjectEventState } from './hooks/useProjectEvents';
import { WorkingIndicator } from './WorkingIndicator';
import { StatusFeed } from './StatusFeed';
import './App.css';
import { AttachmentLabels, AttachmentPicker } from './attachments/Attachments';
import { attachmentProblem, MAX_ATTACHMENTS, type Attachment } from './attachments/validation';
import { AppHeader } from './projects/AppHeader';
import { readFailure } from './api/failure';
import { BuildDownload } from './d2l/BuildDownload';
import { ErrorNotice } from './ErrorNotice';
import { PreviewPanel } from './preview/PreviewPanel';

function messageText(message: Message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}

function messageFiles(message: Message) {
  return message.content.filter(block => block.type === 'file');
}

function BuildPanel({ build, turn, statusLines, connection, outcome, disabled, onAskForFix, onSendAgain, onEdit, onNewProject }: {
  build: Build | null;
  turn: ProjectEventState['turn'];
  statusLines: ProjectEventState['statusLines'];
  connection: ConnectionStatus;
  outcome?: string;
  disabled: boolean;
  onAskForFix: () => void;
  onSendAgain: () => void;
  onEdit: () => void;
  onNewProject: () => void;
}) {
  return <section className="card build-panel" aria-labelledby="build-title" tabIndex={0}>
    <h2 className="panel-heading" id="build-title">Build</h2>
    {turn.status === 'running' && turn.startedAt !== null && <WorkingIndicator startedAt={turn.startedAt} step={turn.currentStep} connection={connection} />}
    {statusLines.length > 0 && <StatusFeed lines={statusLines} turnId={turn.id} />}
    {turn.status !== 'running' && turn.status !== 'idle' && <p className="turn-summary">{turn.status === 'completed' ? 'Request complete' : turn.status === 'cancelled' ? 'Request stopped.' : outcome}</p>}
    {!build ? <p className="empty">No build yet.</p> :
      <article className={`build-result build-${build.status}`} aria-labelledby="build-result-title">
        <p className="result-label">Version {build.version}</p>
        <h3 id="build-result-title">{build.status === 'ready' ? 'Ready to download' : build.status === 'failed' ? 'QA needs attention' : 'Build is being checked'}</h3>
        {build.error && <ErrorNotice failure={readFailure(build.error)} disabled={disabled} onAskForFix={onAskForFix} onSendAgain={onSendAgain} onEdit={onEdit} onNewProject={onNewProject} />}
        {!!build.qa?.findings.length && <ul className="findings">{build.qa.findings.map((finding, index) =>
          <li key={index}><strong>{finding.severity === 'warn' ? 'WARNING' : 'ERROR'}</strong> {finding.message}{finding.because && <p>{finding.because}</p>}</li>)}</ul>}
        {!!build.suggestions?.length && <section aria-labelledby="build-suggestions-title" className="build-suggestions">
          <h4 id="build-suggestions-title">Suggestions</h4>
          <p>These suggestions are optional and do not affect the download.</p>
          <ul className="findings">{build.suggestions.map(({ framework, principle, suggestion, reason }, index) =>
            <li key={index}><strong>{framework.toUpperCase()} · {principle}</strong> {suggestion}<p>{reason}</p></li>)}</ul>
        </section>}
        {build.status === 'ready' && <BuildDownload key={build.id} build={build} />}
      </article>}
  </section>;
}

export function ProjectWorkspace({ initialProject = null, initialTurnId }: { initialProject?: Project | null; initialTurnId?: string }) {
  const [project, setProject] = useState<Project | null>(initialProject);
  const draftKey = 'request-draft-' + (project?.id ?? 'new');
  const [title, setTitle] = useState('');
  const [requestText, setRequestText] = useState(() => sessionStorage.getItem(draftKey) ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [fileListError, setFileListError] = useState(false);
  const [fileListAttempt, setFileListAttempt] = useState(0);
  const nextAttachment = useRef(0);
  const uploaded = useRef(new Map<number, ProjectFile>());
  const submitLock = useRef(false);
  const [pendingTurn, setPendingTurn] = useState<string | null>(initialTurnId ?? null);
  const [stopAttempt, setStopAttempt] = useState<{ turnId: string; error?: string } | null>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const agent = useAgentSignIn();
  const { statusLines, streamingMessages, messages, outcomes, builds, turn, connection, historyError, reconnect, addMessage } = useProjectEvents(project?.id ?? null);
  const pendingStatus = pendingTurn ? outcomes[pendingTurn]?.status : undefined;
  const awaitingTurn = !pendingStatus || pendingStatus === 'queued' || pendingStatus === 'running';
  const activeTurnId = pendingTurn !== null && turn.id !== pendingTurn && awaitingTurn
    ? pendingTurn : turn.status === 'running' ? turn.id : null;
  const isBuilding = sending || activeTurnId !== null;
  const cannotSend = isBuilding || !agent.ready;
  const activeStop = stopAttempt?.turnId === activeTurnId ? stopAttempt : null;
  const stopping = activeStop !== null && !activeStop.error;
  const latestBuild = [...builds].sort((a, b) => b.version - a.version)[0] ?? null;
  const readyBuild = [...builds].filter(build => build.status === 'ready').sort((a, b) => b.version - a.version)[0] ?? null;
  const latestAgent = messages.filter(message => message.role === 'agent').at(-1);
  const hasMessages = messages.length > 0 || streamingMessages.length > 0;
  const chatHistory = useRef<HTMLDivElement>(null);

  useEffect(() => { sessionStorage.setItem(draftKey, requestText); }, [draftKey, requestText]);
  useEffect(() => { if (agent.confirmed) messageBox.current?.focus(); }, [agent.confirmed]);
  const sentFailedForSignIn = pendingStatus === 'failed' && outcomes[pendingTurn ?? '']?.failure?.nextStep === 'sign_in';
  const { signedOut } = agent;
  useEffect(() => { if (sentFailedForSignIn) signedOut(); }, [sentFailedForSignIn, signedOut]);
  useEffect(() => { const element = chatHistory.current; if (element) element.scrollTop = element.scrollHeight; }, [messages, streamingMessages]);

  const projectId = project?.id;
  const needsFileNames = messages.some(message => messageFiles(message).some(block => !Object.hasOwn(fileNames, block.fileId)));
  useEffect(() => {
    if (!projectId || !needsFileNames) return;
    let current = true;
    listProjectFiles(projectId).then(({ items }) => {
      if (!current) return;
      setFileNames(names => ({ ...names, ...Object.fromEntries(items.map(file => [file.id, file.name])) }));
      setFileListError(false);
    }).catch(() => { if (current) setFileListError(true); });
    return () => { current = false; };
  }, [projectId, needsFileNames, fileListAttempt]);

  const addAttachments = useCallback((files: File[]) => {
    if (submitLock.current || !files.length) return;
    const next = [...attachments];
    const refused: string[] = [];
    for (const file of files) {
      const problem = attachmentProblem(file) ?? (next.length >= MAX_ATTACHMENTS ? 'you can attach up to 10 files.' : undefined);
      if (problem) refused.push(file.name + ': ' + problem);
      else next.push({ id: ++nextAttachment.current, file });
    }
    setAttachments(next);
    setAttachmentNotice(refused.length ? 'Could not attach ' + refused.join(' ') : '');
  }, [attachments]);

  function removeAttachment(id: number) {
    if (submitLock.current) return;
    setAttachments(items => items.filter(item => item.id !== id));
    uploaded.current.delete(id);
    setAttachmentNotice('');
    setUploadError('');
    messageBox.current?.focus();
  }

  function startNewProject() {
    setAttachments([]); uploaded.current.clear(); setAttachmentNotice(''); setUploadError('');
    setFileNames({}); setFileListError(false);
    setProject(null); setTitle(''); setPendingTurn(null); setError(null);
    window.history.replaceState(null, '', '/?new=1');
    messageBox.current?.focus();
  }

  async function stopRequest() {
    if (!activeTurnId || stopping) return;
    const turnId = activeTurnId;
    setStopAttempt({ turnId });
    messageBox.current?.focus();
    try {
      await cancelTurn(turnId);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Try again.';
      setStopAttempt(current => current?.turnId === turnId ? { turnId, error: message } : current);
    }
  }

  function askForFix() {
    setRequestText(current => current.trim() ? current : 'Please fix the problems reported by the QA check' + (latestBuild ? ' in build ' + latestBuild.version : '') + '.');
    messageBox.current?.focus();
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitRequest(requestText, attachments);
  }

  async function submitRequest(request: string, draftFiles: Attachment[] = [], existingFiles: Extract<ContentBlock, { type: 'file' }>[] = []) {
    if (cannotSend || submitLock.current) return;
    const text = request.trim();
    if (!text || (!project && !title.trim())) {
      setError(new ApiError('invalid_request', 'Enter a project title and a request before building.')); return;
    }
    submitLock.current = true;
    setError(null); setUploadError(''); setSending(true);
    try {
      const currentProject = project ?? (await createProject({ title: title.trim(), avenue: 'scorm' })).project;
      if (!project) sessionStorage.removeItem('request-draft-new');
      setProject(currentProject);
      window.history.replaceState(null, '', '/?project=' + encodeURIComponent(currentProject.id));
      const fileBlocks = [...existingFiles];
      for (const item of draftFiles) {
        let file = uploaded.current.get(item.id);
        if (file?.projectId !== currentProject.id) {
          try {
            file = (await uploadProjectFile(currentProject.id, item.file)).file;
            uploaded.current.set(item.id, file);
          } catch (caught) {
            const reason = caught instanceof ApiError ? caught.message : 'Try again.';
            setUploadError('Could not upload ' + item.file.name + '. ' + reason + ' Your message was not sent.');
            return;
          }
        }
        setFileNames(names => ({ ...names, [file.id]: file.name }));
        fileBlocks.push({ type: 'file', fileId: file.id });
      }
      const result = await sendMessage(currentProject.id, { content: [{ type: 'text', text }, ...fileBlocks] });
      if (draftFiles.length) {
        setAttachments([]);
        uploaded.current.clear();
        setAttachmentNotice('');
      }
      addMessage(result.message);
      setPendingTurn(result.turn.id);
      setRequestText(current => current.trim() === text ? '' : current);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('request_failed', 'Unable to send your request.'));
    } finally {
      submitLock.current = false;
      setSending(false);
      messageBox.current?.focus();
    }
  }

  return <main className="app-shell">
    <AppHeader />
    <section className="intro" aria-labelledby="page-title">
      <p className="workspace-eyebrow">{project ? 'Project:' : 'Course material workspace'}</p>
      <h1 id="page-title">{project?.title ?? 'Create an activity'}</h1>
    </section>
    <div className="workspace">
      <section className="card chat-panel" aria-labelledby="chat-title" tabIndex={0}>
        <h2 className="panel-heading" id="chat-title">Design</h2>
        <div ref={chatHistory} className="chat-history" hidden={!hasMessages} role="group" tabIndex={0} aria-label="Conversation history">
          {messages.map(message => <article className={`chat-message message-${message.role}`} key={message.id}>
            <p className="speaker">{message.role === 'instructor' ? 'You' : 'CDK'}</p>
            <p>{messageText(message)}</p>
            <AttachmentLabels items={Array.from(new Set(messageFiles(message).map(block => block.fileId)), id => ({ id, name: fileNames[id] ?? 'Attachment' }))} />
            {message.role === 'instructor' && message.turnId && outcomes[message.turnId]?.status === 'cancelled' &&
              <p className="stopped-request">Request stopped.</p>}
            {message.role === 'instructor' && message.turnId && outcomes[message.turnId]?.status === 'failed' &&
              <ErrorNotice failure={outcomes[message.turnId]?.failure ?? { message: 'This request could not be completed.', nextStep: 'try_later' }} disabled={cannotSend} onSignIn={() => void agent.start()}
                onSendAgain={() => void submitRequest(messageText(message), [], messageFiles(message))}
                onEdit={() => { setRequestText(message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); messageBox.current?.focus(); }}
                onNewProject={startNewProject} onAskForFix={askForFix} />}
          </article>)}
          {streamingMessages.map(message => <article key={message.id} className="chat-message message-agent"><p className="speaker">CDK</p><p>{message.text}</p></article>)}
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{latestAgent ? `CDK: ${latestAgent.content.filter(block => block.type === 'text').map(block => block.text).join('')}` : ''}</div>
        {project && connection !== 'connected' && <div className="connection-notice"><p role="status">{connection === 'reconnecting' ? 'Reconnecting to your request…' : 'Connection lost. Try connecting again.'}</p>{connection === 'lost' && <button type="button" onClick={reconnect}>Try again</button>}</div>}
        {historyError && <div><p className="error" role="alert">Unable to load the conversation.</p><button type="button" onClick={reconnect}>Try loading the conversation again</button></div>}
        <div className={agent.ready ? 'sr-only' : 'sign-in-notice'} role="group" aria-label="Claude sign-in">
          <p role="status">{agent.notice}</p>
          {!agent.ready && <>
            <button type="button" disabled={agent.busy} onClick={() => void agent.start()}>Sign in to Claude</button>
            <button type="button" disabled={agent.busy} onClick={() => void agent.checkAgain()}>Check again</button>
          </>}
        </div>
        {fileListError && needsFileNames && <div><p className="error" role="alert">Unable to load attachment names.</p><button type="button" onClick={() => setFileListAttempt(attempt => attempt + 1)}>Try loading attachment names again</button></div>}
        <form onSubmit={handleSend} className={hasMessages ? 'composer' : 'composer composer-empty'}>
          {!project && <><label htmlFor="project-title">Project title</label><input id="project-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g., Cell division practice" maxLength={160} disabled={sending} /></>}
          <label htmlFor="request-text" className={project ? 'sr-only' : undefined}>{project ? 'Describe a change' : 'What should students learn or do?'}</label>
          <AttachmentLabels items={attachments.map(({ id, file }) => ({ id, name: file.name }))} onRemove={removeAttachment} disabled={sending} />
          <textarea ref={messageBox} id="request-text" value={requestText} onChange={event => setRequestText(event.target.value)} placeholder={project ? 'Describe a change or ask a question…' : 'Create a ten-question practice quiz on cell division…'} rows={3} maxLength={20000} />
          <div className="composer-footer">
            <AttachmentPicker disabled={sending} onAdd={addAttachments} />
            {activeTurnId && <button className="stop-request" type="button" disabled={stopping} onClick={() => void stopRequest()}>{stopping ? 'Stopping…' : 'Stop request'}</button>}
            <button disabled={cannotSend} type="submit">{sending ? 'Sending…' : isBuilding ? 'Working…' : 'Send'}</button>
          </div>
          <div className="sr-only" role="status">{stopping ? 'Stopping request.' : turn.status === 'cancelled' && !activeTurnId ? 'Request stopped. You can send a follow-up.' : ''}</div>
          {attachmentNotice && <p role="alert" className="error">{attachmentNotice}</p>}
          {uploadError && <p className="error" role="alert">{uploadError}</p>}
          {activeStop?.error && <p className="error" role="alert">Unable to stop the request. {activeStop.error}</p>}
          {error && <ErrorNotice failure={error} disabled={cannotSend} onSendAgain={() => void submitRequest(requestText, attachments)} onEdit={() => messageBox.current?.focus()} onNewProject={startNewProject} onAskForFix={askForFix} onSignIn={() => void agent.start()} />}
        </form>
      </section>
      <BuildPanel build={latestBuild} turn={turn} statusLines={statusLines} connection={connection} outcome={outcomes[turn.id ?? '']?.message} disabled={isBuilding} onAskForFix={askForFix}
        onSendAgain={() => { const original = messages.find(message => message.role === 'instructor' && message.turnId === latestBuild?.turnId); if (original) void submitRequest(messageText(original), [], messageFiles(original)); }}
        onEdit={() => messageBox.current?.focus()} onNewProject={startNewProject} />
      <PreviewPanel build={readyBuild} />
    </div>
  </main>;
}
