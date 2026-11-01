import { useEffect, useState } from 'react';
import type { Project } from '@cdk/contract';
import { getProject } from './api/client';
import { ProjectWorkspace } from './ProjectWorkspace';
import { ProjectList } from './projects/ProjectList';
import { AppHeader } from './projects/AppHeader';
import './App.css';

export function App() {
  const query = new URLSearchParams(window.location.search);
  const projectId = query.get('project');
  if (projectId) return <OpenProject projectId={projectId} />;
  if (query.get('new') === '1') return <ProjectWorkspace />;
  return <ProjectList />;
}

function OpenProject({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getProject(projectId).then(result => { if (!cancelled) setProject(result.project); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [projectId, attempt]);
  if (project) return <ProjectWorkspace initialProject={project} />;
  return <main className="app-shell"><AppHeader /><section className="intro" aria-labelledby="page-title">
    <h1 id="page-title">Open project</h1>
    {failed ? <><p role="alert">Unable to open this project. It may be unavailable, or the service could not be reached.</p>
      <button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try opening again</button></>
      : <p role="status">Opening your project…</p>}
  </section></main>;
}
