<picture>
  <img src="public/brand/readme-header.svg" alt="FitBrain: read everything your watch recorded." width="1200">
</picture>

# FitBrain

Browser-based analyzer for `.fit` activity files (Garmin, Suunto, Wahoo, COROS, Polar, Zwift …).
It decodes everything the device recorded with the official [Garmin FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk),
derives training metrics from the raw record stream, and renders the result both as an interactive UI and as an
**LLM-ready Markdown / JSON report** you can paste into any assistant.

Everything runs locally in the browser. No file ever leaves your machine.

**Live demo:** https://bkowiec.github.io/fitbrain/ (static build of `main`, deployed by GitHub Actions).

## Supported devices

FIT (Flexible and Interoperable Data Transfer) is Garmin's open binary format and the de-facto standard for sports
devices. Anything that exports `.fit` works: Garmin, Suunto, Wahoo, COROS, Polar, Zwift, Bryton, Hammerhead, TrainerRoad,
Stryd and more. Decoding uses the official Garmin FIT SDK, so every standard message and field is understood regardless
of vendor; vendor-specific "developer fields" are decoded generically with the names and units the file declares.

Vendor-specific parts are small and only activate when the data is present:

- **DFA α1** - computed from the `hrv` messages (beat-to-beat RR intervals) that Garmin (with HRV logging on), Suunto, Polar and others write; the tab and report section appear only when the file carries them.
- **Suunto ZoneSense** (DDFA developer field) - the ZoneSense tab and report section appear only if the file carries it.
- **Known unit quirks** (e.g. Suunto `peak_epoc`) are corrected per manufacturer as read from the file header.
- Device-vs-stream consistency checks (e.g. vertical oscillation) are generic and apply to every vendor.

Tested mainly with Suunto Vertical 2 and Garmin files. If a file from another device decodes oddly, open an issue and
attach the `.fit` **only if you are comfortable sharing it** - it contains GPS and heart-rate data.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm run preview    # serve dist/
```

Drop a `.fit` file on the page or use the file picker.

Dev shortcut: `http://localhost:5173/?file=/@fs/absolute/path/to/activity.fit` auto-loads a file served by Vite.

CLI report without the UI (handy for debugging or batch use):

```bash
npx tsx scripts/report.ts path/to/activity.fit /tmp/out   # writes out.full.md, out.compact.md, out.json
npm run inspect -- path/to/activity.fit                     # dump message types and sample messages
```

## What is extracted

| Area | Contents |
|---|---|
| File | type, manufacturer, product, serial, creation time, SDK profile version, CRC integrity, decoder errors, message inventory |
| Session summary | every session field, grouped (time & distance, pace, HR, power, cadence & running dynamics, elevation, training load, swimming); unknown fields listed too |
| Computed metrics | pace from distance/timer, steps and step length, elevation gain (hysteresis), work, Normalized Power, VI, IF, TSS (with FTP), efficiency factors, %max HR, kcal/h, kcal/km, cardiac drift, aerobic decoupling |
| Laps | as recorded, with all extra lap fields |
| Splits | computed for any distance (100 m … 10 km), interpolated boundaries, timer time, HR/power/cadence/ascent per split |
| Zones | device zone times (HR/power/speed/cadence) plus computed HR zones (% max HR) and Coggan power zones (FTP); time-weighted histograms |
| Performance | fastest 400 m / 1 km / mile / 5 km / 10 km / half / marathon efforts, peak power 5 s … 60 min, first vs second half, time-series digest |
| Events | pauses (from timer events, or record gaps as fallback), all event messages |
| Devices | primary device and sensors, battery drain, software versions, extra fields |
| Race & pacing | Race predictions for 5 km, 10 km, half and marathon by Riegel and by Daniels' VDOT from the session's fastest efforts or a real race result, Daniels training paces; grade-adjusted even-effort pacing plan for any GPX course (or the activity's own track) with split targets, exported as a FIT course (Garmin Virtual Partner follows the planned times, course points carry the target pace) or GPX with waypoints |
| Heartbeat replay | Real-time replay of the recorded beat-to-beat intervals: an ECG-style strip whose QRS complexes land on the real beat times (waveform is a template, timing is yours), an animated Poincaré plot with SD1/SD2, a tachogram of instantaneous HR coloured by DFA α1 zone with a scrubber, live HR/pace/power/α1 readouts and an optional beat click |
| DFA α1 | Short-term detrended fluctuation analysis of the RR intervals recorded by any device (Garmin with HRV logging, Suunto, Polar H10, …): 2-minute windows every 5 s, artefact correction, time in the aerobic / heavy / severe domains (thresholds α1 = 0.75 and 0.5), aerobic and anaerobic threshold heart-rate estimates (HRVT1 / HRVT2), crossings, per-km table, charts aligned with HR, pace and power, and a cross-check against Suunto's DDFA when both are present |
| Suunto ZoneSense | DDFA index (HRV-based intensity, 0 = aerobic baseline, thresholds −0.2 / −0.5): time in aerobic / anaerobic / VO2max zones from the stream vs the device, threshold crossings, relation to HR, per-km table, charts aligned with HR, pace and power |
| Developer streams | any per-record developer field (e.g. DDFA) or non-standard field is averaged into splits, the time digest and its own chart |
| Extras | HRV statistics from RR intervals (SDNN, RMSSD, pNN50), GPS bounding box, developer/vendor fields with names and units (known vendor unit quirks corrected, e.g. Suunto peak EPOC), athlete profile / zones target / workout metadata, undocumented messages and fields |
| Raw | browse every decoded message, download all as JSON |

## DFA α1

DFA α1 is the short-term scaling exponent of detrended fluctuation analysis applied to the RR-interval series. It falls
as exercise intensity rises, largely independently of heart rate, and published work (Rogers, Gronwald et al.) places
the aerobic threshold near α1 = 0.75 and the anaerobic threshold near α1 = 0.5. FitBrain computes it from the raw RR
intervals in the file, so it works for every device that logs them, not only for watches with a built-in HRV-intensity
feature.

- RR intervals live in `hrv` messages that carry no timestamp. The decoder records the timestamp of the record message
  that preceded each `hrv` message in the file and places the beats accordingly; when a file has no such anchors, beat
  times are the cumulative sum of RR intervals from the session start.
- Artefact correction (`src/fit/rr.ts`, shared by HRV statistics, DFA and the heartbeat replay): RR outside 0.3–2.0 s or
  deviating more than 20 % from the running median is replaced by linear interpolation. Windows with more than 5 %
  corrected beats are flagged unreliable and excluded from the summaries, as are windows where more than 0.75 % of
  successive differences exceed both 50 ms and 10 % of the interval - the alternating short–long signature of a dry or
  loose strap that otherwise drags α1 down without tripping the 20 % filter.
- Heart rate in the DFA analysis (threshold estimates, correlations, zone means) is the device HR stream from the record
  messages, the same source the rest of the analysis uses. Time in zones and per-km shares are time-weighted over the
  record stream with the same helper as the computed zones and ZoneSense, and the per-km mean is the same number as the
  α1 column in the splits table.
- Windows are 120 s of timer time, re-evaluated every 5 s; α1 is fitted over box sizes 4–16 beats. The resulting α1
  stream is injected into the per-record data, so it appears in splits, the digest, charts and the LLM report.
- Threshold heart rates (HRVT1 / HRVT2) are estimated by regressing HR on α1 across the session and reading the HR at
  0.75 and 0.5, plus the median HR of windows near each threshold. Estimates are only produced when the session has
  sustained reliable data on both sides of the threshold and the candidate HR is higher than that of clearly easier
  windows; a steady easy run yields none.
- When the file also carries Suunto's DDFA index, the report states the correlation between the two so the computed
  α1 can be sanity-checked against the device.

## Race predictions and pacing plan

The **Race & pacing** tab appears for running sessions.

- **Predictions.** Every fastest effort of at least 1 km in the session is a candidate basis, plus a real race result entered
  in Athlete settings. Riegel scales the basis time by (distance ratio)^1.06. The VDOT method (Daniels & Gilbert) converts
  the basis into a pseudo-VO2max from the oxygen cost of the running speed and the fraction of VO2max sustainable for that
  duration, then solves the same equations for each target distance. Daniels training paces (E, M, T, I, R) follow from
  the VDOT. Efforts taken from a training run understate race fitness, so a real race is the better basis.
- **Pacing plan.** Load a GPX course (from any route planner) or use the activity's own GPS track, set a goal time and split
  length. The course is resampled every 25 m, elevation is smoothed over ±75 m, and each segment gets a relative energy cost
  from Minetti et al. (2002); downhill savings are damped to 30 % of the energetic value and capped at 12 %, which matches
  empirical grade-adjusted-pace curves. Constant effort then fixes the speed of every segment so the total equals the goal.
- **Export.** The FIT course encodes the plan in the record timestamps (Garmin's Virtual Partner follows them when you
  navigate the course) and adds a course point at every split named like `12k 4:35 55:02` (distance, target pace, planned
  elapsed time). The GPX export carries the same labels as waypoints for Suunto, COROS and phone apps. "Copy plan as
  Markdown" gives an LLM-ready table.

Dev shortcut: add `&course=own` to the `?file=` URL to load the activity's own route into the planner, or
`&course=/route.gpx` for a GPX served by Vite.

## Methods and assumptions

Every report ends with a "Methods and assumptions" section (also in the JSON as `methods` and on the Overview tab) that
lists what the analyzer derives on top of the file and the constants it uses: time base, time weighting, the shared RR
filter, DFA windows and reliability rules, HRVT gating, ZoneSense thresholds, elevation smoothing, Normalized Power,
prediction models and the pacing-plan cost model. Device values are always reported as recorded and labelled "device";
anything else is labelled "computed".

## Athlete settings

FIT files rarely carry the athlete's max HR, LTHR, FTP or weight. The **Athlete** button in the header stores them in your browser (localStorage) and re-runs the analysis. Computed HR zones and "% of max HR" are only produced when a real max HR or LTHR is known (settings or file); the analyzer never uses the activity's own peak HR as a basis. FTP enables power zones, IF and TSS; weight enables W/kg.

Device summary values are cross-checked against the per-second stream. When they disagree grossly (e.g. Suunto writing vertical oscillation as 0.1 mm while the stream averages 105 mm), the device value is flagged and the stream-derived value is listed under computed metrics.

## LLM export

The **LLM export** tab produces:

- **Markdown · full** – everything above including the digest, distributions and metadata (~15–25k characters for a 3 h run).
- **Markdown · compact** – summary, laps, splits, zones, pacing (~8–10k characters).
- **JSON** – the same analysis with raw numeric values for programmatic use.

Each Markdown report ends with a "How to read this report" section that explains units and semantics
(timer vs elapsed time, strides vs steps, device vs computed zones, what decoupling means), so a model can interpret
the numbers without extra prompting.

## Project layout

```
src/fit/decode.ts     FIT decoding (Garmin SDK), developer-field and unit lookups
src/fit/analyze.ts    session analysis, summary groups, computed metrics, devices, events, quality
src/fit/metrics.ts    pure computations: splits, zones, histograms, efforts, NP, drift, digest, HRV
src/fit/predict.ts    race predictions: Riegel, Daniels VDOT, training paces
src/course/           GPX parsing, grade-adjusted pacing plan (Minetti), FIT course / GPX / Markdown export
src/fit/rr.ts         RR intervals: beat timing from record anchors and the shared artefact filter
src/fit/dfa.ts        DFA α1 from RR intervals: sliding windows, reliability rules, threshold estimates
src/fit/methods.ts    the "Methods and assumptions" list exported with every report
src/fit/zonesense.ts  Suunto ZoneSense / DDFA analysis
src/fit/format.ts     formatting helpers (pace, durations, local time)
src/export/           Markdown and JSON report generators
src/ui/               React components (overview, laps & splits, zones, charts, performance, race & pacing, DFA α1, heartbeat replay, ZoneSense, events, raw data, export)
scripts/              Node helpers: report.ts (full pipeline), inspect-fit.mjs (message dump)
```

## Notes on semantics

- Running cadence in FIT is strides/min (one leg); the UI and reports show steps/min alongside.
- Computed metrics are estimates from the record stream; device values are always reported as recorded.
- Multi-session files (e.g. triathlon) are supported; pick the session in the header.

## Visual identity

The UI follows the FitBrain brand identity: flat surfaces with a 3 px radius and no shadows, one blue accent that never
appears inside a chart, series colours used only for the series they name, Source Sans 3 for text and Geist Mono for
numbers (both from Google Fonts), and a provenance tag on every card and tile: `device` for values written by the watch,
`computed` (dashed, with a dotted underline on derived numbers) for everything the analyzer adds. Dark mode follows the
system, with an explicit switch in the sidebar. The only ambient motion is the dot in the sidebar footer, which beats at
the recording's mean RR interval. The mark ("Brain-pulse"), favicon and icons live in `src/ui/Brand.tsx` and `public/`.

## Deploy

The app is a static bundle with no backend. `.github/workflows/deploy.yml` builds it on every push to `main` and
publishes `dist/` to GitHub Pages (Settings -> Pages -> Source: *GitHub Actions*). `vite.config.ts` uses a relative
`base`, so the same bundle also works from any other static host or a local `npm run preview`.

## License

MIT - see [LICENSE](LICENSE). FIT decoding relies on [`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk),
which is distributed under Garmin's FIT Protocol License and pulled in as an npm dependency (not vendored here).
