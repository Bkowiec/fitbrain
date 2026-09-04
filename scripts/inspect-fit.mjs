import { readFileSync } from 'node:fs';
import { Decoder, Stream } from '@garmin/fitsdk';

const file = process.argv[2];
const buf = readFileSync(file);
const stream = Stream.fromByteArray(new Uint8Array(buf));
const decoder = new Decoder(stream);
console.log('isFIT:', decoder.isFIT(), 'integrity:', decoder.checkIntegrity());
const { messages, errors } = decoder.read({
  applyScaleAndOffset: true, expandSubFields: true, expandComponents: true,
  convertTypesToStrings: true, convertDateTimesToDates: true, includeUnknownData: true, mergeHeartRates: true,
});
console.log('errors:', errors);
for (const [k, v] of Object.entries(messages)) {
  console.log(`${k}: ${Array.isArray(v) ? v.length : typeof v}`);
}
const show = (name, idx = 0) => {
  const m = messages[name];
  if (!m || !m[idx]) return;
  console.log(`\n=== ${name}[${idx}] ===`);
  console.log(JSON.stringify(m[idx], null, 1));
};
for (const n of ['fileIdMesgs','fileCreatorMesgs','deviceInfoMesgs','sportMesgs','zonesTargetMesgs','userProfileMesgs','sessionMesgs','lapMesgs','recordMesgs','eventMesgs','activityMesgs','hrZoneMesgs','powerZoneMesgs','timeInZoneMesgs','trainingFileMesgs','workoutMesgs','splitMesgs','splitSummaryMesgs','developerDataIdMesgs','fieldDescriptionMesgs','hrvMesgs','lengthMesgs']) show(n);
show('recordMesgs', 500);
