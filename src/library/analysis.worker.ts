import { decodeFit } from '../fit/decode';
import { analyze } from '../fit/analyze';
import type { AthleteSettings } from '../fit/types';
import { summarizeActivity } from './model';
import { summarizeHistory } from '../history/model';

export interface AnalysisRequest { id: number; data: ArrayBuffer; fileName: string; settings: AthleteSettings; full: boolean }

self.onmessage = ({ data: request }: MessageEvent<AnalysisRequest>) => {
  try {
    const fit = decodeFit(request.data, request.fileName);
    const analysis = analyze(fit, request.settings);
    const summary = summarizeActivity(analysis);
    self.postMessage({ id: request.id, summary, history: summarizeHistory(analysis), loaded: request.full ? { fit, analysis } : undefined });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
};
