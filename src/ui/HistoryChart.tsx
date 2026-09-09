import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { usePrefersDark } from './Charts';
import { fmtNum } from '../fit/format';

Chart.register(...registerables);
export interface HistorySeries { label: string; values: (number | null)[]; color: string }

export function HistoryChart({ labels, datasets, units, label, stacked = false }: { labels: string[]; datasets: HistorySeries[]; units: string; label: string; stacked?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dark = usePrefersDark();
  useEffect(() => {
    if (!canvas.current) return;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const ink = color('--text-muted');
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: { labels, datasets: datasets.map((s) => ({ label: s.label, data: s.values, backgroundColor: color(s.color), borderRadius: 2, maxBarThickness: 42 })) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: stacked, position: 'bottom', labels: { color: ink, boxWidth: 10, font: { family: color('--font-ui'), size: 11 } } },
          tooltip: { callbacks: { title: (items) => `Week of ${items[0]?.label ?? ''}`, label: (item) => `${item.dataset.label}: ${fmtNum(item.parsed.y ?? 0, 2)} ${units}` } },
        },
        scales: {
          x: { stacked, grid: { display: false }, ticks: { color: ink, maxTicksLimit: 10, maxRotation: 0, font: { family: color('--font-num'), size: 10 } } },
          y: { stacked, beginAtZero: true, title: { display: true, text: units, color: ink }, grid: { color: color('--grid') }, ticks: { color: ink, precision: units === 'sessions' ? 0 : undefined } },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, datasets, units, stacked, dark]);
  return <div className="history-chart"><canvas ref={canvas} role="img" aria-label={label} /></div>;
}
