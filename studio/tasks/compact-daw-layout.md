# Compact DAW layout follow-up

User annotations, 2026-10-01: Appearance is too generic; numeric fields are oversized and should wrap their numbers on lighter gray; modulation and movement are scattered and waste space; the instrument envelope needs a clearer graphic; remove the default footer slogan.

Continue from `0495ad64353fcc67e646cf6925faad7ff25eb98a`. Before editing, Sites version 7 source `b914b3f9ab6b8464fadc23e270c4b7e5a10aa90a` was opened and reconciled: all 436 Studio source blobs matched the target folder. Preserve the music engine, gestures, recording safeguards, schema v1, cloud endpoints, authentication, private assets and Windows wrapper.

- Use compact utility settings, named accent swatches and direct rail/spacing controls.
- Fit exact numeric fields to the current value/draft, with inline units and lighter gray. Keep 44px touch targets around small visible controls, accessible names, reset, precision input and transaction ownership.
- Place instrument devices before the rack; group macros into one bank and source cards beside a compact, scrollable matrix. Expand base route details and sample mapping when needed.
- Group movement into Pattern, Timing and Voicing; retain generation/live/hold controls and seeded variation.
- Render graphs at their actual pixel width with uniform SVG coordinates, crisp curves, axes and circular nodes. Keep complete 44px graph targets inside their graph and preserve exact drag/cancel/Undo behavior.
- Bound the mixer to its channels, with an attached master and compact EQ bank. Use concise visible labels while keeping track-qualified accessible names.
- Remove only the default footer text and empty strip; retain actionable status and error messages.

Verify responsive empty/populated layouts, exact editing and Undo, nested staging, graph coordinates, focus restoration and touch targets. Run the existing unit/browser/type/lint/build checks and publish matching verified source through the same Site. Physical touch, devices, listening and native-window checks remain separate from headless evidence.
