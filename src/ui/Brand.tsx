/**
 * FitBrain mark ("Brain-pulse"): a brain outline whose single fold is an RR waveform. Stroke thickens as the size
 * drops and the waveform simplifies to one QRS spike at icon sizes, as specified in the brand identity.
 */
export const BRAIN_PATH = 'M12 4.4C10.8 3.3 8.6 3.4 7.6 5.3C5.6 5.2 4.1 7.2 4.9 9.3C3.4 10.4 3.4 13.2 4.9 14.4C4.3 16.6 6 18.6 8.3 18.6C9.2 20.2 11.2 20.4 12 19.2C12.8 20.4 14.8 20.2 15.7 18.6C18 18.6 19.7 16.6 19.1 14.4C20.6 13.2 20.6 10.4 19.1 9.3C19.9 7.2 18.4 5.2 16.4 5.3C15.4 3.4 13.2 3.3 12 4.4Z';
export const WAVE_PATH = 'M3.8 12h4.6l1.1-2.2 1.4 4.6 1.5-7 1.5 7.6 1.1-3H20.2';
export const WAVE_PATH_SMALL = 'M3.8 12h4.2l1.6-2.6 1.6 5.2 1.6-7.6 1.6 8.2 1.6-3.2H20.2';

export function markStroke(size: number): number {
  return size <= 20 ? 2.4 : size <= 40 ? 1.8 : 1.5;
}

export function Mark({ size = 24, className = '', title }: { size?: number; className?: string; title?: string }) {
  const small = size <= 20;
  return (
    <svg className={`mark ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={markStroke(size)} strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d={BRAIN_PATH} />
      <path d={small ? WAVE_PATH_SMALL : WAVE_PATH} />
    </svg>
  );
}

/** Horizontal lockup: mark + wordmark, gap = half the symbol width; optional mono descriptor. */
export function Lockup({ size = 22, descriptor, as: Tag = 'div' }: { size?: number; descriptor?: string; as?: 'div' | 'h1' }) {
  return (
    <Tag className="lockup" style={{ display: 'inline-flex', alignItems: 'center', gap: size / 2, margin: 0 }}>
      <Mark size={size} title="FitBrain" />
      <span className="wordmark" style={{ fontSize: Math.round(size * 0.78) }}>FitBrain</span>
      {descriptor && <span className="wordmark-descriptor">{descriptor}</span>}
    </Tag>
  );
}
