import { useEffect, useId, useRef, useState } from 'react';

interface Action { label: string; onSelect: () => void; danger?: boolean }
export function ActionMenu({ label, compact, disabled, actions }: { label: string; compact?: boolean; disabled?: boolean; actions: Action[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    root.current?.addEventListener('keydown', escape);
    const node = root.current;
    return () => { document.removeEventListener('pointerdown', outside); node?.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="action-menu" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className={compact ? 'icon-btn' : 'btn'} aria-label={label} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => setOpen(!open)}>
      {compact ? <span aria-hidden="true">⋯</span> : <>{label}<span aria-hidden="true">⌄</span></>}
    </button>
    {open && <div className="action-menu-panel" id={id} role="group" aria-label={label}>
      {actions.map((action) => <button key={action.label} className={action.danger ? 'danger' : undefined} disabled={disabled} onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); action.onSelect(); }}>{action.label}</button>)}
    </div>}
  </div>;
}
