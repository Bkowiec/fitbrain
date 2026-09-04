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
| Suunto ZoneSense | DDFA index (HRV-based intensity, 0 = aerobic baseline, thresholds −0.2 / −0.5): time in aerobic / anaerobic / VO2max zones from the stream vs the device, threshold crossings, relation to HR, per-km table, charts aligned with HR, pace and power |
| Developer streams | any per-record developer field (e.g. DDFA) or non-standard field is averaged into splits, the time digest and its own chart |
| Extras | HRV statistics from RR intervals (SDNN, RMSSD, pNN50), GPS bounding box, developer/vendor fields with names and units (known vendor unit quirks corrected, e.g. Suunto peak EPOC), athlete profile / zones target / workout metadata, undocumented messages and fields |
| Raw | browse every decoded message, download all as JSON |

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
src/fit/zonesense.ts  Suunto ZoneSense / DDFA analysis
src/fit/format.ts     formatting helpers (pace, durations, local time)
src/export/           Markdown and JSON report generators
src/ui/               React components (overview, laps & splits, zones, charts, performance, events, raw data, export)
scripts/              Node helpers: report.ts (full pipeline), inspect-fit.mjs (message dump)
```

## Notes on semantics

- Running cadence in FIT is strides/min (one leg); the UI and reports show steps/min alongside.
- Computed metrics are estimates from the record stream; device values are always reported as recorded.
- Multi-session files (e.g. triathlon) are supported; pick the session in the header.

## Deploy

The app is a static bundle with no backend. `.github/workflows/deploy.yml` builds it on every push to `main` and
publishes `dist/` to GitHub Pages (Settings -> Pages -> Source: *GitHub Actions*). `vite.config.ts` uses a relative
`base`, so the same bundle also works from any other static host or a local `npm run preview`.

## License

MIT - see [LICENSE](LICENSE). FIT decoding relies on [`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk),
which is distributed under Garmin's FIT Protocol License and pulled in as an npm dependency (not vendored here).
