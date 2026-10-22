# Ambient Portal

**Your surroundings, within reach.**

English · [简体中文](README.md)

[Open the app](https://hanglark.github.io/ambient-portal/) · [GitHub repository](https://github.com/HangLark/ambient-portal)

![Ambient Portal desktop interface](docs/preview.en-US.png)

Ambient Portal is a lightweight, browser-only window into the environment around a device. Open it on a computer you control remotely to preview its camera and play its microphone through the local browser. A remote desktop app such as UU Remote forwards the screen and system audio to your other device.

Built with Vite, vanilla JavaScript, and native browser APIs. No backend, accounts, database, or production runtime dependencies. No media recording, storage, or uploading. Only language and aspect ratio preferences persist in this browser’s `localStorage`.

## Features

- Direct camera preview and fullscreen viewing. Prefers the highest available native resolution, then the highest frame rate at that resolution, with actual capture settings displayed.
- Auto, 16:9, 4:3, 1:1, and 9:16 aspect ratio negotiation. Native formats come first; unavailable formats keep the working picture, with an explicit option to allow cropping.
- Independent camera and microphone controls, plus one action to stop all capture. Navigation and refresh release media tracks.
- A shared control bar in desktop, phone, and fullscreen views. Start directly from the empty preview; introductory copy collapses during capture.
- **Devices & picture** identifies the actual camera and microphone, with independent selection when multiple authorized inputs are available.
- An audio-only view with real input levels. **Can’t hear anything?** traces microphone input, browser playback, and remote audio forwarding.
- Microphone capture prefers the highest available sample rate, bit depth, and channel count, showing the actual specifications reported by the browser. Echo cancellation, noise suppression, and automatic gain are requested off to preserve ambient sound.
- Low latency Web Audio monitoring, a real input level meter, and 0–200% playback volume. Monitoring starts off, with an initial playback volume of 35% when enabled.
- English and Simplified Chinese throughout, automatic browser language selection, and a saved preference.
- A restrained dark interface, responsive desktop and mobile layouts, keyboard controls, and reduced motion support.
- Actionable states for denied permissions, missing or busy devices, interrupted signals, and paused audio.
- Cancel pending requests safely: if permission arrives after cancellation, its stream is immediately released.

## Run locally

Use **Node.js 24 LTS** (minimum 22.12) and npm. An `.nvmrc` is included.

```bash
git clone https://github.com/HangLark/ambient-portal.git
cd ambient-portal
npm ci
npm run dev
```

Open the URL printed in the terminal, normally `http://127.0.0.1:5173/`. If you already have the project directory, start at `npm ci`.

```bash
npm test           # Media lifecycle, error handling, and translation tests
npm run build     # Generate dist/
npm run preview   # Preview the production build locally
```

Production preview: `http://127.0.0.1:4173/ambient-portal/`. The preview server is for local checks, not production hosting.

## Use the app

1. Open the page in Chrome or Edge on the **controlled device**. Click **Start camera** and allow camera access.
2. Enable the independent microphone switch when you want sound. After permission, the microphone plays through **that device’s browser audio output**.
3. If playback is paused by the browser, click **Resume audio**. Start at a low volume and adjust as needed.
4. **Stop camera** stops video only. The microphone switch stops monitoring only. **Stop everything** releases both devices.
5. Leaving or refreshing the page also stops capture. Saved browser permission never starts capture automatically on your next visit.

### Capture quality and volume

After capture starts, the app reads the track’s `getCapabilities()` and uses `applyConstraints()` to prefer the highest available settings. The camera favors native frames by default, then raises frame rate while preserving the negotiated dimensions. The microphone prefers the highest reported sample rate, bit depth, and channel count. When capability queries are unavailable, high initial preferences are used; if a driver rejects an upgrade, the existing usable stream is retained.

Capability ranges do not guarantee every combination is available. The interface therefore displays actual `getSettings()` values and omits unreported fields. The browser and audio output device may resample audio or mix channels, and remote desktop software may compress both video and audio. Maximum capture specifications do not guarantee lossless reception on the remote device.

Playback **100% is unity gain; 200% doubles signal amplitude**, rather than perceived loudness. Above 100%, the interface highlights distortion and feedback risks. Strong signals may clip, so lower volume if needed. Capture quality and playback volume are independent: the default 35% playback level does not reduce capture quality.

### Aspect ratios

Choose **Auto · best quality, 16:9, 4:3, 1:1, or 9:16** in **Devices & picture**. While the camera is off, this only saves a preference. During capture, changes use the same track and leave microphone playback running. Rapid selections process the current negotiation and only the latest pending choice. Capture can be stopped during a switch.

- Requests use `resizeMode: none` by default, preferring high resolution within the selected ratio before raising frame rate. A tolerance of about 1% accommodates near-ratio native modes such as 1760 × 1328 for 4:3.
- Actual dimensions and mode are verified with `getSettings()`. Ignored requests, unreported native modes, or unsupported formats do not appear as successful switches. The prior picture and selection are restored; if restoration fails, a visible message explains the reset to Auto.
- Only clicking **Allow crop to fit** requests `crop-and-scale`. This may crop or scale the picture and cannot add sensor detail. The button is absent when the browser cannot control cropping. Permission to crop is not saved: the next session tries native formats first.
- The preview footer shows actual resolution, frame rate, ratio, and mode. **Device native mode** means a format offered by the device, driver, or OS, not necessarily the full sensor area or all 12 megapixels. **Browser adapted** means the browser reports its adaptation mode, not proof that every frame was cropped. Unreported modes are identified honestly.
- The preview uses `object-fit: contain` to show the complete output without stretching or CSS cropping. Reload remembers the ratio preference but leaves both devices off. Each session negotiates anew; device capabilities are not cached and no model-specific resolution table is hardcoded.

Capability ranges cannot enumerate all native format combinations, so quality preference is best effort, not a guarantee of the hardware’s theoretical maximum. Cameras, systems, browsers, and system camera effects can produce different results; use the actual parameters in the preview footer.

### Input devices and sound checks

Open **Devices & picture** above the preview for actual input names and audio specifications. An input picker appears only when the browser exposes multiple authorized sources. Reading the device list does not request capture permission. Connecting or disconnecting devices, and reopening settings, refreshes the list.

- Switching a camera restarts only video; switching a microphone restarts only audio. The other channel continues, the new input negotiates maximum quality, and playback volume is preserved.
- An unavailable selected input produces an explicit error instead of silently substituting another device. Choose an available source in settings and start again; missing selections remain identifiable. Selecting while stopped never starts capture.
- Source choices last for this page session and are not saved in `localStorage`. Browser-provided labels may not include the full hardware model.
- With only the microphone on, the main view shows listening status, actual source, and input level. At 0% playback volume, capture and the input meter continue; switch monitoring off to release the microphone.
- **Quiet** means no substantial input is currently detected, not a device failure. Interrupted input, paused browser playback, and zero playback volume have distinct states. A suspended audio context does not pretend to measure input levels.
- **Can’t hear anything?** reports the input and playback states observable by this page. **Browser playback running** does not confirm an audible system output or remote reception. Check system volume, output routing, and remote software forwarding separately.

### Remote desktop audio

Ambient Portal does not stream media over the network. Enable **system audio / computer sound forwarding from the controlled device** in UU Remote or your remote desktop app. Names, support, and output routing depend on that software and the operating system.

- Enable both microphone monitoring here and system audio forwarding in your remote app. Voice chat or forwarding the controlling device’s microphone is a different feature.
- Playback happens on the controlled device. Use **headphones on that device**, or a suitable virtual output that your remote software can capture. Otherwise its microphone may pick up its own speakers, creating echo or feedback. Headphones only on the controlling device do not prevent this loop.
- Echo cancellation, noise suppression, and automatic gain are requested off to preserve ambient sound; actual processing support depends on the device and browser. Avoid routing speaker output back into the microphone, especially when amplifying playback.
- Muting the controlled computer or browser may also silence forwarded audio. Check browser, system, and remote app volume and routing. Test with low volume first.
- Keep the controlled device awake and the browser and page open. Sleep, browser background limits, or device changes may interrupt capture or playback. The UI reflects track interruptions and audio suspension; mobile background behavior is browser-dependent.

### Permissions and secure contexts

Camera and microphone access require **HTTPS or localhost / 127.0.0.1**. The HTTPS address provided by GitHub Pages meets this requirement.

- Opening `index.html` directly or using an ordinary HTTP LAN IP is not a supported deployment method. Use your HTTPS deployment for phone testing.
- Allow the first browser permission prompt. If denied, re-enable access in the address bar’s site permission settings and retry.
- Check operating system camera/microphone permissions for your browser and whether another app has exclusive access to the device.
- Latest Chrome and Edge are the primary targets. Other browsers may differ in fullscreen, permission queries, audio playback, and background behavior.
- No disabled browser security settings or server permission proxy is needed.

## Deploy to GitHub Pages

Expected URL: **`https://<username>.github.io/ambient-portal/`**.

The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main`:

1. Check out the project and set up Node.js 24 with npm caching.
2. Install locked dependencies with `npm ci`.
3. Run `npm test` for media lifecycle and translation checks.
4. Build with `npm run build`.
5. Upload `dist/` and deploy with the official GitHub Pages Actions.

Manual runs are available under **Actions → Deploy Ambient Portal to GitHub Pages → Run workflow**.

### One-time manual GitHub settings

1. Create or use a repository named **`ambient-portal`** and push the project to **`main`**. On GitHub Free, use a **public** repository for free Pages hosting; private repository support depends on your GitHub plan.
2. Open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the **Source**. No `gh-pages` branch is needed.
3. In **Settings → Actions → General**, allow Actions for the repository, including the official `actions/*` used by this workflow. The workflow declares `contents: read`, `pages: write`, and `id-token: write` at the appropriate job scopes. No personal access token or deployment secret is needed.
4. If **Settings → Environments → github-pages** has deployment restrictions, allow `main`. Approve the deployment if you configured required reviewers. Otherwise keep the default settings.
5. Push a commit or manually run the workflow. After both build and deploy succeed, open the published HTTPS address under **Settings → Pages**. Confirm **Enforce HTTPS** is enabled; the default `github.io` domain uses HTTPS.

For an existing empty remote repository, the first push can be:

```bash
# If this directory is not yet a Git repository: git init -b main
git add .
git commit -m "Build Ambient Portal"
git remote add origin https://github.com/<username>/ambient-portal.git
git push -u origin main
```

Skip `git add` and `git commit` if already committed. Do not add `origin` again if it already exists.

### Paths and refresh

[`vite.config.js`](vite.config.js) uses `/` for development and `/ambient-portal/` for builds and production previews. Vite handles JavaScript, CSS, and the favicon under that Pages subpath. This is a single page without client-side routing: refreshing `/ambient-portal/` returns `index.html` directly, so no 404 fallback is required.

If you rename the repository, switch to a root user site, or add a custom domain, update `base` to match. The supplied configuration targets the requested `ambient-portal` project path.

### Deployment acceptance checks

- Both Actions jobs succeed and the Pages URL loads.
- Direct navigation and refresh at `/ambient-portal/` load all JS, CSS, and SVG resources without 404s.
- Camera preview and independent microphone monitoring work after explicit permission on HTTPS; stopping ends the browser’s capture indicators.
- Language preference survives a refresh while all capture stays off.
- The controlling device receives the monitored audio with remote system audio forwarding enabled.

Local production builds and synthetic-device browser tests do not replace an actual workflow run in your repository, physical-device permission checks, or testing your remote desktop audio route.

## Browser verification

The Playwright suite uses installed Google Chrome by default with **synthetic camera and microphone inputs**; it does not open physical capture devices.

```bash
npm run test:e2e
```

Run the same checks against the deployed HTTPS site without starting a local server:

```bash
AMBIENT_TEST_URL=https://hanglark.github.io/ambient-portal/ npm run test:e2e
```

For Windows PowerShell, set `$env:AMBIENT_TEST_URL="https://hanglark.github.io/ambient-portal/"`, then run `npm run test:e2e`.

If Chrome is unavailable, use Playwright Chromium:

```bash
npx playwright install chromium
PLAYWRIGHT_CHROMIUM=1 npm run test:e2e
```

For Windows PowerShell, set `$env:PLAYWRIGHT_CHROMIUM="1"`, then run `npm run test:e2e`.

The suite starts a production preview and checks Pages asset paths and refresh, maximum capture specifications and actual settings, aspect ratio switching and explicit crop permission, rapid requests and cancellation, 200% playback gain, independent capture controls, track cleanup, denied permissions and retry, preference persistence, keyboard select and dialog behavior, and layouts in both languages at widths of 1440, 390, and 320 pixels. Additional checks cover first-fold controls at 1366 × 768, reachable phone and fullscreen controls, source changes and disconnection recovery, the audio-only view, and quiet/muted/interrupted/paused sound diagnostics. Unit tests also cover inventory races, rapid device changes and late-stream cleanup, ignored constraints, failed restoration, and missing capability APIs. Screenshots are saved in `test-results/`.

## Project structure

```text
src/
  main.js          Interface, state rendering, and interaction
  media.js         Capture, playback, and resource lifecycle
  camera-format.js Ratio negotiation, serialized switching, verification, and recovery
  i18n.js          Local dictionaries, language detection, and preference storage
  icons.js         Local SVG line icons
  style.css        Responsive dark interface
public/portal.svg  Brand icon
tests/             Lifecycle and browser tests
.github/workflows/deploy.yml
```

No media persistence, network API, third-party fonts, or analytics. Video binds directly to a muted `<video>`. Audio follows `MediaStream → AnalyserNode → GainNode → AudioContext.destination`, without encoding, recording, or a network round trip. Normal requests for static website assets are served by the hosting platform.

References: [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages), [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext).

Capture and gain references: [MDN getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities), [MDN applyConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints), [MDN getSettings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings), [MDN GainNode.gain](https://developer.mozilla.org/en-US/docs/Web/API/GainNode/gain).

Device selection references: [MDN deviceId](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/deviceId), [MDN devicechange](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event).
