# Chordz

Windows desktop music studio for songwriting, arranging, recording and mixing.

The desktop app opens the live [Chordz Studio](https://www.chordz.zerolitter.net) in a dedicated WebView2 window. It provides piano, chord editing, orchestral instruments, synthesizers, multitrack arrangement, microphone recording, private cloud projects and WAV/MP3/MIDI exports.

**Version 0.1.0 is an online desktop client. Internet access is required.** The complete studio source is included in `studio/` for development; it is not bundled as an offline server.

## Download and use

Windows builds are available on the [Releases page](https://github.com/Zerolitter/Chordz/releases). Choose the setup executable to install for your Windows account, or the portable executable to run without installing. Microsoft Edge WebView2 is required; the installer offers its standard bootstrapper when missing. This first release is unsigned.

Open the app and begin with the demo song or a blank song. See [the studio guide](studio/README.md) for musical controls and keyboard shortcuts. Microphone permission is requested when recording begins. MIDI and folder access depend on WebView2 support; onscreen and computer-keyboard input remain available.

The Studio menu provides **Return to studio**, **Open in browser**, and **Quit Chordz**. External HTTPS links open in the normal browser. Desktop and browser sessions are separate. If an identity provider refuses embedded sign-in, use the browser studio for that session; signing in there does not sign in the desktop app. Hosted sign-in, physical microphone/MIDI operation and listening checks remain to be validated in the desktop runtime.

## Build the Windows app

Prerequisites: Node.js 20+, Rust with the MSVC toolchain, Microsoft C++ Build Tools and WebView2. [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/) describe these toolchains.

```powershell
npm ci
npm test
npm run format:check
npm run build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`. A portable build uses `npm run build:portable` and writes `src-tauri/target/release/chordz.exe`. Development uses `npm run tauri:dev`.

The hosted studio receives no native command permissions. Navigation stays within the studio and its sign-in providers; other HTTPS links open externally. No screen-capture code is part of the music app.

## Studio source

`studio/` contains Chordz Studio, continued from source snapshot a682ed6 and reconciled with the existing published Site before the UI upgrade. The charcoal/cream/amber interface includes device-local Appearance settings, a collapsible performance dock, draggable arrangement clips, interactive automation and stereo MP3 export. The audio engine, private project APIs, version 1 document format and Windows wrapper remain compatible. It retains the existing Site identity; publication uses the matching Studio source.

```powershell
cd studio
npm run install:ci
npm run typecheck
npm test
npm run lint
npm run build
```

See [studio/README.md](studio/README.md) for local storage migrations, browser tests, architecture and asset licensing. Factory samples are CC0; licenses and provenance are included. Third-party source retains its existing notices. No new project license is assigned.

## Repository layout

- `src-tauri/`: native client, navigation policy, app icons and installer configuration.
- `studio/`: complete music studio source and tests.
- `.github/workflows/build.yml`: desktop and studio checks, with a Windows build artifact.
- `docs/`: release validation and current limitations.
