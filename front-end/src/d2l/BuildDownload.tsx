import { useRef } from 'react';
import type { Build } from '@cdk/contract';
import { buildDownloadUrl } from '../api/client';
import { SCORM_GUIDE_TEXT, SCORM_LINKS, SCORM_STEPS } from './scormGuide';
import './guide.css';

export function BuildDownload({ build }: { build: Pick<Build, 'id' | 'version' | 'avenue'> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  function openGuide(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    opener.current = event.currentTarget;
    dialog.current?.showModal();
    heading.current?.focus();
  }

  if (build.avenue !== 'scorm') return <a className="download" href={buildDownloadUrl(build.id)}>Download package</a>;

  return <div className="build-download">
    <a className="download" href={buildDownloadUrl(build.id)} onClick={openGuide}>Download SCORM package</a>
    <button type="button" className="guide-reopen" onClick={openGuide}>Add to D2L instructions</button>
    <dialog ref={dialog} className="d2l-guide" aria-labelledby="d2l-guide-title"
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]')];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClose={() => { if (opener.current?.isConnected) opener.current.focus(); }}>
      <header className="guide-header">
        <h2 ref={heading} tabIndex={-1} id="d2l-guide-title">Add to D2L</h2>
      </header>
      <p>Use the SCORM ZIP from build {build.version} in your SCSU course.</p>
      <ol>{SCORM_STEPS.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
      <nav aria-label="D2L help"><ul>{SCORM_LINKS.map(link => <li key={link.url}>
        <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}<span className="sr-only"> (opens in your browser)</span></a>
      </li>)}</ul></nav>
      <footer className="guide-actions">
        <a className="guide-save" href={'data:text/plain;charset=utf-8,' + encodeURIComponent(SCORM_GUIDE_TEXT)} download="deploy.txt">Save instructions as text</a>
        <button type="button" onClick={() => dialog.current?.close()}>Close instructions</button>
      </footer>
    </dialog>
  </div>;
}
