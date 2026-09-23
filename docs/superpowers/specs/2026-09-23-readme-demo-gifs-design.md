# README Demo GIFs Design

**Date:** 2026-09-23  
**Status:** Approved design; implementation pending plan review

## Goal

Create deterministic, repeatable README demonstrations from the real MathVisualization UI. The recording pipeline produces source WebM files and optimized GIFs for capabilities that exist today, while refusing to generate an asset for a planned capability.

## Capability gate

The three route definitions are the source of truth for what may be recorded:

| Route         | Current real capability                                                                                               | Asset decision                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/complex`    | Complex plane, zeros/poles, contour integral, accumulated trajectory, numerical result and guarded residue comparison | Record `complex-demo.webm` and `complex-demo.gif`                                                              |
| `/transforms` | Time-domain Cartesian graph only; Fourier/frequency-domain views are planned                                          | Keep a scenario manifest entry marked `planned`; do not create `transforms-demo.webm` or `transforms-demo.gif` |
| `/calculus`   | `R² → R` Cartesian 3D surface, orbit, hover readout and parameter slider                                              | Record `calculus-demo.webm` and `calculus-demo.gif`                                                            |

The transforms scenario must fail closed with a human-readable skip reason. It must never insert a fake transform expression, hardcode a spectrum, or create an empty/placeholder media file. The README may describe the missing capability, but it may only embed assets that exist and were recorded through the real UI.

## Recording architecture

The repository will contain a small standalone recording harness under `scripts/demo/`:

```text
scripts/demo/
├── record.mjs
├── gif.mjs
├── config.mjs
├── scenarios/
│   ├── complex.mjs
│   ├── transforms.mjs
│   └── calculus.mjs
└── helpers/
    ├── app.mjs
    ├── mathInput.mjs
    ├── mouse.mjs
    ├── timing.mjs
    └── media.mjs
```

`record.mjs` owns the browser lifecycle and scenario dispatch. Each scenario exports a shared shape:

```js
{
  name: 'complex',
  route: '/complex',
  status: 'ready' | 'planned',
  skipReason?: string,
  async run({ page, pause, typeMath, moveHumanLike }) {}
}
```

`config.mjs` resolves the MathVisualization root, the app URL, the sibling Playwright repository and all output paths. The external repository is selected by `MATHVIZ_PLAYWRIGHT_REPO`; its default is the sibling `demo_ArtFlow` directory. `record.mjs` uses Node `createRequire` against that repository's `package.json` to load its installed Playwright package. No Playwright package, browser binary, lockfile entry or ArtFlow source is added to MathVisualization.

The recorder starts the local Vite app when no `MATHVIZ_DEMO_BASE_URL` is supplied, waits for the actual `.workspace`, MathLive fields and fonts, and terminates the child process in a `finally` block. A fresh browser context is created for every scenario with:

```text
viewport: 1440 × 900
deviceScaleFactor: 1
locale: en-US
recordVideo: source/<name>-demo.webm
storageState: empty
```

The scenario begins only after the application is ready. It uses accessible application selectors and real MathLive keyboard/keypad interaction. It does not add recording-only controls or inject mock application state.

## Interaction rules

Shared helpers provide the same timing language for both demos:

- Text is entered through a focused `math-field` with deterministic per-character delay.
- Enter creates the next real expression row.
- Keypad buttons are selected by their accessible names; the complex contour template is inserted through the real `∮` keypad key.
- Pointer movement uses deterministic multi-step paths with no random jitter.
- `pause()` is used after render state and key results, with a final 1 second hold.
- No DevTools, trace overlay, mouse cursor decoration, debug panel or artificial presentation layer is recorded.

The complex scenario replaces the clean route's first expressions with `f(z)=1/(z^2+1)`, waits for the two pole markers, moves to a pole for the readout, adds `gamma(t)=2e^(it)`, inserts the contour integral from the complex keypad, and waits for the contour, accumulated trajectory, numeric result and guarded residue comparison. The scenario checks the displayed theorem text: if the result is inconclusive or warning-bearing, it does not claim a theorem verdict in the recording and retains only the contour/integral portion.

The calculus scenario replaces the first expression with `f(x,y)=x^2-a*y^2`, adds `a=1` through the real expression flow, waits for the `3D surface` frame, performs a deterministic orbit drag, hovers a surface point for the coordinate/value readout, and drags the real parameter slider. It does not show contours or gradients because those capabilities are still planned.

## Media pipeline

`gif.mjs` converts each source WebM in two FFmpeg passes:

```text
fps=15,scale=1200:-1:flags=lanczos,palettegen=max_colors=256
fps=15,scale=1200:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a
```

The temporary palette is created outside `docs/assets`, removed in a `finally` block, and the final GIF is written to `docs/assets/<name>-demo.gif`. `ffprobe` validates width, frame rate, duration and non-empty output. If a GIF exceeds 10 MB, the pipeline retries at 12 fps and then 1100 px before failing with the measured size; it never silently produces a lower-quality or fake asset.

Tracked output layout:

```text
docs/assets/
├── complex-demo.gif
├── calculus-demo.gif
└── source/
    ├── complex-demo.webm
    └── calculus-demo.webm
```

No transforms asset appears until the Fourier/frequency-domain vertical slice is implemented and promoted from `planned` to `implemented` in the subsystem definition.

## Commands

The root package exposes:

```text
pnpm demo:check       # verify external Playwright and ffmpeg prerequisites
pnpm demo:complex     # rehearse, record WebM, convert and validate one demo
pnpm demo:calculus    # rehearse, record WebM, convert and validate one demo
pnpm demo:transforms  # report planned status and produce no media
pnpm demo             # run every scenario; skip planned scenarios explicitly
```

The default app target is local Vite at `http://127.0.0.1:5173`. `MATHVIZ_DEMO_BASE_URL` allows an already-running local build to be used, but the host must be loopback. `MATHVIZ_PLAYWRIGHT_REPO` allows the external Playwright checkout to be relocated without modifying the repository.

## README integration

The README will add separate Complex Analysis and Multivariable Calculus sections with centered GIFs and concise capability descriptions. The Integral Transforms section will state that the time-domain surface exists but the transform-domain vertical slice is planned; it will not reference a nonexistent GIF.

## Verification

The harness will be verified at three levels:

1. Static contract checks validate scenario names, route paths, capability statuses, output naming and the absence of transforms media.
2. Rehearsal runs execute the same scenario actions without recording, asserting real DOM/canvas states such as pole markers, contour result text, 3D surface frame and parameter slider.
3. Recorded artifacts are inspected with `ffprobe`; final GIFs are checked for dimensions, duration, frame rate, file size and expected output paths.

The existing application `pnpm verify` remains the gate for source changes. No media is called complete until the scenario and artifact checks pass on a clean context.
