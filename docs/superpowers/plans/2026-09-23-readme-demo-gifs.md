# README Demo GIFs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable real-UI recording pipeline that produces validated Complex Analysis and Multivariable Calculus README GIFs, while explicitly skipping the planned Integral Transforms asset.

**Architecture:** A dependency-free `.mjs` harness runs from MathVisualization but resolves Playwright from the sibling `demo_ArtFlow` checkout through `createRequire`. Shared helpers own app startup, clean browser contexts, MathLive typing, deterministic pointer motion, timing, FFmpeg conversion and `ffprobe` validation. Scenario modules only describe user-visible actions and declare whether their capability is ready or planned.

**Tech Stack:** Node 20+ ESM, external `@playwright/test`/Playwright 1.63.0 from `demo_ArtFlow`, Vite dev server, MathLive DOM elements, FFmpeg 8+, ffprobe, Node `node:test`, PowerShell-compatible process cleanup.

**Spec:** `docs/superpowers/specs/2026-09-23-readme-demo-gifs-design.md`

## Global Constraints

- Use the real MathVisualization UI, real MathLive keyboard/keypad input, Playwright browser recording and FFmpeg conversion; never inject mock data or recording-only controls.
- Do not add Playwright, browser binaries, ArtFlow source, or a second lockfile to MathVisualization; load the installed external package through `MATHVIZ_PLAYWRIGHT_REPO`.
- Use a fresh browser context, `1440 × 900`, device scale factor `1`, deterministic multi-step pointer motion, and no DevTools/trace/presentation overlay.
- Generate only `/complex` and `/calculus` media while their capabilities are implemented. `/transforms` remains a visible planned skip and produces no WebM or GIF.
- Keep source recordings in `docs/assets/source/<name>-demo.webm` and GIFs in `docs/assets/<name>-demo.gif`; do not commit temporary palettes.
- A final GIF must be approximately `12–18 s`, `1200 px` wide before fallback reduction, `12–15 fps`, and below `10 MB`; the preferred target is below `8 MB`.
- `pnpm verify` remains required for source changes, and every recording command must fail closed when a required external tool or capability is absent.

### Task 1: Scenario manifest and prerequisite contract

**Files:**

- Create: `scripts/demo/config.mjs`
- Create: `scripts/demo/scenarioManifest.mjs`
- Create: `scripts/demo/scenarios/complex.mjs`
- Create: `scripts/demo/scenarios/transforms.mjs`
- Create: `scripts/demo/scenarios/calculus.mjs`
- Create: `scripts/demo/contract.test.mjs`
- Modify: `package.json: scripts`

**Interfaces:**

- `scenarioManifest.mjs` exports `DEMO_NAMES`, `DEMO_MANIFEST`, and `manifestFor(name)`, with route/status data independent of executable scenario functions.
- `config.mjs` exports `VIDEO_SIZE`, `SOURCE_DIR`, `ASSET_DIR`, `resolvePlaywrightRepo()`, `loadPlaywright()`, `scenarioSourcePath(name)`, and `scenarioGifPath(name)`.
- Every scenario exports a default object with `{ name, route, status, skipReason?, run }`, where `status` is exactly `'ready'` or `'planned'`.
- `transforms.mjs` exports `{ name: 'transforms', route: '/transforms', status: 'planned', skipReason: 'Fourier transform and frequency-domain view are planned.' }` and a `run` function that throws the same explicit skip error if called directly.
- `contract.test.mjs` is executable with `node --test` and does not import Playwright.

- [ ] **Step 1: Write the failing contract test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioGifPath, scenarioSourcePath } from './config.mjs';
import { DEMO_NAMES } from './scenarioManifest.mjs';
import complex from './scenarios/complex.mjs';
import transforms from './scenarios/transforms.mjs';
import calculus from './scenarios/calculus.mjs';

const scenarios = { complex, transforms, calculus };

test('the demo manifest covers the three public routes', () => {
  assert.deepEqual(DEMO_NAMES, ['complex', 'transforms', 'calculus']);
  assert.deepEqual(
    Object.values(scenarios).map((scenario) => scenario.route),
    ['/complex', '/transforms', '/calculus'],
  );
});

test('only implemented vertical slices are recordable', () => {
  assert.equal(complex.status, 'ready');
  assert.equal(calculus.status, 'ready');
  assert.equal(transforms.status, 'planned');
  assert.match(transforms.skipReason, /planned/i);
});

test('planned transforms have no media output contract', () => {
  assert.match(scenarioSourcePath('complex'), /complex-demo\.webm$/);
  assert.match(scenarioGifPath('calculus'), /calculus-demo\.gif$/);
  assert.throws(() => scenarioSourcePath('transforms'), /planned/i);
  assert.throws(() => scenarioGifPath('transforms'), /planned/i);
});
```

- [ ] **Step 2: Run the contract test and verify it fails for missing harness modules**

Run: `node --test scripts/demo/contract.test.mjs`  
Expected: FAIL because `scripts/demo/config.mjs` and the scenario modules do not exist yet.

- [ ] **Step 3: Implement the manifest and path gate**

Use this behavior in `config.mjs`:

```js
export const DEMO_NAMES = ['complex', 'transforms', 'calculus'];
export const VIDEO_SIZE = { width: 1440, height: 900 };
export const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';
export const ASSET_DIR = path.join(ROOT_DIR, 'docs', 'assets');
export const SOURCE_DIR = path.join(ASSET_DIR, 'source');

export function scenarioSourcePath(name) {
  assertRecordable(name);
  return path.join(SOURCE_DIR, `${name}-demo.webm`);
}

export function scenarioGifPath(name) {
  assertRecordable(name);
  return path.join(ASSET_DIR, `${name}-demo.gif`);
}
```

`assertRecordable` must import `manifestFor` and throw `Scenario "transforms" is planned; no media will be created.` for a planned scenario. Keep `scenarioManifest.mjs` independent from executable scenarios so `config.mjs` does not form a circular import with scenario actions. Resolve `MATHVIZ_PLAYWRIGHT_REPO` from the environment, otherwise use `path.resolve(ROOT_DIR, '..', 'demo_ArtFlow')`. `loadPlaywright()` must use `createRequire(path.join(repo, 'package.json'))` and require `playwright`, so the host repo remains dependency-free.

- [ ] **Step 4: Add root commands without adding dependencies**

Add these scripts to `package.json`:

```json
{
  "demo:check": "node scripts/demo/record.mjs --check",
  "demo:rehearse": "node scripts/demo/record.mjs --rehearse all",
  "demo:complex": "node scripts/demo/record.mjs complex",
  "demo:calculus": "node scripts/demo/record.mjs calculus",
  "demo:transforms": "node scripts/demo/record.mjs transforms",
  "demo": "node scripts/demo/record.mjs all"
}
```

- [ ] **Step 5: Run the contract and package script checks**

Run: `node --test scripts/demo/contract.test.mjs`  
Expected: PASS with three manifest tests.  
Run: `pnpm demo:transforms`  
Expected: a clear planned-capability message and no files under `docs/assets`.

- [ ] **Step 6: Commit the manifest contract**

```powershell
git add package.json scripts/demo/config.mjs scripts/demo/scenarioManifest.mjs scripts/demo/scenarios scripts/demo/contract.test.mjs
git commit -m "chore: add honest demo scenario manifest"
```

### Task 2: External Playwright runtime and deterministic browser helpers

**Files:**

- Create: `scripts/demo/helpers/app.mjs`
- Create: `scripts/demo/helpers/mathInput.mjs`
- Create: `scripts/demo/helpers/mouse.mjs`
- Create: `scripts/demo/helpers/timing.mjs`
- Create: `scripts/demo/runtime.test.mjs`
- Modify: `scripts/demo/config.mjs`

**Interfaces:**

- `startAppServer({ baseUrl })` returns `{ baseUrl, close }`; it spawns the repository's `pnpm dev` only when `MATHVIZ_DEMO_BASE_URL` is absent and always cleans the child process in `close`.
- `waitForAppReady(page)` waits for `.workspace`, at least one `math-field`, and `document.fonts.ready` without a fixed startup sleep.
- `newDemoContext(browser, { recordVideo, scenario })` creates the fixed-size clean context and returns `{ context, page }`.
- `replaceMathField(page, index, value, options)` focuses `math-field:nth(index)`, uses Control+A and `pressSequentially` with deterministic delay, then waits for the field value to change.
- `pressEnter(page, index)` sends Enter to the real MathLive field and waits for the next field count.
- `moveHumanLike(page, from, to, { steps, durationMs })` uses deterministic linear interpolation and a per-step delay; it does not call random jitter.
- `pause(page, milliseconds)` is the only scenario timing primitive.

- [ ] **Step 1: Write runtime contract tests**

Test only pure behavior that does not require a browser:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanPoints } from './helpers/mouse.mjs';
import { typeDelays } from './helpers/timing.mjs';

test('human pointer path is deterministic and includes both endpoints', () => {
  assert.deepEqual(humanPoints({ x: 0, y: 10 }, { x: 100, y: 50 }, 4), [
    { x: 0, y: 10 },
    { x: 25, y: 20 },
    { x: 50, y: 30 },
    { x: 75, y: 40 },
    { x: 100, y: 50 },
  ]);
});

test('typing delays are stable and bounded', () => {
  assert.deepEqual(typeDelays('abc', { min: 55, max: 95 }), [55, 75, 95]);
});
```

- [ ] **Step 2: Run the pure helper tests and verify they fail**

Run: `node --test scripts/demo/runtime.test.mjs`  
Expected: FAIL because the helper modules do not exist.

- [ ] **Step 3: Implement fixed runtime configuration and app startup**

`app.mjs` must validate that a supplied `MATHVIZ_DEMO_BASE_URL` is loopback HTTP(S), use `fetch` against `/complex` for readiness, and otherwise spawn `pnpm.cmd dev` on Windows or `pnpm dev` on other platforms with the repository root as `cwd`. Poll at 100 ms intervals for at most 30 seconds, then include the child stderr tail in the failure. On cleanup, send SIGTERM; on Windows, use `taskkill /pid <pid> /t /f` only for the child process created by this harness.

`newDemoContext` must set `viewport`, `screen`, `locale: 'en-US'`, `deviceScaleFactor: 1`, and `recordVideo` only in record mode. It must not provide `storageState`, so the app's persistence starts empty.

- [ ] **Step 4: Implement real MathLive and pointer helpers**

The MathLive helper must use only `locator.click`, `locator.press('Control+A')`, `locator.pressSequentially(value, { delay })`, and real keypad button clicks. It may inspect `math-field.value` for readiness, but may not assign `element.value` or call a private editor API. `moveHumanLike` must emit exactly the same points for the same arguments.

- [ ] **Step 5: Run the pure helper tests and static type/syntax checks**

Run: `node --test scripts/demo/runtime.test.mjs scripts/demo/contract.test.mjs`  
Expected: PASS.  
Run: `pnpm lint`  
Expected: PASS with no new lint errors.

- [ ] **Step 6: Commit the runtime helpers**

```powershell
git add scripts/demo/config.mjs scripts/demo/helpers scripts/demo/runtime.test.mjs
git commit -m "feat: add deterministic browser recording helpers"
```

### Task 3: Implement the real Complex and Calculus scenarios

**Files:**

- Modify: `scripts/demo/scenarios/complex.mjs`
- Modify: `scripts/demo/scenarios/calculus.mjs`
- Modify: `scripts/demo/scenarios/transforms.mjs`
- Create: `scripts/demo/scenarios.test.mjs`

**Interfaces:**

- Scenario `run({ page, pause, replaceMathField, pressEnter, moveHumanLike })` performs only visible application actions and throws when a required real UI state cannot be reached.
- `scenarios.test.mjs` validates scenario declarations and contains no mock application implementation.

- [ ] **Step 1: Write scenario contract tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import complex from './scenarios/complex.mjs';
import transforms from './scenarios/transforms.mjs';
import calculus from './scenarios/calculus.mjs';

test('complex scenario declares the actual contour workflow', () => {
  assert.equal(complex.route, '/complex');
  assert.equal(complex.status, 'ready');
  assert.match(complex.description, /poles|contour|accumulated/i);
});

test('calculus scenario declares the actual surface workflow', () => {
  assert.equal(calculus.route, '/calculus');
  assert.equal(calculus.status, 'ready');
  assert.match(calculus.description, /surface|slider|hover/i);
});

test('transforms scenario cannot be accidentally recorded', () => {
  assert.equal(transforms.status, 'planned');
  assert.equal(typeof transforms.run, 'function');
  assert.throws(() => transforms.run({}), /Fourier|planned/i);
});
```

- [ ] **Step 2: Run the scenario tests and verify the ready scenario metadata is missing**

Run: `node --test scripts/demo/scenarios.test.mjs`  
Expected: FAIL because the scenario descriptions and real run functions are not implemented.

- [ ] **Step 3: Implement the Complex scenario with real UI actions**

Use this deterministic sequence:

```text
open /complex and wait for .workspace + 2 math-fields
replace field 0 with f(z)=1/(z^2+1)
clear field 1 through its real MathLive selection/delete flow
wait for the Complex plane canvas and two pole markers in the app's analysis state
move to the screen point for z=i using the default viewport and canvas bounds
pause 1000 ms while the readout shows the pole coordinate/order
press Enter on field 0
replace the new field with gamma(t)=2e^(it)
press Enter on the path field
open the real mathematics keypad
click the button named "A contour integral around a path"
fill its three MathLive placeholders by keyboard navigation with gamma, f(z), z
wait for the value line to expose the contour interval, numeric result and trajectory
if the residue comparison says inconclusive or warning, keep the contour/result frames but do not assert or caption a theorem verdict
pause 1200 ms
```

The scenario must assert visible states using existing selectors: `section[aria-label="Complex plane view"]`, `canvas[role="img"]`, `.legend__range` containing `○ 2 poles`, `button[aria-label="Show the mathematical keypad"]`, `button[aria-label="A contour integral around a path"]`, `math-field`, and the value line text. It must derive the pole hover coordinate from the fixed default viewport and the canvas bounding box, not from a screenshot pixel chosen after recording. The pole-marker appearance itself is a canvas visual; the legend and snapped readout are the deterministic DOM evidence that the canvas is showing the classified points.

- [ ] **Step 4: Implement the Calculus scenario with real UI actions**

Use this deterministic sequence:

```text
open /calculus and wait for .workspace + 2 math-fields
replace field 0 with f(x,y)=x^2-a*y^2
press Enter and replace the new field with a=1
wait for section[aria-label="3D surface view"] and the parameter slider
drag the canvas from a fixed point by 80 px horizontally and 30 px vertically with 24 steps
move to a fixed surface interior point and pause 1000 ms for (x,y,z)/f(x,y) readout
drag the slider from its current value to a=1.8 with 20 steps
pause 1200 ms for the live surface deformation
```

The scenario must assert that the 3D surface view is present and that the slider is an actual `input[type="range"]` beneath the expression row. It must not click planned contour/gradient controls or mention them in the recording.

- [ ] **Step 5: Implement the explicit Transforms planned scenario**

The scenario's `run` must throw before opening a recording context. `record.mjs` catches this planned result, prints `SKIP transforms: Fourier transform and frequency-domain view are planned.`, exits zero for `pnpm demo:transforms`, and never calls `scenarioSourcePath` or `scenarioGifPath` for it.

- [ ] **Step 6: Run scenario metadata tests**

Run: `node --test scripts/demo/contract.test.mjs scripts/demo/scenarios.test.mjs`  
Expected: PASS.  
Run: `pnpm typecheck`  
Expected: PASS; the `.mjs` harness is outside the TypeScript project but application types remain unchanged.

- [ ] **Step 7: Commit the scenario definitions**

```powershell
git add scripts/demo/scenarios scripts/demo/scenarios.test.mjs
git commit -m "feat: script real complex and calculus demo flows"
```

### Task 4: Record WebM artifacts and enforce clean lifecycle

**Files:**

- Create: `scripts/demo/record.mjs`
- Create: `scripts/demo/record.test.mjs`
- Modify: `scripts/demo/helpers/app.mjs`
- Modify: `scripts/demo/config.mjs`

**Interfaces:**

- `runScenario(name, { mode })` returns `{ status: 'recorded' | 'rehearsed' | 'skipped', sourcePath?: string }`.
- `record.mjs --check` checks external Playwright, Chromium launchability, ffmpeg and ffprobe without creating media.
- `record.mjs --rehearse <name|all>` runs the same actions with `recordVideo` disabled.
- `record.mjs <name|all>` records WebM, closes the context before renaming the Playwright temporary video, and then invokes the GIF converter.

- [ ] **Step 1: Write CLI contract tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDemoArgs } from './record.mjs';

test('CLI accepts one scenario or all', () => {
  assert.deepEqual(parseDemoArgs(['complex']), { mode: 'record', names: ['complex'] });
  assert.deepEqual(parseDemoArgs(['--rehearse', 'all']), {
    mode: 'rehearse',
    names: ['complex', 'transforms', 'calculus'],
  });
  assert.deepEqual(parseDemoArgs(['--check']), { mode: 'check', names: [] });
});
```

- [ ] **Step 2: Run the CLI test and verify the entrypoint is missing**

Run: `node --test scripts/demo/record.test.mjs`  
Expected: FAIL because `record.mjs` does not exist.

- [ ] **Step 3: Implement check, rehearse and record modes**

`record.mjs` must launch one Chromium instance per command, create one clean context per ready scenario, call `waitForAppReady`, run the scenario, close the context in a `finally` block, and kill the Vite child process in another `finally` block. When `page.video().path()` resolves, rename it to the exact source path only after `context.close()` completes. Rehearsal mode uses the same page actions and assertions but does not create `docs/assets/source` files. Export `parseDemoArgs` without starting a browser when imported by tests; guard CLI execution with an ESM main-module check. The record-mode conversion call may use a dynamic import of `gif.mjs`, so `--check` and `--rehearse` remain testable before Task 5 wires the converter.

The `all` command runs scenarios in manifest order, reports transforms as skipped, and returns nonzero only for a failed ready scenario or failed prerequisite. It must not turn a planned skip into a success message claiming three recordings.

- [ ] **Step 4: Run prerequisite and rehearsal checks**

Run: `pnpm demo:check`  
Expected: PASS using `C:\Users\16275\Desktop\demo_ArtFlow\node_modules` and local FFmpeg.  
Run: `pnpm demo:rehearse complex`  
Expected: PASS with no WebM/GIF output.  
Run: `pnpm demo:rehearse calculus`  
Expected: PASS with no WebM/GIF output.  
Run: `pnpm demo:transforms`  
Expected: explicit planned skip and no media files.

- [ ] **Step 5: Commit the recorder**

```powershell
git add scripts/demo/record.mjs scripts/demo/record.test.mjs scripts/demo/helpers/app.mjs scripts/demo/config.mjs
git commit -m "feat: add repeatable Playwright demo recorder"
```

### Task 5: Convert and validate WebM to optimized GIF

**Files:**

- Create: `scripts/demo/gif.mjs`
- Create: `scripts/demo/media.test.mjs`
- Create: `scripts/demo/helpers/media.mjs`
- Modify: `scripts/demo/record.mjs`

**Interfaces:**

- `convertWebmToGif(sourcePath, gifPath, options)` runs palette generation and paletteuse, retries at `(fps,width) = (15,1200), (12,1200), (12,1100)`, and returns `{ fps, width, bytes, duration }`.
- `probeMedia(path)` returns `{ width, height, fps, duration, bytes }` from `ffprobe`.
- `validateGif(path, { minDuration, maxDuration, maxBytes })` throws a measured error when a contract is violated.

- [ ] **Step 1: Write pure media command tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gifFilter, gifAttemptPlan } from './helpers/media.mjs';

test('GIF filter uses palette generation and paletteuse', () => {
  assert.match(gifFilter({ fps: 15, width: 1200 }), /palettegen/);
  assert.match(gifFilter({ fps: 15, width: 1200 }), /paletteuse/);
});

test('GIF attempts reduce frame rate before width', () => {
  assert.deepEqual(gifAttemptPlan(), [
    { fps: 15, width: 1200 },
    { fps: 12, width: 1200 },
    { fps: 12, width: 1100 },
  ]);
});
```

- [ ] **Step 2: Run media tests and verify they fail**

Run: `node --test scripts/demo/media.test.mjs`  
Expected: FAIL because the media helper does not exist.

- [ ] **Step 3: Implement FFmpeg palette conversion**

Use separate spawned commands, equivalent to:

```text
ffmpeg -y -i <source.webm> -vf "fps=<fps>,scale=<width>:-1:flags=lanczos,palettegen=max_colors=256" <temp-palette.png>
ffmpeg -y -i <source.webm> -i <temp-palette.png> -lavfi "fps=<fps>,scale=<width>:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a" <output.gif>
```

Use an OS temporary directory for the palette. Always remove it in `finally`. Use `-loop 0` for the final GIF and never overwrite a planned transforms path.

- [ ] **Step 4: Implement ffprobe validation**

Probe the GIF after each attempt, reject duration outside `12–18 s`, width below `1100 px` unless the measured fallback is explicitly reported, frame rate outside `12–15 fps`, zero bytes, or size above `10 MB`. Keep the source WebM even if GIF conversion fails so the failure is inspectable.

- [ ] **Step 5: Run media unit checks and command help checks**

Run: `node --test scripts/demo/media.test.mjs scripts/demo/record.test.mjs`  
Expected: PASS.  
Run: `pnpm demo:check`  
Expected: PASS with executable paths printed but no output media.

- [ ] **Step 6: Commit the media pipeline**

```powershell
git add scripts/demo/gif.mjs scripts/demo/helpers/media.mjs scripts/demo/media.test.mjs scripts/demo/record.mjs
git commit -m "feat: convert demo recordings to validated GIFs"
```

### Task 6: Update README and record the real assets

**Files:**

- Modify: `README.md`
- Create: `docs/assets/complex-demo.gif`
- Create: `docs/assets/calculus-demo.gif`
- Create: `docs/assets/source/complex-demo.webm`
- Create: `docs/assets/source/calculus-demo.webm`

**Interfaces:**

- README embeds only the two generated GIFs with centered `<p>` wrappers, descriptive alt text and no transforms image link.
- The transforms section explicitly says that the time-domain view exists and Fourier/frequency-domain support is planned; it does not imply that a hidden GIF exists.

- [ ] **Step 1: Write README asset-contract checks**

Add `scripts/demo/readme.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

test('README embeds only recorded demo GIFs', () => {
  assert.match(readme, /docs\/assets\/complex-demo\.gif/);
  assert.match(readme, /docs\/assets\/calculus-demo\.gif/);
  assert.doesNotMatch(readme, /docs\/assets\/transforms-demo\.gif/);
  assert.match(readme, /Fourier|frequency-domain|planned/i);
});
```

- [ ] **Step 2: Run the README test and verify it fails before the README edit**

Run: `node --test scripts/demo/readme.test.mjs`  
Expected: FAIL because the two new image references and honest transforms note are absent.

- [ ] **Step 3: Add concise subsystem sections to README**

Place Complex Analysis after the project introduction/foundation section and Multivariable Calculus after it; keep the existing capability details below. Each image uses:

```markdown
<p align="center">
  <img src="docs/assets/complex-demo.gif" alt="Complex Analysis in MathVisualization" width="100%" />
</p>
```

Do not put all GIFs at the top. Add a text-only Integral Transforms section that states the current time-domain capability and planned transform-domain work.

- [ ] **Step 4: Run the README contract before media exists**

Run: `node --test scripts/demo/readme.test.mjs`  
Expected: PASS for references; the test does not claim that binary assets exist yet.

- [ ] **Step 5: Record Complex and Calculus from clean contexts**

Run: `pnpm demo:complex` and then `pnpm demo:calculus`. Confirm each command prints the route, source path, GIF path, final dimensions, duration, fps and bytes. Do not manually edit the WebM or GIF.

- [ ] **Step 6: Inspect artifacts and enforce the visual contract**

Run: `ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration -of json docs/assets/complex-demo.gif` and the equivalent Calculus command. Use the local image/video inspection tools to inspect representative frames for: no blank startup, no debug overlay, no cursor jitter, visible expression input, visible canvas result, and a short final hold. If a clip is outside duration or size bounds, adjust only shared timing/config and rerun the scenario.

- [ ] **Step 7: Run the complete verification suite**

Run: `node --test scripts/demo/*.test.mjs`  
Expected: all harness tests pass.  
Run: `pnpm verify`  
Expected: existing application lint, typecheck, tests and build pass.  
Run: `pnpm demo`  
Expected: Complex and Calculus record/convert; Transforms prints a planned skip and no transforms asset is created.

- [ ] **Step 8: Commit README and generated assets**

```powershell
git add README.md docs/assets scripts/demo
git commit -m "docs: add repeatable subsystem demo GIFs"
```

### Task 7: Final artifact audit and handoff

**Files:**

- Verify: `docs/assets/complex-demo.gif`
- Verify: `docs/assets/calculus-demo.gif`
- Verify: `docs/assets/source/complex-demo.webm`
- Verify: `docs/assets/source/calculus-demo.webm`
- Verify: `README.md`

- [ ] **Step 1: Verify repository status and media inventory**

Run: `git status --short; Get-ChildItem -Recurse docs/assets | Select-Object FullName,Length`  
Expected: only the two approved source WebMs, two approved GIFs and no palette/temp/debug files.

- [ ] **Step 2: Verify the planned capability remains absent**

Run: `Test-Path docs/assets/transforms-demo.gif; Test-Path docs/assets/source/transforms-demo.webm`  
Expected: both output `False`.  
Run: `pnpm demo:transforms`  
Expected: explicit planned skip.

- [ ] **Step 3: Run the final source and artifact checks after the last commit**

Run: `pnpm verify; node --test scripts/demo/*.test.mjs`  
Expected: both commands exit zero. Record the exact test counts, artifact sizes and media metadata in the final handoff.

- [ ] **Step 4: Commit only if the final audit changed files**

```powershell
git status --short
```

Expected: clean worktree after the final media commit; do not create an empty commit.
