# Chordz

An expressive browser studio for developing an idea into a complete song. The original archive is preserved; this application carries its musical concept forward in the current workspace.

## Make music

Start with the original hybrid demo, **Where the light returns**, or choose **Songs → Blank song**. Defaults are 120 BPM and 4/4; tempo, meter, key and scale are editable.

On a wide desktop, Sound keeps compact instrument controls beside the modulation rack. The layout follows the available dock width; use **Maximize editor** or **Layout → Editor height** for expanded sample mappings and patches.

- **Write:** play the piano, enter chord symbols, explore inversions and extensions, preview shared notes and voice leading, and write section-linked lyrics. Generate editable melodies, bass, arpeggios, strings and drums with energy, density, register and tension controls. Audition before inserting; existing parts are preserved.
- **Arrange:** create and move sections; drag, resize, split, duplicate, loop and transpose clips. Edit notes, velocities, drum steps and captured expression. Quantize, swing and humanize phrases. Draw volume, pan, filter, expression, pitch bend and send automation.
- **Sound:** sampled piano, strings, cello, horn, flute, glockenspiel and orchestral percussion; hybrid drums and subtractive/FM pads, basses and leads. Edit envelopes, filters, LFOs, detuning and articulations. Import and map your own sample by root, range, velocity and sustain loop.
- **Perform:** open the collapsible Perform dock for the onscreen piano and imports. Computer keys and feature-detected MIDI also work with the dock closed. **Record setup** beside the transport names the destination and input, offers Off/1/2-bar count-in and checks microphone level without creating a take. Monitoring is optional. Finish opens the saved take in Notes / Audio; **Choose a take** auditions individual audio regions while retaining every attempt. Import audio, trim source offsets, align takes, adjust gain and fades, and split regions.
- **Mix and export:** track volume, pan, mute, solo, EQ, saturation, reverb/delay sends, meters and master limiting. Export full-song or selected-section 48 kHz / 24-bit stereo WAV, 48 kHz / 320 kbps CBR stereo MP3, or aligned WAV stems, with explicit effect tails, download/folder destination, progress and cancellation. MIDI exports the full song; portable ZIP backups include every user recording and sample.

**Appearance** offers four amber presets, 2–10px coloured track rails and compact/comfortable spacing. Defaults are amber `#e8b968`, 5px rails and comfortable spacing; Reset appearance restores these values. Preferences stay on this device and do not alter the song. The dock starts closed on a new device. Below 1024px, **Tracks** opens the track drawer.

In Arrange, drag a clip body to move it on its track, or drag its right edge to resize its visible region. The Snap menu chooses the grid. Resizing keeps the loop source and audio offset intact. Arrow keys move the focused clip or resize handle by one grid step; Shift uses a bar. Click the automation curve to add a point; drag a point to move it, or focus it and press Delete. Same-tick points merge, time snaps to the grid and values stay within their parameter bounds. Expandable inspectors retain exact numeric and captured expression editing. Each gesture creates one Undo action; Escape and pointer cancellation restore its starting state.

Select an instrument track with clips and open **Bounce to audio** above the song canvas. **Create audio copy** prints its sound, performance, automation and track effects into a private stereo WAV on a new audio track. **Include bounce effect tails** and **Mute source after bounce** default on; tails can extend the region substantially for long releases or delay. The original instrument and notes remain editable. One Undo restores the previous song; later, mute the copy and unmute the source. A copy is a snapshot, so source changes need a new bounce. Cancel, Close, Escape and Stop reject pending work; an unfinished edit or changed source prevents insertion. A failed device save retains committed audio and offers the existing draft Retry.

Sign in with ChatGPT for private cloud projects. Public access to the studio does not grant access to another musician's songs or audio. The header reports device-draft durability separately from cloud saves, which use revision checks. If device storage fails, keep the tab open and use **Retry device draft** or export a backup. Conflicts preserve the incoming edit and the cloud version. **Songs → Recovery versions** opens retained drafts and conflict versions. Backups restore as a new song.

Shape the chord guide directly on the Write canvas. Click a compact suggestion card to hear it, then drag it onto a chord to replace its voicing or into a rest to add one bar. A collapsible custom card accepts your own symbol. Focus a palette card and press D, arrows, then Enter for keyboard placement. Select a canvas card to edit musical note names and octaves in the inspector; advanced MIDI pitches remain available. Drag a card's handle to reorder whole chords, or its end boundary to resize. Beat, half-beat, quarter-beat and bar snapping are available. Insert, resize and Delete time shift later guide chords within the fixed section; Remove leaves a rest. Existing phrases, recordings and automation keep their timing. Canvas moves choose whole-chord boundaries and translate into the timing command's after-removal positions. Proposals that exceed the section remain available for correction.

Generated phrases retain separate Preview, Insert and Replace actions. Audition pauses the song without resuming it automatically; pressing the same audition again stops it. Relevant musical changes and instrument swaps cancel stale previews. Sound and mixer tuning keep the audition playing and update sounding/future notes; algorithm and articulation changes apply on the next note. Insert offers an alternative track when existing material would overlap, and Edit phrase opens the existing arrangement note editor. Valid field and slider edits form one Undo action; invalid drafts stay visible until corrected or cancelled.

Keyboard shortcuts: Space plays/pauses, Shift+Space auditions the generated phrase, Shift+R records/finishes, Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes, and Shift+Ctrl/Cmd+Z redoes. **Ctrl/Cmd+Shift+Enter always stops all sound, including while typing.** Escape first cancels the nearest draft, drag, shortcut capture or dialog, then stops sound. Open Shortcuts to rebind optional actions; preferences stay on this browser. Workspace, generator, grid, zoom and phrase selection also persist locally.

Stop before capture cancels a recording without creating an empty take. Completed takes are preserved on this device before the playhead resets; cloud upload follows separately. If device preservation fails, the take remains in memory with Retry and Download options. Keep the tab open until either succeeds. Independent computer, pointer and MIDI inputs can hold the same pitch without cutting each other off.

Desktop Chrome and Edge are the full studio targets. Tablet layouts support editing; mobile supports project access and basic editing. Browser MIDI, recording, and folder access are detected. All stems can download together as one ZIP; browsers with folder access can write separate stem files. MIDI-denied or unsupported browsers retain onscreen and computer keyboard input.

## Modulation and reference workflow

Choose a track, then open **Sound → Modulation**. Select a motion starter or add a source; drag it onto a parameter, or use the Source/Destination **Assign** picker. The route row keeps signed depth, curve, smoothing and bypass together. Four named macros are available during MIDI recording. **A/B** stages an audition; Apply commits it once and Cancel restores the saved patch. Local presets and copy/paste retain the complete sound, matrix and movement patch. Vary has separate locks; instrument, output level, tempo and key stay fixed.

Expand **Live & generated chord movement** to shape voicing, rhythm, swing and strum. Generation retains Preview/Insert/Replace in Write. Live arpeggiator and Hold default off, and are also available in the performance dock. Record captures the emitted notes as one editable MIDI take; arrangement playback plays those notes directly. Stop releases held output.

**Reference Audio** analyzes a local MP3/WAV range, a 60-second excerpt or the full file. Review confidence and manually correct tempo/key candidates. Sound, Movement and Both proposals are staged for audition before Apply. Tempo/key application is separate. Measured profiles stay in owner-scoped device storage; reference audio is uploaded only if explicitly imported as a track. Limits are 100 MiB, ten minutes and 256 MiB estimated decoded PCM. Cancellation and retry remain available without locking the transport.

See [the implementation and verification boundaries](tasks/modulator.md).

## Development

Node.js 22.13 or newer is required. Use the existing npm lockfile:

```powershell
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/state
npm run dev
```

The migration command applies only pending local migrations. The development preview runs on loopback at http://127.0.0.1:5173. Its `/signin-with-chatgpt?return_to=/` route simulates a local account for browser testing. This simulation is excluded from production, where Sites dispatch owns authentication and filters visitor-supplied identity headers.

```powershell
npm run typecheck
npm test
npm run lint
npm run test:browser
npm run build
npm audit --omit=dev
```

Browser tests use a separate headless Chrome profile, simulated recording input, and local D1/R2 storage. They do not access personal browser profiles or change hardware or operating-system settings. A running development server and locally applied migrations are prerequisites. The full reference test renders a five-minute, 16-track song, which takes longer than the shorter tests. `npm start` runs the built Worker locally without the development sign-in simulation.

## Architecture and data

React 19, TypeScript, Vinext and Cloudflare Workers; D1 stores projects/revisions and R2 stores private audio. `.openai/hosting.json` binds the existing Site to `DB` and `BUCKET`. Sites publication packages the built Worker, client assets and pending Drizzle migrations from the exact pushed source commit.

- `lib/music`: versioned document/schema, theory, seeded assistance, history and immutable editing. Musical positions use 960 ticks per quarter note; audio offsets use seconds.
- `lib/audio`: catalog, compiled arrangement, shared native Web Audio graph, Tone context/clock integration, live scheduler, offline renderer and exports. Four-second render scheduling windows limit the number of simultaneously allocated voices. The UI is outside the audio scheduling loop.
- `public/audio`: AudioWorklet capture, generated recording/waveform worker, and a separate lazily loaded MP3 worker/WASM. Build hooks regenerate workers and copy the pinned local WASM. MP3 failures leave recording processing independent and permit a new export attempt.
- `lib/client`: owner-scoped IndexedDB drafts/assets, upload retries and cloud requests.
- `lib/server`: bounded validation, ownership checks, parameterized SQL and atomic revision updates. Recordings are streamed to R2; private endpoints return non-cacheable responses.
- `components/studio`: writing, arrangement, sound, mixer, transport and project workflows.

| Endpoint                     | Operations                              | Access                                   |
| ---------------------------- | --------------------------------------- | ---------------------------------------- |
| `/api/projects`              | list, create                            | signed-in owner                          |
| `/api/projects/:id`          | load, revision-checked save, delete     | project owner                            |
| `/api/projects/:id/versions` | retained conflict versions              | project owner                            |
| `/api/assets`                | streamed upload, stable-ID retry        | owning musician and owned target project |
| `/api/assets/:id`            | private audio read, unused-asset delete | asset owner                              |

Limits are 64 tracks, 1.8 MB of project edit data, 100 MB per audio file, and 512 MB of uncompressed assets per backup. WAV/stem rendering uses browser memory and is subject to the browser's available capacity. Sample download or upload failures preserve project settings and recovery data. Individual cloud projects can reference audio shared with their owner's recovered copies; deleting one copy preserves assets still in use.

## Samples and licensing

The curated factory bank contains 144 CC0 WAV recordings from [VSCO Community](https://versilian-studios.com/vsco-community/) and [VCSL](https://github.com/sgossner/VCSL). `public/sounds/LICENSE.txt` and `provenance.json` include source revisions, original paths and SHA-256 checksums. The catalog uses the velocity layers, round-robin recordings and articulations actually available for each instrument. Factory samples load on demand by instrument. Sample filenames use source C3 = MIDI 60 and the manifest translates that convention.

`scripts/curate-samples.mjs` rebuilds this bank from pinned upstream revisions. User samples and recordings are private assets; portable backups include them, while factory samples reload from Chordz.

MP3 export uses pinned `wasm-media-encoders@0.7.0` (MIT wrapper and LGPL LAME). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `public/audio/licenses/` for licence text, matching source/build information and replacement instructions.

## Verification and current boundaries

See `docs/VALIDATION.md`, `SPEC.md`, `tasks/todo.md` and `tasks/workflow-patch-checklist.md` for scope and evidence. Automated checks cover musical edits, isolation, conflict recovery, sample tuning, browser workflows, AudioWorklet capture, exports and the five-minute reference. Physical microphone latency, MIDI hotplug behavior on real controllers, a human listening session, and a full session with physical devices in Edge remain to be validated by a musician. Automated sign-in tests use the local dispatch simulation; hosted sign-in is handled by Sites.

Assistance runs locally with deterministic rules and editable patterns. Paid AI services, native plugin hosting, automatic vocal tuning, audio time-stretching and simultaneous collaboration are deferred.

The workflow patch passes 46 unit tests, 24 Chrome scenarios and 12 focused Edge scenarios. Its exact generator baselines and both original demos remain compatible. The note editor retains its existing functionality. MIDI files contain ordinary musical notes and controls; runtime input-source ownership is intentionally not exported.

The chord-card follow-up passes 52 unit tests, all 32 Chrome scenarios and 20 focused Edge scenarios, plus TypeScript, zero-warning lint and the production build. See `tasks/chord-card-patch.md` and `docs/evidence/chord-card-patch.json` for the user-reported screenshot, movement and tuning results, and remaining physical-device/listening checks. Earlier fragmented guides retain their timing; new whole-card reordering does not split neighbours.

The UI upgrade's original release record is retained in `tasks/ui-upgrade.md` and `docs/VALIDATION.md`. The Modulator verification now also exercises its UI and export browser scenarios in isolated Chrome. See the latest validation entry for current results and remaining physical-device/listening/native-window checks.

The [recording and finishing milestone](../docs/phase-3-record-finish.md) passes 324 unit tests, 88 distinct affected/native Chrome scenarios across broad and focused runs, TypeScript, zero-warning lint and the production build. Its consolidated receipt records exact run provenance, native section/stem timing, the five-minute reference and remaining human/device checks. It was subsequently merged through [PR #3](https://github.com/Zerolitter/Chordz/pull/3) with both Studio and Windows CI passing, and published as Site version 10; the validation addendum records that release separately.

The subsequent [reversible bounce milestone](../docs/phase-4-bounce-copy.md) passes 354 unit tests, 88 distinct affected/native Chrome scenarios across recorded runs, TypeScript, zero-warning lint and the production build. Its receipt records source restoration, independent bytes, cancellation, bounded tails, signal comparisons and remaining human/device/performance checks. GitHub/Sites release status is recorded separately after publication.
