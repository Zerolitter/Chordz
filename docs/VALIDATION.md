# Windows desktop preview validation

Date: 2026-09-30. Version: 0.1.0.

## Source

The desktop client was built in the requested Chordz workspace. The unrelated screen magnifier was backed up under the ignored local `work/center-zoom-original/` directory. It is excluded from the repository and release.

The complete studio source snapshot is `a682ed6fa167f131e764794416c1396d7034fbd9`. Its original checkout and published Site were unchanged. The client loads `https://www.chordz.zerolitter.net`; internet access is required.

## Checks completed

- Fresh desktop npm installation: passed; zero npm vulnerabilities reported.
- Native navigation/security tests: 5 passed.
- Rust formatting: passed.
- Release executable and NSIS x64 installer: built successfully with the committed Cargo lockfile.
- Executable Windows metadata: ProductName and FileDescription are Chordz, version 0.1.0.
- Fresh studio dependency installation: passed from the committed npm lockfile.
- Studio TypeScript: passed.
- Studio unit suite: 52 tests passed across 9 files.
- Studio lint: passed with zero warnings.
- Studio production build: passed.
- Public source audit: no obvious credentials, private recordings, environment files or database state are tracked. All 144 factory sample checksums match their CC0 provenance; no individual source file exceeds GitHub's file-size limit.
- Independent desktop review: completed. The opener plugin's injected link interception was disabled so native external-link handlers work without granting web pages native IPC permissions.

The Tauri CLI emitted a deprecation warning for its legacy `STATIC_VCRUNTIME` build variable. Compilation and bundling succeeded.

## Limits

The desktop window, hosted sign-in, physical microphone, MIDI devices, actual downloaded exports and listening experience have not been exercised in this native runtime. The existing studio's earlier browser results remain recorded under `studio/docs/` and do not substitute for desktop checks.

The preview is unsigned and requires WebView2. Browser and desktop sessions are separate. Providers that refuse embedded sign-in can be used through the browser studio instead. This build contains an online desktop client, not an offline studio server.

GitHub workflow results are separate from these completed local checks.

## Hosted UI upgrade — 2026-09-30

The target `studio/` source was reconciled with the existing Site before applying the approved Palette C redesign, working arrangement gestures, Appearance settings, collapsible performance dock and MP3 export. No native wrapper or installer code changed; reopening this online client loads the hosted UI.

The final source passes 71 Studio unit tests, TypeScript, zero-warning ESLint, production build and the production dependency audit. Independent MP3 decode evidence and preserved v1/backup/audio-byte round trips are recorded in `studio/docs/VALIDATION.md`.

Browser permission verification was unavailable, so the new browser scenarios, visual comparison and reopened native-window behavior have not been exercised. Existing native build/navigation evidence above remains historical and does not substitute for checking the upgraded hosted UI. Physical microphone/MIDI and human listening also remain outstanding.

## Hosted Modulator upgrade — 2026-10-01

The existing selected-track Sound workspace now includes the modulation matrix, four macros, staged A/B, original starting patches, chord movement and local reference analysis. The target Studio source remains reconciled with its existing Site. Native wrapper and installer code are unchanged; reopening the online client loads the published Studio update.

Current Studio verification passes 156 unit tests, TypeScript, zero-warning lint, production build and a zero-finding production dependency audit. All 67 browser scenarios are verified through the complete run plus focused post-fix audio/recording reruns. This also executes the earlier Palette C UI and MP3 browser scenarios. Native audio comparisons, synthetic analysis, local supplied-sample measurements, five-minute exports, storage/recovery and enhancement compatibility evidence are detailed in `studio/docs/VALIDATION.md`.

Visual desktop/tablet/mobile checks and isolated Chrome downloads pass. Actual microphone/MIDI/touch devices, human listening, production sign-in/download behavior and the reopened native window remain hands-on checks. Existing native build evidence is historical; current GitHub build/publication results are reported separately. No hardware or OS configuration changed.
