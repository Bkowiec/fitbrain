import { Decoder, Stream, Profile } from '@garmin/fitsdk';
import type { DecodedFit, DevFieldDef, MessageCount, Msg, RrBatch } from './types';
import { humanize } from './format';

/** Lookup of message-key (e.g. "recordMesgs") -> field name -> units, from the SDK profile. */
const unitsIndex: Record<string, Record<string, string>> = {};
const messageNames: Record<string, string> = {};
(() => {
  const msgs = (Profile as any).messages as Record<string, any>;
  for (const num of Object.keys(msgs)) {
    const m = msgs[num];
    if (!m?.messagesKey) continue;
    messageNames[m.messagesKey] = m.name;
    const map: Record<string, string> = {};
    for (const f of Object.values(m.fields ?? {}) as any[]) {
      const u = Array.isArray(f.units) ? f.units[0] : f.units;
      if (f?.name && u) map[f.name] = String(u);
      for (const sf of f?.subFields ?? []) {
        const su = Array.isArray(sf.units) ? sf.units[0] : sf.units;
        if (sf?.name && su) map[sf.name] = String(su);
      }
    }
    unitsIndex[m.messagesKey] = map;
  }
})();

export function fieldUnits(messagesKey: string, field: string): string {
  return unitsIndex[messagesKey]?.[field] ?? '';
}

export function messageDisplayName(key: string): string {
  if (/^\d+$/.test(key)) return `unknown message #${key}`;
  return humanize(messageNames[key] ?? key.replace(/Mesgs$/, ''));
}

/**
 * Known vendor quirks in developer-field declarations. Suunto documents peak_epoc as "l/kg" while the value
 * is EPOC in ml/kg (Firstbeat/Suunto express EPOC in ml/kg everywhere else).
 */
const VENDOR_UNIT_FIXES: Record<string, Record<string, string>> = {
  suunto: { peak_epoc: 'ml/kg' },
};

const RECORD_MESG_NUM = 20;
const HRV_MESG_NUM = 78;

export function decodeFit(buffer: ArrayBuffer, fileName: string): DecodedFit {
  const stream = Stream.fromArrayBuffer(buffer);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) {
    throw new Error('This is not a FIT file (bad header).');
  }
  const integrityOk = decoder.checkIntegrity();
  // Devices write hrv messages in between record messages. The SDK sorts messages by type, so the position in the
  // file is the only timing information RR intervals have: remember the last record timestamp seen before each hrv message.
  const rr: RrBatch[] = [];
  let lastRecordTs: number | undefined;
  const mesgListener = (num: number, m: Msg) => {
    if (num === RECORD_MESG_NUM) {
      const d = m.timestamp instanceof Date ? m.timestamp.getTime() : undefined;
      if (d !== undefined && Number.isFinite(d)) lastRecordTs = d;
    } else if (num === HRV_MESG_NUM) {
      const t = Array.isArray(m.time) ? m.time : [m.time];
      const vals = t.filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 65);
      if (vals.length) rr.push({ anchorTs: lastRecordTs, rr: vals });
    }
  };
  const { messages, errors, profileVersion } = decoder.read({
    mesgListener,
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: true,
    mergeHeartRates: true,
  });

  const msgs = messages as unknown as Record<string, Msg[]>;

  const devFields: DevFieldDef[] = [];
  const appIds: Record<number, string> = {};
  for (const d of msgs.developerDataIdMesgs ?? []) {
    const idx = d.developerDataIndex;
    const app = d.applicationId;
    if (Array.isArray(app)) {
      const printable = app.every((b: number) => b >= 32 && b < 127);
      appIds[idx] = printable
        ? String.fromCharCode(...app)
        : app.map((b: number) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  const manufacturer = String(msgs.fileIdMesgs?.[0]?.manufacturer ?? '').toLowerCase();
  const fixes = VENDOR_UNIT_FIXES[manufacturer] ?? {};
  for (const f of msgs.fieldDescriptionMesgs ?? []) {
    const name = Array.isArray(f.fieldName) ? f.fieldName.filter(Boolean).join(' ') : String(f.fieldName ?? `dev_${f.fieldDefinitionNumber}`);
    const declared = Array.isArray(f.units) ? f.units.filter(Boolean).join(' ') : f.units ? String(f.units) : undefined;
    const fixed = fixes[name];
    devFields.push({
      key: f.key,
      developerDataIndex: f.developerDataIndex,
      fieldDefinitionNumber: f.fieldDefinitionNumber,
      name,
      units: fixed ?? declared,
      unitsDeclared: fixed && fixed !== declared ? declared : undefined,
      note: fixed && fixed !== declared ? `file declares "${declared ?? '–'}"; corrected to ${fixed} (known ${manufacturer} export quirk)` : undefined,
      nativeMesgNum: f.nativeMesgNum,
      nativeFieldNum: f.nativeFieldNum,
      appId: appIds[f.developerDataIndex],
    });
  }

  const messageCounts: MessageCount[] = Object.entries(msgs)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([key, v]) => ({ key, name: messageDisplayName(key), count: v.length, known: !/^\d+$/.test(key) }))
    .sort((a, b) => b.count - a.count);

  const pv: any = profileVersion;
  const pvText = pv && typeof pv === 'object'
    ? [pv.major, pv.minor, pv.patch].filter((x) => x !== undefined).join('.')
    : pv != null ? String(pv) : 'unknown';

  return {
    fileName,
    fileSize: buffer.byteLength,
    integrityOk,
    profileVersion: pvText,
    errors: (errors ?? []).map((e: any) => (e?.message ? String(e.message) : String(e))),
    messages: msgs,
    devFields,
    messageCounts,
    rr,
  };
}
