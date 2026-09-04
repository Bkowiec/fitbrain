import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '../fit/types';
import { toMarkdown } from '../export/markdown';
import { toJson } from '../export/json';
import { estimateTokens, fmtNum } from '../fit/format';

type Mode = 'md_full' | 'md_compact' | 'json';

export function LlmExport({ a }: { a: Analysis }) {
  const [mode, setMode] = useState<Mode>('md_full');
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => (mode === 'json' ? toJson(a) : toMarkdown(a, mode === 'md_full' ? 'full' : 'compact')), [a, mode]);
  useEffect(() => { setCopied(false); }, [text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const ta = document.getElementById('llm-text') as HTMLTextAreaElement | null;
      ta?.select();
      document.execCommand('copy');
      setCopied(true);
    }
  };
  const download = () => {
    const ext = mode === 'json' ? 'json' : 'md';
    const blob = new Blob([text], { type: mode === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = a.fileName.replace(/\.fit$/i, '') + `.${mode}.${ext}`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h3>Report for an LLM</h3>
          <div className="inline">
            <div className="segmented" role="radiogroup">
              <button role="radio" aria-checked={mode === 'md_full'} className={mode === 'md_full' ? 'active' : ''} onClick={() => setMode('md_full')}>Markdown · full</button>
              <button role="radio" aria-checked={mode === 'md_compact'} className={mode === 'md_compact' ? 'active' : ''} onClick={() => setMode('md_compact')}>Markdown · compact</button>
              <button role="radio" aria-checked={mode === 'json'} className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>JSON</button>
            </div>
            <button className="btn primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button className="btn" onClick={download}>Download</button>
          </div>
        </div>
        <p className="muted small">
          {fmtNum(text.length, 0)} characters · ≈{fmtNum(estimateTokens(text), 0)} tokens. Paste into your assistant together with a question, e.g. "Assess this workout and suggest what to focus on next week."
          {mode === 'md_full' ? ' The full report includes the time-series digest, distributions, events, devices and metadata.' : mode === 'md_compact' ? ' The compact report keeps the summary, laps, splits, zones and pacing.' : ' JSON keeps raw numeric values alongside formatted ones.'}
        </p>
        <textarea id="llm-text" className="llm-text" readOnly value={text} spellCheck={false} />
      </section>
    </div>
  );
}
