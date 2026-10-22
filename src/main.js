import './style.css';
import { icon } from './icons.js';
import { detectLanguage, saveLanguage, translate } from './i18n.js';
import { MediaController, isEngaged, MAX_VOLUME } from './media.js';
import { CAMERA_FORMATS, cameraRatioLabel, cameraModeLabel, loadCameraFormat, saveCameraFormat } from './camera-format.js';

let storage;
try { storage = window.localStorage; } catch { /* The app also works without storage. */ }
let language = detectLanguage(storage, navigator.languages || [navigator.language]);
const t = (key) => translate(language, key);
const label = (key) => `<span data-i18n="${key}">${t(key)}</span>`;

document.querySelector('#app').innerHTML = `
  <a class="skip-link" href="#controls">${label('skip')}</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="./" aria-label="Ambient Portal">${icon('portal', 'brand-symbol')}<span>Ambient<span class="brand-light"> Portal</span></span></a>
      <div class="header-actions">
        <span class="local-label"><span class="tiny-dot"></span>${label('localOnly')}</span>
        <span class="header-divider" aria-hidden="true"></span>
        <button class="language-button" id="language" type="button">${icon('globe')}<span id="language-label"></span></button>
      </div>
    </div>
  </header>

  <main class="main-content">
    <section class="intro" aria-labelledby="heading">
      <div><p class="eyebrow">${label('eyebrow')}</p><h1 id="heading">${label('heading')}</h1><p class="intro-description">${label('intro')}</p></div>
      <span class="private-badge">${icon('shield')}${label('privateSession')}</span>
    </section>
    <div class="environment-error" id="environment-error" role="alert" hidden>${icon('alert')}<p></p></div>

    <div class="workspace">
      <section class="preview-panel" aria-labelledby="preview-title">
        <div class="panel-toolbar"><h2 id="preview-title">${icon('camera')}${label('preview')}</h2><span class="status-badge" id="preview-status" role="status"><span class="status-dot"></span><span id="preview-status-text"></span></span></div>
        <div class="stage" id="stage" data-state="idle">
          <video id="preview-video" autoplay playsinline muted></video>
          <div class="stage-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <div class="empty-state" id="empty-state">
            <div class="portal-illustration" id="portal-illustration" aria-hidden="true"><div class="portal-orbit orbit-one"></div><div class="portal-orbit orbit-two"></div><div class="portal-glyph">${icon('portal')}</div><span class="orbit-spark"></span></div>
            <h3 id="empty-title"></h3><p id="empty-body"></p>
            <div class="empty-hint">${icon('lock')}<span id="empty-hint"></span></div>
          </div>
          <div class="stage-bottom"><span class="feed-label"><span class="feed-marker" aria-hidden="true"></span><span id="feed-label"></span></span><span class="stage-device">01 <span aria-hidden="true">/</span> ${label('camera')}</span></div>
        </div>
        <div class="preview-footer"><span>${icon('lock')}<span id="preview-detail"></span></span><button class="icon-button" id="fullscreen" type="button">${icon('expand')}</button></div>
        <p class="fullscreen-error" id="fullscreen-error" role="status" hidden></p>
      </section>

      <section class="control-panel" id="controls" aria-labelledby="controls-title" tabindex="-1">
        <div class="control-heading"><p class="eyebrow">${label('session')}</p><h2 id="controls-title"></h2><p>${label('sessionBody')}</p></div>
        <div class="device-control camera-control">
          <div class="device-row"><div class="device-icon">${icon('camera')}</div><div class="device-label"><h3>${label('camera')}</h3><p>${label('videoInput')}</p></div><span class="device-pill" id="camera-pill"></span></div>
          <div class="format-control">
            <label for="camera-format">${label('formatLabel')}</label>
            <div class="format-select"><select id="camera-format" aria-describedby="format-help format-notice">${CAMERA_FORMATS.map(({ id, label: key }) => `<option value="${id}" data-i18n="${key}">${t(key)}</option>`).join('')}</select>${icon('chevron')}</div>
            <p id="format-help">${label('formatHelp')}</p>
            <p class="format-notice" id="format-notice" role="status" hidden></p>
            <button class="crop-button" id="allow-crop" type="button" hidden></button>
          </div>
          <button class="camera-button" id="camera-button" type="button"><span id="camera-action"></span><span id="camera-action-icon"></span></button>
        </div>
        <div class="device-control microphone-control">
          <div class="device-row"><div class="device-icon">${icon('mic')}</div><div class="device-label"><h3>${label('microphone')}</h3><p>${label('audioInput')}</p></div><button class="switch" id="microphone-switch" type="button" role="switch" aria-checked="false" aria-describedby="sound-advice"><span></span></button></div>
          <p class="capture-detail" id="audio-detail" hidden></p>
          <div class="meter-heading"><span>${label('level')}</span><span class="mic-status" id="mic-status" role="status"></span></div>
          <div class="level-meter" id="level-meter" aria-hidden="true">${'<i></i>'.repeat(32)}</div>
          <div class="volume-heading"><label for="volume">${label('volume')}</label><output for="volume" id="volume-value">35%</output></div>
          <div class="volume-control">${icon('volume')}<input id="volume" type="range" min="0" max="${MAX_VOLUME * 100}" value="35" step="1" aria-describedby="volume-boost-hint" /></div>
          <p class="volume-boost-hint" id="volume-boost-hint" role="status" hidden>${label('volumeBoostHint')}</p>
          <button class="resume-button" id="resume-audio" type="button" hidden>${icon('play')}${label('resumeAudio')}</button>
          <p class="mic-error" id="mic-error" role="alert" hidden></p>
        </div>
        <aside class="sound-advice" id="sound-advice">${icon('headphones')}<div><h3>${label('headphonesTitle')}</h3><p>${label('headphonesBody')}</p></div></aside>
        <button class="stop-button" id="stop-all" type="button" disabled>${icon('stop')}${label('stopAll')}</button>
      </section>

      <div class="status-strip" role="status" aria-atomic="true">
        <div class="status-item">${icon('camera')}<div><span class="status-name">${label('camera')}</span><span class="status-value" id="camera-status"></span></div><span class="permission-value" id="camera-permission"></span></div>
        <div class="status-item">${icon('mic')}<div><span class="status-name">${label('microphone')}</span><span class="status-value" id="microphone-status"></span></div><span class="permission-value" id="mic-permission"></span></div>
        <div class="status-item connection-item">${icon('shield')}<div><span class="status-name">${label('connection')}</span><span class="status-value" id="connection-status"></span></div><span class="connection-dot"></span></div>
      </div>
    </div>

    <div class="privacy-row"><div class="privacy-copy">${icon('shield')}<p><strong>${label('privacy')}</strong><span>${label('privacyBody')}</span></p></div><button class="guide-button" id="guide-open" type="button">${label('guide')}${icon('chevron')}</button></div>
  </main>
  <footer class="site-footer"><span>${label('footer')}</span><span class="version">${label('version')}<span class="tiny-dot"></span>AMBIENT PORTAL</span></footer>

  <dialog id="guide-dialog" aria-labelledby="guide-title" aria-describedby="guide-intro">
    <div class="dialog-symbol">${icon('portal')}</div><h2 id="guide-title">${label('guideTitle')}</h2><p id="guide-intro">${label('guideIntro')}</p>
    <ol><li>${label('guideStep1')}</li><li>${label('guideStep2')}</li><li>${label('guideStep3')}</li></ol>
    <div class="dialog-note">${icon('headphones')}<p>${label('guideNote')}</p></div><p class="dialog-privacy">${label('guidePrivacy')}</p>
    <form method="dialog"><button class="camera-button" type="submit">${label('closeGuide')}${icon('check')}</button></form>
  </dialog>
`;

const $ = (id) => document.getElementById(id);
const video = $('preview-video');
let savedCameraFormat = loadCameraFormat(storage);
const media = new MediaController({ video, cameraFormat: savedCameraFormat, onChange: render });
let levelFrame = 0;
let lastMeterTime = 0;
let fullscreenError = false;
const meterBars = [...$('level-meter').children];

function stateLabel(device) {
  if (device.muted && device.status === 'active') return 'interrupted';
  return { idle: 'off', requesting: 'requesting', active: 'on', paused: 'paused', error: 'error' }[device.status];
}

function permissionLabel(state) {
  return { granted: 'permissionGranted', denied: 'permissionDenied', prompt: 'permissionPrompt', unknown: 'permissionUnknown' }[state];
}

function render() {
  const camera = media.camera;
  const mic = media.microphone;
  const format = media.cameraFormatState;
  const cameraActive = camera.status === 'active';
  const cameraBusy = camera.status === 'requesting';
  const micEngaged = isEngaged(mic);
  const cameraState = camera.muted && cameraActive ? 'paused' : camera.status;
  $('stage').dataset.state = cameraState;
  $('preview-status').dataset.state = format.busy ? 'requesting' : cameraState;
  $('preview-status-text').textContent = t(format.busy ? 'formatSwitching' : { idle: 'standby', requesting: 'connecting', active: 'live', paused: 'interrupted', error: 'needsAttention' }[cameraState]);
  $('empty-state').hidden = cameraActive && !camera.muted;
  const emptyKeys = cameraBusy ? ['pendingTitle', format.busy ? 'formatPendingBody' : 'pendingBody', 'pendingHint']
    : camera.error ? ['errorTitle', camera.error, 'emptyHint']
    : camera.muted ? ['pausedTitle', 'pausedBody', 'emptyHint']
    : ['emptyTitle', 'emptyBody', 'emptyHint'];
  $('empty-title').textContent = t(emptyKeys[0]);
  $('empty-body').textContent = t(emptyKeys[1]);
  $('empty-hint').textContent = t(emptyKeys[2]);
  $('portal-illustration').classList.toggle('is-pending', cameraBusy);
  $('feed-label').textContent = t(cameraActive ? 'localFeed' : 'noFeed');
  const settings = media.cameraStream?.getVideoTracks()[0]?.getSettings();
  const frameRate = settings?.frameRate ? `${Math.round(settings.frameRate * 10) / 10} ${t('fps')}` : '';
  $('preview-detail').textContent = cameraActive && settings?.width && settings?.height
    ? [`${settings.width} × ${settings.height}`, frameRate, cameraRatioLabel(settings), t(cameraModeLabel(settings))].filter(Boolean).join(' · ') : t('directPreview');
  $('preview-detail').title = cameraActive ? t('formatModeHelp') : '';
  $('camera-format').value = format.selected;
  $('camera-format').disabled = Boolean(media.unavailable);
  $('camera-format').setAttribute('aria-busy', String(format.busy));
  $('format-help').textContent = t(format.busy ? 'formatSwitching' : 'formatHelp');
  $('format-notice').hidden = !format.notice;
  $('format-notice').textContent = format.notice ? [format.fallback, t(format.notice)].filter(Boolean).join(' · ') : '';
  $('allow-crop').hidden = !format.fallback;
  $('allow-crop').textContent = `${t('formatAllowCrop')}${format.fallback ? ` · ${format.fallback}` : ''}`;
  if (!format.busy && media.cameraFormat !== savedCameraFormat) {
    savedCameraFormat = media.cameraFormat;
    saveCameraFormat(storage, savedCameraFormat);
  }
  $('controls-title').textContent = t(media.engaged ? 'sessionActive' : 'sessionIdle');
  $('camera-pill').textContent = t(format.busy ? 'formatSwitching' : stateLabel(camera));
  $('camera-pill').dataset.state = cameraState;
  $('camera-action').textContent = t(cameraBusy ? 'cancel' : cameraActive ? 'stopCamera' : camera.error ? 'retryCamera' : 'startCamera');
  $('camera-action-icon').innerHTML = icon(cameraBusy ? 'x' : cameraActive ? 'stop' : 'arrow');
  $('camera-button').classList.toggle('is-active', isEngaged(camera));
  $('camera-button').disabled = Boolean(media.unavailable);
  $('camera-button').setAttribute('aria-busy', String(cameraBusy));
  $('microphone-switch').setAttribute('aria-checked', String(micEngaged));
  $('microphone-switch').setAttribute('aria-busy', String(mic.status === 'requesting'));
  $('microphone-switch').setAttribute('aria-label', t(mic.status === 'requesting' ? 'cancelMic' : micEngaged ? 'stopMic' : 'startMic'));
  $('microphone-switch').disabled = Boolean(media.unavailable);
  $('mic-status').textContent = t(stateLabel(mic));
  $('mic-status').dataset.state = mic.status;
  const audioSettings = media.microphoneStream?.getAudioTracks()[0]?.getSettings() || {};
  const audioDetails = [
    audioSettings.sampleRate && `${audioSettings.sampleRate / 1000} kHz`,
    audioSettings.sampleSize && `${audioSettings.sampleSize} ${t('bitDepth')}`,
    audioSettings.channelCount && `${audioSettings.channelCount} ${t('channels')}`,
  ].filter(Boolean);
  $('audio-detail').hidden = !['active', 'paused'].includes(mic.status) || !audioDetails.length;
  $('audio-detail').textContent = audioDetails.join(' · ');
  $('volume').disabled = !['active', 'paused'].includes(mic.status);
  $('volume-value').textContent = `${Math.round(media.volume * 100)}%`;
  $('volume').style.setProperty('--volume', `${media.volume / MAX_VOLUME * 100}%`);
  $('volume').setAttribute('aria-valuetext', `${Math.round(media.volume * 100)}%`);
  $('volume-value').classList.toggle('is-boosted', media.volume > 1);
  $('volume-boost-hint').hidden = media.volume <= 1 || !['active', 'paused'].includes(mic.status);
  $('resume-audio').hidden = mic.status !== 'paused';
  $('mic-error').hidden = !mic.error;
  $('mic-error').textContent = mic.error ? t(mic.error) : '';
  $('stop-all').disabled = !media.engaged;
  $('stop-all').title = t(media.engaged ? 'stopAll' : 'allOff');
  $('camera-status').textContent = t(stateLabel(camera));
  $('camera-status').dataset.state = cameraState;
  $('microphone-status').textContent = t(stateLabel(mic));
  $('microphone-status').dataset.state = mic.status;
  $('camera-permission').textContent = t(permissionLabel(media.permissions.camera));
  $('mic-permission').textContent = t(permissionLabel(media.permissions.microphone));
  for (const [id, name] of [['camera-permission', 'camera'], ['mic-permission', 'microphone']]) {
    $(id).title = `${t('permission')}: ${t(permissionLabel(media.permissions[name]))}`;
  }
  $('connection-status').textContent = t(window.isSecureContext ? 'secure' : 'insecure');
  $('connection-status').dataset.state = window.isSecureContext ? 'active' : 'error';
  $('environment-error').hidden = !media.unavailable;
  $('environment-error').querySelector('p').textContent = media.unavailable ? t(media.unavailable) : '';
  $('fullscreen').disabled = !cameraActive || !document.fullscreenEnabled;
  const fullscreenLabel = t(document.fullscreenElement ? 'exitFullscreen' : 'fullscreen');
  $('fullscreen').setAttribute('aria-label', fullscreenLabel);
  $('fullscreen').title = fullscreenLabel;
  $('fullscreen').innerHTML = icon(document.fullscreenElement ? 'shrink' : 'expand');
  $('fullscreen-error').hidden = !fullscreenError;
  $('fullscreen-error').textContent = fullscreenError ? t('errorFullscreen') : '';
  updateMeter();
}

function drawMeter(time = 0) {
  if (time - lastMeterTime > 50 || time === 0) {
    const activeBars = Math.round(media.getLevel() * meterBars.length);
    meterBars.forEach((bar, index) => bar.classList.toggle('lit', index < activeBars));
    lastMeterTime = time;
  }
  levelFrame = requestAnimationFrame(drawMeter);
}

function updateMeter() {
  if (media.microphone.status === 'active' && !document.hidden) {
    if (!levelFrame) drawMeter();
  } else {
    cancelAnimationFrame(levelFrame);
    levelFrame = 0;
    meterBars.forEach((bar) => bar.classList.remove('lit'));
  }
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $('language-label').textContent = language === 'en-US' ? '中文' : 'EN';
  $('language').setAttribute('aria-label', t('language'));
  $('language').title = t('language');
  video.setAttribute('aria-label', t('preview'));
  render();
}

$('language').addEventListener('click', () => {
  language = language === 'en-US' ? 'zh-CN' : 'en-US';
  saveLanguage(storage, language);
  applyLanguage();
});
$('camera-button').addEventListener('click', () => isEngaged(media.camera) ? media.stopCamera() : media.startCamera());
$('camera-format').addEventListener('change', (event) => { void media.setCameraFormat(event.target.value); });
$('allow-crop').addEventListener('click', () => {
  // The fallback button disappears as soon as negotiation starts; keep keyboard focus nearby.
  $('camera-format').focus({ preventScroll: true });
  void media.allowCameraCrop();
});
$('microphone-switch').addEventListener('click', () => isEngaged(media.microphone) ? media.stopMicrophone() : media.startMicrophone());
$('stop-all').addEventListener('click', () => media.stopAll());
$('resume-audio').addEventListener('click', () => media.resumeAudio());
$('volume').addEventListener('input', (event) => { media.setVolume(Number(event.target.value) / 100); render(); });
$('fullscreen').addEventListener('click', async () => {
  try {
    fullscreenError = false;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.preview-panel').requestFullscreen();
  } catch { fullscreenError = true; }
  render();
});
document.addEventListener('fullscreenchange', render);
video.addEventListener('resize', render);
$('guide-open').addEventListener('click', () => $('guide-dialog').showModal());
$('guide-dialog').addEventListener('click', (event) => {
  if (event.target !== $('guide-dialog')) return;
  const rect = $('guide-dialog').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('guide-dialog').close();
});
document.addEventListener('visibilitychange', updateMeter);
// pagehide covers navigation and the back/forward cache without interrupting remote use in a background tab.
window.addEventListener('pagehide', () => media.stopAll());
if (import.meta.hot) import.meta.hot.dispose(() => { media.dispose(); cancelAnimationFrame(levelFrame); });

applyLanguage();
void media.watchPermissions();
