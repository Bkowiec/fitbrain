import { useCallback, useState } from 'react';

export function DropZone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const [over, setOver] = useState(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }, [onFile]);
  return (
    <div
      className={`dropzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="drop-icon" aria-hidden>{busy ? '⏳' : '⬇'}</div>
      <h2>{busy ? 'Decoding…' : 'Drop a .fit file here'}</h2>
      <p>or</p>
      <label className="btn primary">
        Choose file
        <input type="file" accept=".fit,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </label>
      <p className="muted">Garmin, Suunto, Wahoo, COROS, Polar, Zwift and any other FIT activity file. Processed locally in your browser.</p>
    </div>
  );
}
