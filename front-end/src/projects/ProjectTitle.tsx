import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../api/client';

/** The longest title the field takes, the same as the title field that creates a project. */
const MAX_TITLE = 160;

/**
 * A project's title as a heading, with a quill button that turns it into a
 * field for renaming the project. Enter or the check button saves, and Esc or
 * the X button puts the old title back. Focus moves into the field when
 * editing starts, and back to the quill button when it ends.
 */
export function ProjectTitle({ title, level, id, href, onRename }: {
  title: string;
  level: 1 | 2;
  /** The heading's id, for a section that `aria-labelledby` names after it. */
  id?: string;
  /** Makes the title a link, as in the project list. */
  href?: string;
  /** Saves a trimmed, non-blank title that differs from `title`. Rejects to keep the field open. */
  onRename: (title: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const quill = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const ownId = useId();
  const headingId = id ?? ownId + '-title';
  const errorId = ownId + '-error';
  const editing = draft !== null;
  const Heading = level === 1 ? 'h1' : 'h2';

    // A layout effect, so focus moves in the same commit that swaps the field and the quill button.
  useLayoutEffect(() => {
    if (editing) {
      field.current?.focus();
      field.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      quill.current?.focus();
    }
  }, [editing]);

  function finish() {
    returnFocus.current = true;
    setDraft(null);
    setError('');
  }

  async function save() {
    if (draft === null || saving) return;
    const next = draft.trim();
    if (!next) {
      setError('Enter a title for the project.');
      field.current?.focus();
      return;
    }
    if (next === title) return finish();
    setSaving(true);
    setError('');
    try {
      await onRename(next);
      finish();
    } catch (caught) {
      setError('Unable to rename the project. ' + (caught instanceof ApiError ? caught.message : 'Try again.'));
      field.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (!saving) finish();
  }

  function onFieldKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void save();
  }

  /** Esc cancels from the field and from the check and X buttons. */
  function onEditorKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!editing || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    cancel();
  }

  return <div className="project-title" onKeyDown={onEditorKey}>
    <Heading id={headingId} className={editing ? 'title-editing' : undefined}>
      {editing
        ? <input ref={field} className="title-field" aria-label="Project title" value={draft} maxLength={MAX_TITLE} readOnly={saving}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          onChange={event => { setDraft(event.target.value); setError(''); }} onKeyDown={onFieldKey} />
        : href ? <a href={href}>{title}</a> : title}
    </Heading>
    {editing ? <>
      <button type="button" className="icon-button" aria-label="Save title" title="Save title" onClick={() => void save()}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
      <button type="button" className="icon-button" aria-label="Cancel rename" title="Cancel rename" onClick={cancel}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </> : <button ref={quill} type="button" className="icon-button" aria-label="Rename project" aria-describedby={headingId} title="Rename project"
      onClick={() => { setDraft(title); setError(''); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
    </button>}
    {error && <p id={errorId} className="error title-error" role="alert">{error}</p>}
    <span className="sr-only" role="status">{saving ? 'Saving the title…' : ''}</span>
  </div>;
}
