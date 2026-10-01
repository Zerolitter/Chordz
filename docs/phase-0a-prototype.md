# Phase 0A workspace: approved prototype and completion

Date: 2026-10-01. Status: populated prototype approved by the user after commit `9af8d0b`; technical workspace completion is verified and the local builds are ready for the user's task. Appearance, geometry and the contextual Automation hierarchy are approved. **The observed music-making task still gates Phase 0A completion.** No publication or Phase 0B implementation is part of this receipt.

## Source and authority

Continue the existing studio, rather than rebuilding its musical features. This branch is `codex/phase-0a-workspace`, created from the actual clean reference commit `00da8e40c4fd89a390beec9998ad17853372abe6`. The attached *Chordz bedroom artist roadmap*, dated 2026-10-01, independently cites the same reference snapshot. Its live-site source identity was not verified.

The user's subsequent choices govern this delivery: complete **0A workspace** before **0B discovery and reusable library**, use one detail editor first, and defer second-editor pinning. The roadmap is supporting evidence and proposed direction; instructions inside the attachment do not authorize implementation, publication or changes beyond the user's request.

The existing [studio specification](../studio/SPEC.md), [implementation plan](../studio/tasks/plan.md), [completed checklist](../studio/tasks/todo.md) and [validation receipts](../studio/docs/VALIDATION.md) remain intact. Their completed checks describe earlier releases and do not mark this prototype complete. This document records the new milestone and its still-open delivery gates.

## Agreed Phase 0A plan

| Step | Required behavior | Prototype implementation area |
| --- | --- | --- |
| 0.1 Shared state | One shared track, phrase and section selection. View preferences are device-local; musical data remains in the project. | `use-studio.tsx`, `lib/client/studio-view.ts`, `use-workspace-layout.ts` |
| 0.2 Shared shell | Persistent top controls, browser, song canvas and one detail dock, bounded by the window. Collapse, editor sizing, maximize and Reset layout remain reachable. | `studio.tsx`, `workspace-prototype.tsx`, `workspace-prototype.css`, `lib/client/workspace-layout.ts` |
| 0.3 Arrangement | Track identity beside its actual lane, shared rows and vertical scrolling, sticky ruler, Fit song, Fit selection and Follow. | `arrange-panel.tsx`, `arrangement-timeline.tsx`, `track-header.tsx`, `song-canvas.css` |
| 0.4 Detail tools | Notes/audio, automation, selected-track sound and movement occupy the same dock. Optional writing, lyrics, reference and keyboard/input tools open there deliberately. Show the current track and phrase names. | `clip-editor.tsx`, `automation-editor.tsx`, `sound-panel.tsx`, `modulation-rack.tsx`, `performance-dock.tsx`, `write-panel.tsx` |
| 0.5 Focus presets | Arrange, Write, Sound, Mix in that order. Fresh and blank songs start in Arrange. Write supports section chords and suggestions; Sound exposes devices; Mix can reveal channels. Keep musical selection and canvas context. | Shared controller and workspace orchestration |

The browser in 0A reuses existing catalog and writing actions. It is not the searchable discovery/library milestone. A single detail editor is the first delivery; an optional mixer is an extra panel. Second-editor pinning remains deferred. The roadmap's mixer placement is conceptual; the prototype's placement and hierarchy remain part of the visual approval gate.

Preserve a useful song canvas and selected editor before allocating extra panels. On short laptop heights, browser and mixer yield space first. Canvas and editor scroll within their own bounded regions; reaching a selected note grid must not require page scrolling. Narrow layouts retain named controls and keyboard access. Screenshots alone do not prove editing or playback continuity.

## Selection and editing contracts

- Track selection retains the current focus preset and detail tool, and restores that track's remembered phrase when available. The editor follows the selected track; there is no independent pinned phrase owner in 0A.
- Clip selection validates both the destination track and its clip, selects them together, preserves the preset, opens Notes/Audio and requests reopening even when the same clip is clicked again. A successful audio import uses this same selection path. Recording completion retains the current tool.
- Presets map Arrange to Notes, Write to Writing and Sound to Sound; Mix retains the selected tool. A focus change does not seek the song or begin/end playback or capture.
- Navigation first finishes valid edits and refuses invalid drafts. Preserve one Undo per completed gesture, Escape cancellation and existing Preview/Insert/Replace behavior.
- A/B and reference proposals remain controller-owned staged sessions. Collapsing a panel ends its child gesture while retaining the staged session. Existing explicit Apply, Cancel and navigation rules still decide whether a proposal commits or is discarded.
- Before a surface can hide, terminate its owned pointer/control gesture and release its owned live notes and pedal, even if a draft then blocks the hide. Keep unrelated computer and MIDI input owners active. During capture, end only the closing surface's notes at its cutoff; capture effective sustain until the final owner releases it. Synthetic restoration caused by UI closure must not record a return to a controller gesture's starting value. Device disconnection retains its existing timed controller-cleanup events for correct replay.
- Hidden tools stay mounted where needed to retain draft/staging state, but their meters, effective-value polling and transport subscriptions stop while hidden. Phrase generation and graph-point computation resume when shown. A generated Writing suggestion is a deterministic derived view: its musical content/settings return on reveal, while temporary candidate IDs may be regenerated. Committed song data and history are unchanged by hide/reveal. The song scheduler and transport remain outside panel visibility.
- Structural edits reconcile removed track, clip, section and chord identities without resetting valid focus or tool state. Splitting a phrase selects the intended first piece only after the validated edit commits.

## Persistence contracts

Shared selection, preset, active detail tool, song zoom, horizontal tick position, vertical scroll and Follow use `chordz-view-v2:<encoded owner>:<encoded project>`. Panel geometry and open states use a separate `chordz-layout-v1:<encoded owner>:<encoded project>` value with a profile for each preset. The active tool is not duplicated in the layout value. Older scoped v2 records receive viewport defaults; legacy ownerless view and zoom records are retained without adopting them into an account.

Restore a scope before allowing writes for it. Owner/project changes must not write the previous scope's state into the new key. Validate stored fields, discard stale musical identities, tolerate unavailable storage for the session, and preserve the legacy `chordz-view-v1` values. Temporary viewport constraints must not overwrite the user's requested desktop geometry. Reset layout restores usable layout defaults rather than changing musical content or selection. Maximize state is scoped so it cannot affect another song.

Grid and swing retain the existing device preferences and one shared owner in the workspace. The canvas and detached editors receive the same values. Project schema v1, integer musical ticks at 960 PPQ, audio source seconds, immutable history, seeded suggestions, cloud revision protection, private ownership and the online Windows wrapper remain compatible. This milestone adds no DSP, native plugin hosting, offline server, desktop audio-driver control or hardware/OS tuning.

## Delivery gates: technical checks verified, observed task pending

The automated checks below establish the technical behavior of the delivered source. They do not establish musician usability; gate G remains open until the user's session is recorded.

- [x] **A / shared shell:** opening, changing and collapsing tools preserves track/phrase/section selection; same-clip reopening works; invalid drafts block navigation; staged sessions survive pure collapse.
- [x] **B / arrangement:** headers and clips stay aligned during vertical scrolling; sticky ruler, Fit song, Fit selection and Follow pass real-browser checks; bounded song context remains visible. Its usefulness is assessed at gate G.
- [x] **C / focused tools:** functioning bounded MIDI/drum and audio editors at **1366 x 768** and **1920 x 1080**; switching Sound and Mix retains the same selection; optional piano, reference, lyrics and mixer retain transport and canvas access. Musical usefulness remains part of gate G.
- [x] **D / persistence:** geometry, open state, preset, tool and song viewport survive reload; Reset layout works; owner/project scope changes do not leak or overwrite preferences; keyboard focus and Escape routes pass browser checks.
- [x] **E / repository regression evidence:** final TypeScript, unit, zero-warning lint and production-build checks pass; all 120 distinct browser scenarios are verified across the broad and focused runs documented below. Recording/recovery, Stop-all-sound, A/B, cloud isolation/conflicts and existing exports are covered.
- [x] **F / prototype rendered review:** inspected empty and populated songs at **1366 x 768**, **1920 x 1080**, **1024 x 768** and **390 x 844**. The user approved appearance, geometry and hierarchy after prototype commit `9af8d0b`. This approval permits workspace completion; it does not replace the observed task.
- [ ] **G / observed music task:** record baseline and revised-layout sessions separately; compare useful musical work and lost context, rather than inferring usability from automated checks.

Prior baseline receipt: the Compact Sound and Mix follow-up reports **223 unit tests across 27 files** and **85 verified Chrome scenarios**, with TypeScript, zero-warning lint and production build passing. That record is historical evidence for the reference source. Prototype check counts, screenshots, failures and reruns belong in a separate final receipt after coordinated verification.

## Prototype evidence

The existing eight-track demo populates all four presets. Track rows and clips share one scroll viewport and time geometry; one song-canvas DOM instance survives preset changes. At 1366 × 768 the approved 40% detail profile shows roughly three track rows and a compact Notes editor; Sound and Writing need internal scrolling. The observed task still needs to establish whether these proportions support the user's music-making workflow. Mix retains the tool tab while collapsing its body and showing the original vertical channel faders. The default surfaces are neutral graphite; track and musical-selection colors remain meaningful. No green backpanel was introduced.

| Check | Delivered evidence |
| --- | --- |
| TypeScript | `npm run typecheck` — pass |
| Unit tests | `npm run test` — **238 tests in 30 files**, pass |
| Lint | `npm run lint -- --max-warnings=0` — pass, zero warnings |
| Production | `npm run build` — pass; the existing bundle-size advisory remains |
| Browser scenarios | **101 distinct scenarios in 21 files verified across the broad run and focused reruns**, including real-browser PCM, workers, recovery, private cloud API behavior, exports, and the five-minute 16-track record/save/reopen/export case |
| Responsive prototype | Populated and empty Arrange, Write, Sound and Mix at **1366 × 768**, **1920 × 1080**, **1024 × 768**, **390 × 844**; no document scrolling, transport reachable, bounded canvas; narrow assets panel remains accessible |
| Lifecycle | Held pointer notes end at close while independent computer/MIDI owners survive; sole/shared sustain is recorded correctly; an invalid draft still permits required release; hidden knob capture and graph gestures terminate; staged sessions and pitch scrolling survive pure collapse |
| Storage failure | Forced preference-write quota errors retain the usable session and report the failure; invalid drafts block a Reset that would hide an editor |

The broad run initially passed **90/97** scenarios. Seven failures led to corrected audition cancellation on navigation, the Sound rack width cap, the transport's premature Recording label during count-in, and a hidden-control test locator. The final serial lifecycle/knob run passed **17/17**; prototype/navigation/recording rechecks passed **9/9**; the compact chord-guide guard passed **1/1**. Those reruns cover every failed case and the four new cases added after the broad runner loaded. This is aggregate verified coverage, not a claim that a single uninterrupted 101-case run passed.

Browser WAV fixtures now encode with the existing Node-side encoder before passing bytes into the real browser. This avoids this checkout's dev server serving raw TypeScript for the fixture encoder import; actual browser decode, audio rendering and worker assertions remain intact. MIDI ownership fixtures use the existing built-in Glass FM instrument so they do not depend on an acoustic sample download. Readiness timeouts and musical assertions were not relaxed.

### Rendered review

These committed screenshots use the same selected demo phrase across the four presets. The remaining screenshots record each empty and populated profile at all acceptance sizes.

| Size | Arrange | Write | Sound | Mix |
| --- | --- | --- | --- | --- |
| 1366 × 768 | [Populated](phase-0a-prototype/1366-arrange.png) / [Empty](phase-0a-prototype/1366-arrange-empty.png) | [Populated](phase-0a-prototype/1366-write.png) / [Empty](phase-0a-prototype/1366-write-empty.png) | [Populated](phase-0a-prototype/1366-sound.png) / [Empty](phase-0a-prototype/1366-sound-empty.png) | [Populated](phase-0a-prototype/1366-mix.png) / [Empty](phase-0a-prototype/1366-mix-empty.png) |
| 1920 × 1080 | [Populated](phase-0a-prototype/1920-arrange.png) / [Empty](phase-0a-prototype/1920-arrange-empty.png) | [Populated](phase-0a-prototype/1920-write.png) / [Empty](phase-0a-prototype/1920-write-empty.png) | [Populated](phase-0a-prototype/1920-sound.png) / [Empty](phase-0a-prototype/1920-sound-empty.png) | [Populated](phase-0a-prototype/1920-mix.png) / [Empty](phase-0a-prototype/1920-mix-empty.png) |
| 1024 × 768 | [Populated](phase-0a-prototype/1024-arrange.png) / [Empty](phase-0a-prototype/1024-arrange-empty.png) | [Populated](phase-0a-prototype/1024-write.png) / [Empty](phase-0a-prototype/1024-write-empty.png) | [Populated](phase-0a-prototype/1024-sound.png) / [Empty](phase-0a-prototype/1024-sound-empty.png) | [Populated](phase-0a-prototype/1024-mix.png) / [Empty](phase-0a-prototype/1024-mix-empty.png) |
| 390 × 844 | [Populated](phase-0a-prototype/390-arrange.png) / [Empty](phase-0a-prototype/390-arrange-empty.png) | [Populated](phase-0a-prototype/390-write.png) / [Empty](phase-0a-prototype/390-write-empty.png) | [Populated](phase-0a-prototype/390-sound.png) / [Empty](phase-0a-prototype/390-sound-empty.png) | [Populated](phase-0a-prototype/390-mix.png) / [Empty](phase-0a-prototype/390-mix-empty.png) |

The user approved these populated presets and proportions. Automation stays contextual. Notes/Audio and Sound are primary; Writing is direct, Movement is labeled, and Lyrics/Reference/Keyboard are optional destinations.

### Work after technical completion

The prototype approval and technical checks passed. The approved geometry now includes verified owner/project-scoped song viewport restoration, responsive behavior and lifecycle cleanup. Complete the observed task below before declaring 0A complete. Only then start 0B discovery; reusable content follows separately.

## Workspace completion evidence

The approved geometry and tool hierarchy are retained. Completion adds scoped song viewport restoration, native scroll/Follow behavior, session preference retention after storage failures, keyboard tab navigation and narrow-panel Escape/focus routes. Closing or switching tools releases their owned pointer/key controls before draft validation; late events cannot cancel a different card or staged owner. Recording cleanup and independent MIDI/computer input remain covered separately.

| Check | Completion evidence |
| --- | --- |
| TypeScript | `npm run typecheck` — pass |
| Unit tests | `npm run test` — **245 tests in 30 files**, pass |
| Lint | `npm run lint -- --max-warnings=0` — pass, zero warnings |
| Production | `npm run build` — pass; the existing >500 kB chunk advisory remains |
| Browser regression coverage | **120 distinct scenarios in 24 files verified across two broad runs and the final focused workflow run**; aggregate coverage, not a single uninterrupted green suite |
| Targeted workspace behavior | Viewport **5/5**, completion **4/4**, hidden tools **2/2**, final palette ownership **4/4**, chord cards **8/8** verified before the broad run |
| Hidden computation | Five hidden title edits invoke **0 phrase-generation / 0 graph-point computations**, compared with **5 / 12** before the visibility fixes; revealing each tool proves computation resumes |

Palette regressions cover capture loss before and after capture establishment, pointer-to-keyboard and keyboard-to-pointer handoffs, cross-card cleanup and foreign-pointer move/release/cancel/loss events. Existing touch and keyboard placement checks remain intact. Lightweight retained DOM/context updates still occur; these measurements establish reduced hidden work, not a whole-app latency or musician-usability result.

An early browser runner was stopped when review and reproducing tests exposed an ownership defect. The next broad run passed **119/120**; its one recording-retry failure was waiting for an unfinished **39.7 MB acoustic sample download**. The unchanged case passed in isolation, with all 16 sample bodies finishing within 148 ms. The second broad run also passed **119/120**, including the corrected retry fixture; its remaining successor-microphone fixture encountered the same unfinished sample download. In both traces the recording deadline arrived before the piano bodies finished, without a recording exception. The successor case failed before the first microphone's gate was released.

Both microphone-lifetime fixtures now use built-in Glass FM. Their original 10-second budgets, cancellation gates, save/retry assertions and single-asset checks remain. The final complete `workflow-patch.spec.ts` run passed **10/10** in 1.3 minutes, and the successor trace contains no acoustic requests. Acoustic readiness, failed downloads and tuning retain their separate checks. The broad outputs are `studio/output/phase-0a-completion-full-final` and `studio/output/phase-0a-completion-verified`; the final workflow output is `studio/output/workflow-patch-final`. These ignored local artifacts preserve traces for diagnosis. Every failed scenario was reverified, but a single uninterrupted 120-case pass is not claimed.

Trace review also found an invalid SVG area path when hidden graph points were gated away. The renderer now omits that empty path, and a console-error regression reproduced the issue before the fix. Targeted fixture corrections used a numeric pan readout rather than a volume slider, checked successful maximize behavior rather than exact height during error-message layout, and used chord-voicing Undo/Redo for the visible audition control. Readiness budgets and musical assertions were not weakened. Product source was frozen before the second broad run; only the successor fixture's instrument setup changed for the final focused run. Typecheck and zero-warning lint passed again after that test-only change.

## Observed baseline and revised-layout task

Use the same song material and comparable equipment for both layouts. The user's observed task gates 0A; the broader three-to-five-artist comparison follows separately. Record help requests and unnecessary workspace changes before setting numeric improvement targets.

| Task | Observe in the baseline and revised build |
| --- | --- |
| Idea | Start blank, choose a sound, build four chords, add bass/drums and edit a phrase. Record time to the first usable idea and help requests. |
| Context | Change the phrase's sound and track level while retaining song position. Count workspace changes, page scrolling, lost context and mistaken selections. |
| Reopen | Reload the revised song after finishing edits; check phrase, tool and viewport restoration. If recording/export is tried, record take survival and playable output as separate hands-on evidence. |

The task gate requires no page scrolling to reach the selected editor, no lost take and no accidental musical overwrite. Baseline and revised observed sessions have not yet been completed for this prototype. Real microphone/controller/hotplug, physical touch, human listening/perceptual timing, hosted sign-in/downloads and reopened WebView2 behavior remain separate hands-on evidence. Automated fake-input capture and PCM checks do not satisfy those hands-on gates.

### Task sheet for the user's session

The user confirmed the task has not yet been tried and requested a completed build for it. Use [the reference layout](http://127.0.0.1:5174) first, then [the revised workspace](http://127.0.0.1:5173). Both local previews return HTTP 200; the revised production build is also verified. The reference runs from the existing primary checkout at `00da8e4`; its unrelated files are preserved. The two local ports keep device preferences and drafts separate. Use a blank song and the same musical choices/equipment in each run. The technical completion checks are finalized; the task is ready to run.

1. Choose a sound and make four chords with a bass line and drums. For comparable material, use C–Am–F–G at 120 BPM in 4/4, or record another progression and use it in both builds.
2. Edit a note or drum step in a phrase, then change that phrase's track sound.
3. Balance the track while keeping its phrase and song position in view. Check that transport and editor remain reachable.
4. Finish your edits, allow local autosave to settle, and reopen the song to check that the phrase, tool and viewport return. Guest drafts save on this device; reload the same local preview to reopen them. Playback/listening and physical-device observations are recorded separately from automated checks.

Record real values; leave a field unknown if it was not observed. A help request counts whenever you need guidance to continue. Count preset/page switches as workspace changes, and record page scrolling separately from internal song/editor scrolling. Note mistaken track/phrase selection and any overwrite, even if Undo fixes it. Record sample-loading wait separately in each run so a cold download is distinguishable from time spent using the workspace.

| Observation | Reference layout | Revised workspace |
| --- | --- | --- |
| Start and finish time / elapsed time | — | — |
| Sample/asset loading wait | — | — |
| Help requests and what was unclear | — | — |
| Workspace changes | — | — |
| Page scrolls to reach an editor | — | — |
| Internal song/editor scrolling | — | — |
| Mistaken track or phrase selection | — | — |
| Lost song position or selection | — | — |
| Accidental overwrite / recovery used | — | — |
| Readable song context, reachable transport | — | — |
| Saved phrase/tool/viewport restored | — | — |

Reply with the table or a short account of both runs. Prototype approval alone is not observed workflow evidence. No times, help counts or usability improvements have been inferred or fabricated.

## Phase 0B follow-on: discovery and reusable library

**Not implemented in 0A.** Begin after workspace completion and approval, using the user's agreed scope rather than treating the roadmap's original Phase 2 timing as the current schedule.

- One searchable browser for existing sounds and ideas, with categories, favorites and recents. Reusable user-saved phrases and sound patches work across songs. Show destination and musical range alongside applicable Preview, Insert and Replace actions; retain keyboard actions and the alternative-track path for overlap.
- The library is device-local and owner-scoped, with downloadable backup and validated import. It includes MIDI/drum phrases and audio phrases. Audio supports **Insert only**; audio Replace remains excluded.
- Introduce versioned entries and archives in owner-scoped IndexedDB. Extend the existing audition scheduler with immutable candidate snapshots and a library asset resolver. Browsing and starring do not alter music history; only successful use updates recents. Keep project schema v1, cloud interfaces and the Windows wrapper unchanged.
- A full saved sound includes instrument identity, sound settings, modulation, movement, EQ, saturation and sends. Applying it preserves the destination track's volume, pan, mute and solo. Keep the existing legacy TrackPatch format compatible.
- MIDI/drum phrases retain source tick timing. Audio retains raw source bytes and source-domain seconds separately from visible arrangement ticks, source length, offset and tempo metadata. Inserting at another song tempo must use an explicit placement contract; it must not silently stretch, trim or reinterpret the raw file.
- Every insertion deep-clones mutable musical data and creates fresh project-global clip, note, manifest and asset identities. Preserve patch-local source/route links, controller/channel and macro identities, and seeds. Repeated insertion must not share mutable arrays, evaluators or held-input ownership between entries or projects.
- Copy a library-owned audio blob to a fresh project asset identity before adding a project reference. Prepare and validate the full proposed edit first. After every asynchronous asset load/copy, recheck **owner, project, destination and the relevant target revision immediately before commit**. A stale or cancelled action adds no phrase, recents entry or success notification. A stale-target regression test must cover edit/Undo ABA changes while allowing unrelated project edits.
- Library and project blob lifetimes are independent. Library deletion must not remove copied project blobs. Project deletion must not remove library originals. Project blobs stay protected by the present document, Undo/Redo, recoveries and pending operations. Current history retains up to 100 past documents; do not infer safe deletion from the present document alone or invent an untracked reference count. Retain the existing project cache policy unless all relevant roots can be proved absent.
- Failed/cancelled insertion cleanup may remove only operation-owned staged blobs that were never committed and have no other references or active operation. Once committed, Undo/recovery protections apply. Existing owner/project/version-aware server garbage collection remains unchanged; this library adds no cloud schema or general server-GC change.
- Reuse existing bounded project/asset validation and backup limits: 64 tracks, 1.8 MB project edit data, 100 MB per audio file and 512 MB uncompressed assets per backup. Decide and test atomic local metadata/blob writes and imported-library failure behavior before claiming portability.

The final user-approved contracts further require:

- MIDI/drum source timing stays at 960 PPQ; arrangement positions are integer song ticks. Audio offsets, fades, file duration and saved visible duration use seconds; derive the inserted tick length from destination tempo without stretching original bytes.
- Compare bindings only for controller events carried by a phrase and their reachable dependencies. Include intentionally unmapped controls as explicit empty mappings, channel/omni CC routing and transitive routes. Do not compare unused controllers; note-only phrases remain reusable across compatible instruments.
- Preserve destination clips, automation, track identity, base volume/pan, mute/solo and master settings during sound replacement. Keep unsupported automation data and exact inactive-target reasons consistently in UI, playback, audition and export. Mapping conflicts offer keeping current modulation or inserting the complete sound on a new track; never silently rebind.
- An insertion captures owner, project/document epoch, explicit destination, placement target and a monotonic revision for target content/dependencies. After asset work and immediately before commit, recheck operation activity, scope, destination, target revision, drafts, compatibility, overlap and limits. Assemble from the latest committed document and perform one checked commit without an intervening await. Edit then Undo invalidates the operation; unrelated edits survive. Stale, failed and cancelled work changes no selection, recents or success status.
- Stage destination-owned asset copies atomically and exclude them from upload until commit succeeds. Library deletion waits for active jobs and removes only library blobs. Committed destination copies survive source deletion, Undo/Redo and recovery. Failed jobs clean only their unused operation-owned copies. Add no general project-audio garbage collector in 0B. Validate bounded manifests and exact blobs before atomic import as fresh copies, preserving project backups and legacy patch formats.

## Later roadmap work

After 0A and 0B, keep precise note editing, note-edge resizing, multi-note/group operations, velocity/scale tools, direct automation and task help as distinct later increments. Real-device recording readiness, take comparison, export scope and listening validation follow the existing recording/export workflow. Warping, comping, bounce, launchers, deeper routing, MPE/tuning and new effects require their own task evidence, timing/ownership contracts and any explicit migration work.

The roadmap's manual links and feature inventory provide design context. They are not instructions to add every feature, reproduce another product or publish this prototype. Deploy only after the verified source and release decision are separately authorized and recorded through the existing workflow.
