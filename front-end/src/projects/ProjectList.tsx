import { useEffect, useState } from 'react';
import type { Avenue, BuildSummary, ProjectListItem } from '@cdk/contract';
import { listProjects } from '../api/client';
import { ProjectWorkspace } from '../ProjectWorkspace';
import { AppHeader } from './AppHeader';
import './projects.css';

const FORMATS: Record<Avenue, string> = { scorm: 'SCORM', topic: 'Content topic', widget: 'Widget', external: 'External activity' };
const BUILD_STATES: Record<BuildSummary['status'], string> = { checking: 'Being checked', ready: 'Ready', failed: 'QA needs attention' };

export function ProjectList() {
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void listProjects().then(result => { if (!cancelled) setItems(result.items); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  if (items?.length === 0) return <ProjectWorkspace />;
  return <main className="app-shell"><AppHeader />
    <section className="intro projects-intro" aria-labelledby="page-title">
      <div><p className="workspace-eyebrow">Course material workspace</p><h1 id="page-title">My projects</h1></div>
      <a className="new-project" href="/?new=1">New project</a>
    </section>
    <section className="project-list" aria-label="Saved projects">
      {failed ? <div className="card"><p role="alert">Unable to load your projects. Check the service and try again.</p>
        <button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try loading projects again</button></div>
        : items === null ? <p role="status">Loading your projects…</p>
        : <ul>{items.map(({ project, latestBuild }) => <li className="card project-row" key={project.id}>
          <h2><a href={'/?project=' + encodeURIComponent(project.id)}>{project.title}</a></h2>
          <dl>
            <div><dt>Format</dt><dd>{project.avenue ? FORMATS[project.avenue] : 'Not selected'}</dd></div>
            <div><dt>Latest build</dt><dd>{latestBuild ? `${BUILD_STATES[latestBuild.status]} · Version ${latestBuild.version}` : 'No build yet'}</dd></div>
            <div><dt>Last used</dt><dd><time dateTime={new Date(project.updatedAt).toISOString()}>{new Date(project.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>
          </dl>
        </li>)}</ul>}
    </section>
  </main>;
}
