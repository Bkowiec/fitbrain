import type { AthleteSettings } from '../fit/types';
import type { ActivitySummary, LoadedActivity } from './model';
import type { AnalysisRequest } from './analysis.worker';
import type { ActivityHistory } from '../history/model';

interface AnalysisResult { summary: ActivitySummary; history: ActivityHistory; loaded?: LoadedActivity }
let nextId = 0;
let worker: Worker | undefined;
const pending = new Map<number, { resolve: (r: AnalysisResult) => void; reject: (error: Error) => void }>();

export function analyzeFile(data: ArrayBuffer, fileName: string, settings: AthleteSettings, full = false): Promise<AnalysisResult> {
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: result }: MessageEvent<AnalysisResult & { id: number; error?: string }>) => {
      const task = pending.get(result.id);
      pending.delete(result.id);
      if (result.error) task?.reject(new Error(result.error));
      else task?.resolve(result);
    };
    worker.onerror = () => {
      for (const task of pending.values()) task.reject(new Error('Could not analyze the file. Please retry.'));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = nextId++;
  // Keep the original bytes available for storage and backup after the worker receives its copy.
  const copy = data.slice(0);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: AnalysisRequest = { id, data: copy, fileName, settings, full };
    try { worker!.postMessage(request, [copy]); }
    catch (error) { pending.delete(id); reject(error); }
  });
}
