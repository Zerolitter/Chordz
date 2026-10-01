# Phase 0B: discovery and reusable library

Date: 2026-10-01. Continue from `8a537e0` on `codex/phase-0a-workspace`. The user explicitly authorized 0B and deferred the observed baseline/revised workflow comparison. That comparison remains unperformed. The approved 0A shell, appearance and existing musical tools are preserved.

## Delivered behavior

The assets panel becomes Sounds, Ideas, Favorites and Recent with search, type/family filters, simple instrument icons and visible placement destinations. Preview, Insert and Replace are explicit. Browsing and starring add no music history. Successful preview or committed placement updates recents. Failed placement keeps the candidate and its reasons; overlaps and incompatible instrumental phrases provide a complete new-track route. Audio remains Insert-only.

Save a selected instrumental sound or MIDI/drum/audio phrase through **Save & manage library**. A saved sound includes its instrument, sound, modulation, movement, EQ, drive and sends. Replacement preserves destination clips, automation, identity, base volume/pan, mute/solo and master settings. Mapping conflicts offer keeping current modulation or inserting the complete sound on a new track. Unsupported bindings keep their authored data, show inactive targets/reasons and share resolution in the rack, native playback, candidate audition and offline export.

Library entries are version 1 and device-local, scoped by encoded owner identifiers in `chordz-library-v1` IndexedDB. Favorites/recents use library metadata, separate from song history and 0A view/layout preferences. Saved/imported entries and every placement receive fresh entry/manifest/clip/note/asset identities. Patch-local source, route, macro and controller identities and seeds remain intact. Mutable musical payloads are deeply cloned; runtime evaluators and held input owners belong to their engine/session.

MIDI/drum source timing remains 960 PPQ; arrangement positions are integer ticks. Saved audio records visible duration, source offsets, fades and file duration in seconds. Placement derives duration ticks from destination tempo while copying the original file bytes. Carried controller bindings, channel/omni CC routing and reachable dependencies decide phrase compatibility. Unused controllers do not constrain reuse; intentionally unmapped events and note-only phrases are retained.

## Checked operations and asset lifetime

Placement captures owner, document epoch, explicit track/section/clip destination and monotonic track, section and timing revisions. Target instruments and referenced asset metadata participate in revisions. Provisional target edits, cancellation, Undo/Redo and reload cannot restore an old operation's validity. After source acquisition/copying and immediately before commit, the controller rechecks scope/activity, destination, revisions, drafts, recording, compatibility, overlap and project limits. It assembles from the latest committed document and performs one checked commit without an intervening await, retaining unrelated edits.

Source leases retain immutable entry/blob snapshots through active preview/insertion. Deletion removes only library-owned metadata/blobs, deferring leased blob deletion. Library saves/imports and project copies use fresh independent ownership. Project copies are atomically staged in recovery IndexedDB, excluded from uploads until a successful checked commit. Only unused, uncommitted operation-owned copies can be discarded. Committed copies remain available through library deletion, Undo/Redo and recovery; this phase adds no project-audio garbage collector.

Recovery IndexedDB upgrades to version 2 to add staging; the **project document schema stays version 1**. A committed recovery draft promotes interrupted copies. Promotion failure returns the durable song with a visible warning, retains copies/eligibility and retries on a subsequent recovery read/save. It does not replace the song with the demo. Cloud endpoints, authentication and the Windows wrapper are unchanged.

Candidate audition uses a separate owned graph inside the existing engine, context and output. Navigation/collapse cancels audible candidates and invalidates pending loads without stopping song playback or capture. Native note/event/audio scheduling shares chronological song time; bend/pressure events in the same scheduling window remain attached to the intended voices. Immutable candidate assets use the library resolver, while source blobs remain leased until cancellation or completion. Candidate-owned decoded copies are released after cancellation, completion or failed loading, including late decodes. Current project assets, active replacement candidates and factory URL caches remain protected. This cleanup does not delete persistent blobs or project assets.

## Backup and import

**Export library backup** writes a versioned ZIP manifest and exact asset files with SHA-256 integrity descriptors. Import validates the bounded manifest, identities, references and exact blobs before one atomic fresh-copy storage transaction. Limits: 500 entries, 1,000 asset files, 100 MB per audio file, 1.8 MB metadata and 512 MB expanded archive data. Validated local/central declarations and bounded streaming expansion reject contradictory sizes, overlapping ranges, parser redirection and undeclared expanded data. ZIP64 and encrypted archives are unsupported. Existing project backups and legacy patches retain their formats and routes.

No cloud library sync, warping, new DSP, second editor, publication or hardware/OS changes are part of this delivery.

## Verification receipt

Executed on the final application source:

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passes |
| Lint | `npm run lint -- --max-warnings=0` passes with zero warnings |
| Unit tests | `npm test`: **290/290 in 34 files** |
| Production build | `npm run build` passes; the existing advisory about chunks larger than 500 kB remains |
| Broad Chrome regression | **143/145 passed**, exposing two recording-readiness fixture failures before musical assertions |
| Final affected browser run | **43/43** native audition, modulation PCM, recording, reusable library and workflow scenarios pass after the decoded-cache fix |
| Final populated lifecycle check | **1/1** passes with musical context and all original input/draft assertions preserved |
| Aggregate browser coverage | **146 distinct scenarios in 27 files verified** across the broad and focused runs; not a claim of one uninterrupted 146-case green suite |

The new library files cover **14 UI, 7 storage and 5 native audition scenarios**. The seven storage cases also passed together after the concurrent-preference and recovery fixes. Layout coverage includes populated/empty workspaces at 1366×768, 1920×1080, 1024×768 and 390×844. The final library screenshots at laptop and narrow sizes retain graphite surfaces, named destinations, transport access and internal scrolling.

Reproducible commands run from `studio/`:

```powershell
npm run typecheck
npm run lint -- --max-warnings=0
npm test
npm run build
npx playwright test --output=output/phase-0b-final
npx playwright test tests/browser/library-storage.spec.ts --output=output/library-storage-complete
npx playwright test tests/browser/library-audition.spec.ts tests/browser/reusable-library.spec.ts tests/browser/modulation-audio.spec.ts tests/browser/workflow-patch.spec.ts tests/browser/modulation-recording.spec.ts --output=output/phase-0b-affected-final
npx playwright test tests/browser/workspace-lifecycle.spec.ts --grep "an invalid draft blocks a chord-guide handoff" --output=output/phase-0b-lifecycle-fixture-final
```

Ignored local evidence directories preserve the broad failure traces and focused run artifacts. Screenshots are [laptop](../studio/output/library-review/1366-library.png) and [narrow](../studio/output/library-review/390-library.png).

Audio UI coverage imports a real WAV, saves its trimmed half-second phrase at 120 BPM, inserts it at 180 BPM as 1,440 ticks, and verifies the original byte length and SHA-256 through library deletion, Undo/Redo and reload. Native checks compare PCM with matched tempo/mix conditions below `1e-6`, including unsupported modulation resolution. They do not measure human listening quality or prove physical device behavior.

Regression-driven review corrected preview-window bend/pressure ordering, nonblocking recovery promotion failure, archive parser/expanded-size ambiguities, cross-tab preference updates, transitive inactive macro destinations and carried-controller dependency signatures. A preliminary broad runner was stopped after 11 successful cases to finish the final signature correction; it is not counted as the final full suite. The actual sample-map revision case changes a sample zone root, rather than only its display name. Final independent source reviews found no blocking issue in checked placement, asset lifetime or candidate-cache cleanup.

The broad runner's two failures were the queued-arpeggio release case and the populated invalid-draft chord-guide handoff. Both failed the original 15-second recording-readiness assertion while preparing/counting in, before their input-lifetime assertions. The traces show successful local bundled acoustic loading: roughly 38 MiB for the single piano and 109 MiB of requested WAV payload for the populated eight-track demo, with many populated requests incomplete at the deadline. There were no console/page errors. The final fixtures use the existing Glass FM sound through the UI to isolate input-lifetime behavior from cold sample loading. The populated fixture explicitly verifies unchanged sections, chords, clips/notes/events, automation, mixer values and selected track/phrase. Neither recording deadlines nor musical assertions were loosened. Their final checks pass, but these fixtures do not establish a 15-second cold acoustic startup budget; that remains a separate loading observation.

Repeated sample/audio previews also reproduced retained private decoded buffers before the final engine edit. The five native scenarios now verify cancellation during pending loading, repeated fresh copies, natural completion, partial load failure, replacement protection and preservation of project/factory caches. The final 43-case affected run repeats those native checks alongside playback/export modulation, all library UI scenarios and recording/recovery behavior.

Automated evidence and the deferred musician task remain separate. Physical microphone/MIDI/hotplug, touch, human listening, hosted behavior and reopened WebView2 are not inferred from browser fixtures or rendered PCM.
