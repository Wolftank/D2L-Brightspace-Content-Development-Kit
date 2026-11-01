import type { FocusEvent } from 'react';

/** Keeps the home link on screen when it gets focus, which Firefox skips when Tab wraps into the page from its toolbar. */
function keepInView(event: FocusEvent<HTMLElement>) {
  event.currentTarget.scrollIntoView({ block: 'nearest' });
}

export function AppHeader() {
  return <header className="topbar">
    <a className="brand" href="/" aria-label="D2L Content Development Kit home" onFocus={keepInView}><span aria-hidden="true">C</span>D2L Content Development Kit</a>
    <nav aria-label="Project navigation"><a className="projects-link" href="/">My projects</a></nav>
  </header>;
}
