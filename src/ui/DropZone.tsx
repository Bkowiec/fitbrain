import { useCallback, useState } from 'react';

export function DropZone({ onFiles, onChoose, busy }: { onFiles: (files: File[]) => void; onChoose: () => void; busy: boolean }) {
  const [over, setOver] = useState(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!busy && files.length) onFiles(files);
  }, [onFiles, busy]);
  return (
    <div
      className={`dropzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={onDrop}
    >
      <div className="drop-icon" aria-hidden="true">
        <svg width="52" height="60" viewBox="0 0 52 60" fill="none">
          <path d="M10 3h22l12 12v39a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M32 3v12h12" stroke="currentColor" strokeWidth="1.5" />
          <path className="drop-pulse" d="M15 34h7l3-8 5 16 3-8h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3>{busy ? 'Importing…' : 'Drop your .fit files here'}</h3>
      <p className="drop-description">Add a single workout or your whole training history.</p>
      <button className="btn primary" disabled={busy} onClick={onChoose}>Choose files</button>
      <p className="drop-devices">Garmin · Suunto · COROS · Polar · Wahoo · Zwift</p>
      <div className="drop-privacy">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1" stroke="currentColor" /><path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" /></svg>
        <span>Saved on this device. Nothing uploaded.</span>
      </div>
    </div>
  );
}
