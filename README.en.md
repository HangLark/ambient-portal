# Ambient Portal

**Your surroundings, within reach.**

English · [简体中文](README.md)

![Ambient Portal desktop interface](docs/preview.en-US.png)

Ambient Portal is a lightweight, browser-only window into the environment around a device. Open it on a computer you control remotely to preview its camera and play its microphone through the local browser. A remote desktop app such as UU Remote forwards the screen and system audio to your other device.

Built with Vite, vanilla JavaScript, and native browser APIs. No backend, accounts, database, or production runtime dependencies. No media recording, storage, or uploading. Only the language preference persists in this browser’s `localStorage`.

## Features

- Direct camera preview and fullscreen viewing. Requests 1280 × 720 at 30 fps as preferences; actual settings depend on the device.
- Independent camera and microphone controls, plus one action to stop all capture. Navigation and refresh release media tracks.
- Low latency Web Audio monitoring, a real input level meter, and adjustable playback volume. Monitoring starts off, with an initial playback volume of 35% when enabled.
- English and Simplified Chinese throughout, automatic browser language selection, and a saved preference.
- A restrained dark interface, responsive desktop and mobile layouts, keyboard controls, and reduced motion support.
- Actionable states for denied permissions, missing or busy devices, interrupted signals, and paused audio.
- Cancel pending requests safely: if permission arrives after cancellation, its stream is immediately released.

## Run locally

Use **Node.js 24 LTS** (minimum 22.12) and npm. An `.nvmrc` is included.

```bash
git clone https://github.com/<username>/ambient-portal.git
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

### Remote desktop audio

Ambient Portal does not stream media over the network. Enable **system audio / computer sound forwarding from the controlled device** in UU Remote or your remote desktop app. Names, support, and output routing depend on that software and the operating system.

- Enable both microphone monitoring here and system audio forwarding in your remote app. Voice chat or forwarding the controlling device’s microphone is a different feature.
- Playback happens on the controlled device. Use **headphones on that device**, or a suitable virtual output that your remote software can capture. Otherwise its microphone may pick up its own speakers, creating echo or feedback. Headphones only on the controlling device do not prevent this loop.
- Browser echo cancellation and noise suppression are requested; automatic gain is disabled. Processing depends on the device, may soften some ambient sounds, and cannot guarantee feedback prevention.
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

If Chrome is unavailable, use Playwright Chromium:

```bash
npx playwright install chromium
PLAYWRIGHT_CHROMIUM=1 npm run test:e2e
```

For Windows PowerShell, set `$env:PLAYWRIGHT_CHROMIUM="1"`, then run `npm run test:e2e`.

The suite starts a production preview and checks Pages asset paths and refresh, independent capture controls, track cleanup, denied permissions and retry, language persistence, keyboard dialog behavior, and layouts in both languages at widths of 1440, 390, and 320 pixels. Screenshots are saved in `test-results/`.

## Project structure

```text
src/
  main.js          Interface, state rendering, and interaction
  media.js         Capture, playback, and resource lifecycle
  i18n.js          Local dictionaries, language detection, and preference storage
  icons.js         Local SVG line icons
  style.css        Responsive dark interface
public/portal.svg  Brand icon
tests/             Lifecycle and browser tests
.github/workflows/deploy.yml
```

No media persistence, network API, third-party fonts, or analytics. Video binds directly to a muted `<video>`. Audio follows `MediaStream → AnalyserNode → GainNode → AudioContext.destination`, without encoding, recording, or a network round trip. Normal requests for static website assets are served by the hosting platform.

References: [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages), [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext).
