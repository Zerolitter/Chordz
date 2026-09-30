# Interface and audio dependencies

Chordz knob controls contain an attributed local React 19 compatibility adapter
of **react-knob-headless 0.4.0**, copyright (c) 2023 @satelllte, MIT licensed.
The adapter removes the obsolete React 18 peer restriction and redundant
`forwardRef.defaultProps` assignment, replaces the small math/prop-merging
dependencies with local helpers, and adds cancellable gesture boundaries,
fine adjustment and disabled behavior. The knob wrapper adds Studio undo
savepoints, numeric entry, keyboard access, reset and modulation routing.

Original source: <https://github.com/satelllte/react-knob-headless/tree/b4ac2bf206ce7d9b2f2924ddb26d6a56b542e883>.
The full MIT license is shipped at `public/licenses/react-knob-headless-MIT.txt`.
The adapter uses **@use-gesture/react 10.3.1** and its **@use-gesture/core 10.3.1**
dependency, copyright (c) 2018-present Paul Henschel, MIT licensed.
Their full license is shipped at `public/licenses/use-gesture-MIT.txt`.
Source: <https://github.com/pmndrs/use-gesture>.

## MP3 export

Chordz uses `wasm-media-encoders` **0.7.0** to encode stereo 48 kHz mixes as
320 kbps constant-bitrate MP3 files on the user's device. The encoder is bundled
locally as `public/audio/mp3.worker.js` and `public/audio/mp3.wasm`; export does
not load code from a CDN.

The JavaScript wrapper is MIT licensed. Its complete license is shipped locally
at `public/audio/licenses/wasm-media-encoders-MIT.txt`.

The included LAME encoder is licensed under the GNU Library General Public
License. LAME is acknowledged here and at <https://lame.sourceforge.io/>.
Its complete license is shipped locally at `public/audio/licenses/LAME-LGPL.txt`.
The corresponding source used by this package is available at:

- [LAME COPYING](https://github.com/arseneyr/lame/blob/98db548e8e851defbba3184125ce10725355c332/COPYING)
- [LAME source](https://github.com/arseneyr/lame/tree/98db548e8e851defbba3184125ce10725355c332)
- [Wrapper source and build instructions](https://github.com/arseneyr/wasm-media-encoders/tree/4a45333baadbab312d1cc0911151dfad23157c51)
- [Encoder build recipe](https://github.com/arseneyr/wasm-media-encoders/blob/4a45333baadbab312d1cc0911151dfad23157c51/Makefile)

The upstream build disables LAME's decoder. Chordz does not modify LAME.
To rebuild the supplied encoder, check out the wrapper source above with its
submodules and follow its Emscripten build instructions. Replace the package's
MP3 WASM with the rebuilt encoder, then run `node scripts/build-audio-workers.mjs`
to recreate the browser worker and copy its WASM asset. The website and desktop
client serve the same worker. `public/audio/mp3.wasm` is a separate asset that
can also be replaced with a compatible rebuild without changing application code.

Chordz reference analysis uses **fft.js 4.0.4**, Fedor Indutny's MIT-licensed
Fourier transform implementation. It is bundled into the local reference worker;
analysis does not load code or upload audio to another service. The package's
complete README, including its copyright and MIT license, is shipped at
`public/audio/licenses/fft.js-NOTICE.txt`.
Source: <https://github.com/indutny/fft.js>.
