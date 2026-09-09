import { MARK_F, MARK_B, MARK_TRANSFORM, WORDMARK_PATH, WORDMARK_WIDTH, WORDMARK_HEIGHT } from '../brand/geometry';

/** Forward-leaning FB monogram. Filled shapes stay legible at favicon sizes. */
export function Mark({ size = 32, className = '', title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={`mark ${className}`.trim()} width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g transform={MARK_TRANSFORM}>
        <path className="mark-accent" d={MARK_F} />
        <path fill="currentColor" d={MARK_B} />
      </g>
    </svg>
  );
}

/** Outlined lettering keeps the logo identical across devices and font-loading states. */
export function Lockup({ size = 32, descriptor, as: Tag = 'div' }: { size?: number; descriptor?: string; as?: 'div' | 'h1' }) {
  const height = size * 0.68;
  return (
    <Tag className="lockup" style={{ gap: size * 0.3 }}>
      <Mark size={size} />
      <svg className="wordmark" width={height * WORDMARK_WIDTH / WORDMARK_HEIGHT} height={height} viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`} fill="currentColor" aria-hidden="true"><path d={WORDMARK_PATH} /></svg>
      <span className="visually-hidden">FitBrain</span>
      {descriptor && <span className="wordmark-descriptor">{descriptor}</span>}
    </Tag>
  );
}
