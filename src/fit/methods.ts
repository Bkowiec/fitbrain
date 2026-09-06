import type { KV } from './types';
import { RR_JUMP_REL, RR_MAX_S, RR_MEDIAN_WINDOW, RR_MIN_S } from './rr';
import {
  DFA_AEROBIC, DFA_ANAEROBIC, DFA_ARTEFACT_LIMIT_PCT, DFA_BOX_MAX, DFA_BOX_MIN, DFA_JITTER_ABS_S, DFA_JITTER_LIMIT_PCT, DFA_JITTER_REL,
  DFA_STEP_SEC, DFA_WINDOW_SEC, HRVT_HR_MARGIN_BPM, HRVT_MIN_R, HRVT_MIN_RUN_SEC, HRVT_MIN_SIDE_SEC,
} from './dfa';
import { ZONESENSE_AEROBIC, ZONESENSE_ANAEROBIC } from './zonesense';
import { RIEGEL_EXPONENT } from './predict';
import { DT_CAP_SEC, ELEVATION_HYSTERESIS_M, ELEVATION_SMOOTH_SAMPLES, NP_WINDOW_SEC } from './metrics';
import { DOWNHILL_DAMPING, DOWNHILL_FLOOR, MAX_GRADE, SMOOTH_HALF, STEP_M } from '../course/pacing';

/**
 * Everything the analyzer adds on top of the file, with the constants it relies on. Exported with every report so a
 * reader (human or model) can tell recorded values from derived ones and knows the assumptions behind the latter.
 */
export function methodsList(): KV[] {
  return [
    { key: 'sources', label: 'Recorded vs computed', value: 'Session, lap, zone and developer-field values are reported exactly as the device wrote them and labelled "device". Everything else is derived from the record stream and labelled "computed". Distance and speed use the device distance and enhanced speed fields; heart rate uses the record HR field.' },
    { key: 'time', label: 'Time base', value: 'Timer (moving) time from record timestamps with pauses removed using the file\'s timer start/stop events; record gaps are used only when the file has no events. Splits, efforts, digest, zones, ZoneSense, DFA and the heartbeat replay all share this axis.' },
    { key: 'weighting', label: 'Time in zones', value: `Zone tables, histograms, ZoneSense zone times and DFA α1 zone times are all weighted by the interval between consecutive records (capped at ${DT_CAP_SEC} s), so they stay correct with smart recording.` },
    { key: 'rr', label: 'RR intervals', value: `Beat-to-beat intervals come from hrv messages and are placed in time using the timestamp of the record message written just before them. One artefact filter is shared by HRV statistics, DFA α1 and the heartbeat replay: intervals outside ${RR_MIN_S}–${RR_MAX_S} s or more than ${Math.round(RR_JUMP_REL * 100)} % off the running median of ${RR_MEDIAN_WINDOW} beats are replaced by linear interpolation.` },
    { key: 'dfa', label: 'DFA α1', value: `${DFA_WINDOW_SEC} s windows re-evaluated every ${DFA_STEP_SEC} s, box sizes ${DFA_BOX_MIN}–${DFA_BOX_MAX} beats. A window is unreliable above ${DFA_ARTEFACT_LIMIT_PCT} % corrected beats or when more than ${DFA_JITTER_LIMIT_PCT} % of successive differences exceed both ${Math.round(DFA_JITTER_ABS_S * 1000)} ms and ${Math.round(DFA_JITTER_REL * 100)} % (strap noise). Thresholds ${DFA_AEROBIC} (aerobic) and ${DFA_ANAEROBIC} (anaerobic) after Rogers et al. Heart rate in the DFA analysis is the device HR stream.` },
    { key: 'hrvt', label: 'Threshold HR estimates (HRVT)', value: `Require at least ${HRVT_MIN_SIDE_SEC} s of reliable data on each side of the threshold in runs of at least ${HRVT_MIN_RUN_SEC} s, a correlation of HR with α1 of at least ${HRVT_MIN_R} in magnitude for the regression estimate, and a threshold HR at least ${HRVT_HR_MARGIN_BPM} bpm above clearly easier windows. An anaerobic estimate below the aerobic one is discarded.` },
    { key: 'zonesense', label: 'Suunto ZoneSense', value: `The DDFA developer field as recorded. Thresholds ${ZONESENSE_AEROBIC} and ${ZONESENSE_ANAEROBIC} come from Suunto's documentation; device zone times, thresholds and baselines are read from the session's developer fields.` },
    { key: 'elevation', label: 'Elevation gain', value: `${ELEVATION_SMOOTH_SAMPLES}-sample moving average of the altitude stream with ${ELEVATION_HYSTERESIS_M} m hysteresis. The device total is shown separately.` },
    { key: 'power', label: 'Normalized Power, IF, TSS', value: `${NP_WINDOW_SEC} s rolling average and fourth-power mean on a 1 Hz grid (gaps held for 5 s). IF and TSS use the FTP from athlete settings or the file.` },
    { key: 'efforts', label: 'Splits and fastest efforts', value: 'Distance-based on the device distance stream with interpolated boundaries; durations in timer time.' },
    { key: 'drift', label: 'Drift and decoupling', value: 'First vs second half of timer time; efficiency factor is speed (or power) divided by HR.' },
    { key: 'predict', label: 'Race predictions', value: `Riegel with exponent ${RIEGEL_EXPONENT}; VDOT after Daniels & Gilbert. Default basis is a race entered in settings, otherwise the effort of at least 3 km with the highest VDOT.` },
    { key: 'pacing', label: 'Pacing plan', value: `Course resampled every ${STEP_M} m, elevation smoothed over ±${SMOOTH_HALF * STEP_M} m, grade clamped to ±${Math.round(MAX_GRADE * 100)} %. Energy cost of grade after Minetti et al. (2002) with downhill savings damped to ${Math.round(DOWNHILL_DAMPING * 100)} % and floored at ${DOWNHILL_FLOOR}× the flat cost; constant effort sets every segment's speed.` },
    { key: 'checks', label: 'Consistency checks', value: 'Device averages are compared with the record stream; a value off by more than a factor of two is flagged as a likely export bug and the stream value is offered instead.' },
  ];
}
