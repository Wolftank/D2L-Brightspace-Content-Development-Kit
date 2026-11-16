import { useEffect, useRef, useState } from 'react';

export function AttachmentPicker({ disabled, onAdd }: { disabled: boolean; onAdd: (files: File[]) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    function isFiles(event: DragEvent) { return event.dataTransfer?.types.includes('Files'); }
    function reset() { depth = 0; setDragging(false); }
    function enter(event: DragEvent) {
      if (!isFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(!disabled);
    }
    function over(event: DragEvent) {
      if (!isFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      setDragging(!disabled);
    }
    function leave(event: DragEvent) {
      if (!isFiles(event)) return;
      if (--depth <= 0) reset();
    }
    function drop(event: DragEvent) {
      if (!isFiles(event) && !event.dataTransfer?.files.length) return;
      event.preventDefault();
      reset();
      if (!disabled && event.dataTransfer) onAdd(Array.from(event.dataTransfer.files));
    }
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('blur', reset);
    };
  }, [disabled, onAdd]);

  return <>
    <input ref={picker} type="file" hidden multiple disabled={disabled} accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,text/*"
      onChange={event => { onAdd(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <button type="button" className="attachment-picker" disabled={disabled} aria-label="Attach files" title="Attach files. Do not attach student information."
      onClick={() => picker.current?.click()}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M8 13.5l6-6a2 2 0 0 1 3 3l-7 7a3.5 3.5 0 0 1-5-5l8-8a5 5 0 0 1 7 7l-8 8" />
      </svg>
    </button>
    {dragging && !disabled && <div className="attachment-drop" aria-hidden="true">Drop files to attach</div>}
  </>;
}

export function AttachmentLabels({ items, onRemove, disabled }: {
  items: { id: string | number; name: string }[];
  onRemove?: (id: number) => void;
  disabled?: boolean;
}) {
  if (!items.length) return null;
  return <ul className="attachment-labels" aria-label="Attached files">
    {items.map(item => <li key={item.id}><span>{item.name}</span>
      {onRemove && typeof item.id === 'number' && <button type="button" disabled={disabled}
        aria-label={'Remove ' + item.name} onClick={() => onRemove(Number(item.id))}>×</button>}
    </li>)}
  </ul>;
}
