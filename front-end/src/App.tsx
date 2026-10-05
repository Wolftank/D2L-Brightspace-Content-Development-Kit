import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  buildDownloadUrl,
  createProject,
  sendMessage,
} from './api/client';
import type { Build, Project } from './api/types';
import { useProjectEvents } from './hooks/useProjectEvents';
import './App.css';
import { WorkingIndicator } from './WorkingIndicator';
import { PreviewPanel } from './preview/PreviewPanel';

function InlineError({ error }: { error: ApiError | null }) {
  return error ? (
    <p className="error" role="alert">
      {error.message}
    </p>
  ) : null;
}

export function App() {
  const [title, setTitle] = useState('');
  const [requestText, setRequestText] = useState('');
  const [project, setProject] = useState<Project | null>(() => {
  const saved = sessionStorage.getItem('active-project');

  if (!saved) {
    return null;
  }

  try {
    return JSON.parse(saved) as Project;
  } catch {
    return null;
  }
});


  const [error, setError] = useState<ApiError | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [preview, setPreview] = useState<Pick<Build, 'id' | 'version'> | null>(null);
  const previewOpener = useRef<HTMLButtonElement | null>(null);

  function closePreview() {
    setPreview(null);
    if (previewOpener.current?.isConnected) previewOpener.current.focus();
    else document.getElementById('build-title')?.focus();
  }


  const {
    statusLines,
    replyText,
    builds,
    turn,
    connection,
  } = useProjectEvents(project?.id ?? null);

  const build = builds.at(-1) ?? null;
  const findings = build?.qa?.findings ?? [];

  useEffect(() => {
  if (project) {
    sessionStorage.setItem(
      'active-project',
      JSON.stringify(project),
    );
  }
}, [project]);

  const buildActive = turn.status === 'running';

  const buildFinished =
    turn.status === 'completed' ||
    turn.status === 'failed' ||
    turn.status === 'cancelled';

  useEffect(() => {
  if (buildActive) {
    setIsBuilding(true);
  } else if (buildFinished) {
    setIsBuilding(false);
  }
}, [buildActive, buildFinished]);

  async function handleBuild(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const cleanTitle = title.trim();
    const cleanRequest = requestText.trim();

    if (!cleanTitle || !cleanRequest) {
      setError(
        new ApiError(
          'invalid_request',
          'Enter a project title and a request before building.',
        ),
      );
      return;
    }

    setError(null);
    setIsBuilding(true);

    try {
      const currentProject =
        project?.title === cleanTitle
          ? project
          : (
              await createProject({
                title: cleanTitle,
                avenue: 'scorm',
              })
            ).project;

      setProject(currentProject);

      await sendMessage(currentProject.id, {
        content: [
          {
            type: 'text',
            text: cleanRequest,
          },
        ],
      });
    } catch (caughtError) {
      setIsBuilding(false);

      setError(
        caughtError instanceof ApiError
          ? caughtError
          : new ApiError(
              'request_failed',
              'Unable to start the build.',
            ),
      );
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="D2L Content Development Kit home"
        >
          <span aria-hidden="true">C</span>
          D2L Content Development Kit
        </a>

        <span className="local-label">Local mode</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">COURSE MATERIAL WORKSPACE</p>

        <h1 id="page-title">
          Describe what you want to build.
        </h1>

        <p>
          We will create a SCORM learning activity, check it
          against the course requirements, and prepare it for
          download.
        </p>
      </section>

      <div className="workspace">
        <section
          className="card"
          aria-labelledby="configurator-title"
        >
          <p className="eyebrow">01 / CONFIGURE</p>

          <h2 id="configurator-title">Your request</h2>

          <form onSubmit={handleBuild}>
            <label htmlFor="project-title">
              Project title
            </label>

            <input
              id="project-title"
              value={title}
              onChange={(event) =>
                setTitle(event.target.value)
              }
              placeholder="e.g., Cell division practice"
              maxLength={160}
              disabled={isBuilding}
            />

            <label htmlFor="request-text">
              What should students learn or do?
            </label>

            <textarea
              id="request-text"
              value={requestText}
              onChange={(event) =>
                setRequestText(event.target.value)
              }
              placeholder="For example: Create a ten-question multiple-choice practice set on cell division. Students can retake it, with the best score sent to the gradebook."
              rows={8}
              maxLength={20_000}
              disabled={isBuilding}
            />

            <p className="hint">
              The initial version creates a SCORM activity.
              More content types will be added in a later
              layer.
            </p>

            <button
              type="submit"
              disabled={isBuilding}
            >
              {isBuilding ? 'Building…' : 'Build activity'}
            </button>

            <InlineError error={error} />
          </form>
        </section>

        <section
          className="card build-panel"
          aria-labelledby="build-title"
        >
          <p className="eyebrow">02 / BUILD STATUS</p>

          <h2 id="build-title" tabIndex={-1}>Build panel</h2>

          <div aria-live="polite">
            {statusLines.length === 0 &&
              !error &&
              !replyText && (
                <p className="empty">
                  Build progress will appear here after you
                  submit a request.
                </p>
              )}

            {statusLines.length > 0 && (
              <ol className="status-feed">
                {statusLines.map((item) => (
                  <li key={item.seq}>
                    {item.text}
                  </li>
                ))}
              </ol>
            )}

          </div>

          {turn.status === 'running' && turn.startedAt !== null && (
            <WorkingIndicator startedAt={turn.startedAt} step={turn.currentStep} connection={connection} />
          )}

          <div aria-live="polite">
            {replyText && (
              <p className="agent-reply">
                {replyText}
              </p>
            )}
          </div>

          {build && (
            <article
              className={`build-result build-${build.status}`}
              aria-labelledby="build-result-title"
            >
              <p className="result-label">
                BUILD {build.version}
              </p>

              <h3 id="build-result-title">
                {build.status === 'ready'
                  ? 'Ready to download'
                  : build.status === 'failed'
                    ? 'QA needs attention'
                    : 'Build is being checked'}
              </h3>

              {build.qa && (
                <p>
                  {build.qa.passed
                    ? 'The QA gate passed.'
                    : `${findings.length} QA finding${
                        findings.length === 1 ? '' : 's'
                      } need review.`}
                </p>
              )}

              {findings.length > 0 && (
                <ul className="findings">
                  {findings.map((finding) => (
                    <li
                      key={`${finding.rule}-${finding.file}-${finding.line ?? 'none'}`}
                    >
                      <strong>
                        {finding.severity.toUpperCase()}
                      </strong>{' '}
                      {finding.message}
                    </li>
                  ))}
                </ul>
              )}

              {build.status === 'ready' && (
                <div className="build-actions">
                  <a
                    className="download"
                    href={buildDownloadUrl(build.id)}
                  >
                    Download SCORM package
                  </a>
                  <button type="button" onClick={(event) => {
                    previewOpener.current = event.currentTarget;
                    setPreview({ id: build.id, version: build.version });
                  }}>Preview</button>
                </div>
              )}
            </article>
          )}
        </section>
      </div>
      {preview && <PreviewPanel key={`${preview.id}:${preview.version}`} build={preview} onClose={closePreview} />}
    </main>
  );
}
