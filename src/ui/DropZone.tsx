import { useCallback, useState } from 'react';
import { Mark } from './Brand';

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
      <div className="drop-icon"><Mark size={40} /></div>
      <h3>{busy ? 'Decoding…' : 'Drop a .fit file here'}</h3>
      <p className="or">or</p>
      <label className="btn primary">
        Choose file
        <input type="file" accept=".fit,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </label>
      <p className="fine">stays in this tab · decoded with the official Garmin FIT SDK</p>
    </div>
  );
}
