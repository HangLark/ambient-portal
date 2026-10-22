import './style.css';
import { icon } from './icons.js';
import { detectLanguage, saveLanguage, translate } from './i18n.js';
import { MediaController, isEngaged, MAX_VOLUME } from './media.js';
import { CAMERA_FORMATS, cameraRatioLabel, cameraModeLabel, loadCameraFormat, saveCameraFormat } from './camera-format.js';

let storage;
try { storage = window.localStorage; } catch { /* Storage is optional. */ }
let language = detectLanguage(storage, navigator.languages || [navigator.language]);
const t = (key) => translate(language, key);
const label = (key) => `<span data-i18n="${key}">${t(key)}</span>`;
const bars = (count) => '<i></i>'.repeat(count);
const closeButton = () => `<form method="dialog"><button class="primary-button" type="submit">${label('closeGuide')}${icon('check')}</button></form>`;

document.querySelector('#app').innerHTML = `
  <a class="skip-link" href="#controls">${label('skip')}</a>
  <header class="site-header"><div class="header-inner">
    <a class="brand" href="./" aria-label="Ambient Portal">${icon('portal', 'brand-symbol')}<span>Ambient<span class="brand-light"> Portal</span></span></a>
    <button class="language-button" id="language" type="button">${icon('globe')}<span id="language-label"></span></button>
  </div></header>
  <main class="main-content">
    <section class="intro" aria-labelledby="heading"><p class="eyebrow">${label('eyebrow')}</p><h1 id="heading">${label('heading')}</h1><p class="intro-description">${label('intro')}</p></section>
    <div class="environment-error" id="environment-error" role="alert" hidden>${icon('alert')}<p></p></div>
    <section class="workspace" id="workspace" aria-labelledby="preview-title">
      <div class="panel-toolbar">
        <h2 id="preview-title">${icon('portal')}<span id="preview-name"></span></h2>
        <span class="status-badge" id="preview-status" role="status"><span class="status-dot"></span><span id="preview-status-text"></span></span>
        <button class="text-button" id="settings-open" type="button">${icon('settings')}${label('settings')}</button>
        <button class="icon-button" id="fullscreen" type="button">${icon('expand')}</button>
      </div>
      <div class="stage" id="stage" data-state="idle">
        <video id="preview-video" autoplay playsinline muted></video>
        <div class="empty-state" id="empty-state">
          <div class="portal-illustration" id="portal-illustration" aria-hidden="true"><div class="portal-orbit orbit-one"></div><div class="portal-orbit orbit-two"></div><div class="portal-glyph">${icon('portal')}</div></div>
          <h3 id="empty-title"></h3><p id="empty-body"></p>
          <button class="primary-button" id="empty-start" type="button">${icon('camera')}${label('openCamera')}</button>
          <p class="empty-hint" id="empty-hint"></p>
        </div>
        <div class="audio-scene" id="audio-scene" hidden>
          <div class="audio-symbol" aria-hidden="true">${icon('headphones')}</div>
          <h3 id="audio-scene-title"></h3>
          <p id="audio-source"></p><div class="scene-meter level-meter" id="scene-meter" aria-hidden="true">${bars(40)}</div>
          <p class="scene-caption" id="scene-caption"></p>
          <button class="text-button" id="add-camera" type="button">${icon('camera')}${label('addCamera')}</button>
        </div>
      </div>
      <div class="preview-footer"><span id="preview-detail"></span><span id="camera-source"></span></div>
      <section class="control-panel" id="controls" aria-label="${t('controls')}" tabindex="-1">
        <div class="control-bar">
          <button class="camera-button primary-button" id="camera-button" type="button"><span id="camera-action-icon"></span><span id="camera-action"></span></button>
          <button class="monitor-button" id="microphone-switch" type="button" role="switch" aria-checked="false" aria-describedby="sound-advice">${icon('mic')}<span>${label('listen')}</span><span class="switch-track" aria-hidden="true"><i></i></span></button>
          <div class="volume-group"><div class="volume-heading"><label for="volume">${label('volume')}</label><output for="volume" id="volume-value">35%</output></div><input id="volume" type="range" min="0" max="${MAX_VOLUME * 100}" value="35" step="1" aria-describedby="volume-boost-hint" /></div>
          <button class="stop-button" id="stop-all" type="button" disabled>${icon('stop')}${label('stopAll')}</button>
        </div>
        <div class="audio-status-row">
          <div class="input-status"><span class="level-meter" id="level-meter" aria-hidden="true">${bars(12)}</span><span id="mic-status"></span></div>
          <span class="playback-status" id="playback-status" role="status"></span>
          <button class="text-button resume-button" id="resume-audio" type="button" hidden>${icon('play')}${label('resumeAudio')}</button>
          <button class="text-button sound-help" id="sound-help" type="button">${icon('info')}${label('soundHelp')}</button>
        </div>
        <p class="sound-advice" id="sound-advice">${label('soundAdvice')}</p>
        <p class="notice" id="volume-boost-hint" role="status" hidden>${label('volumeBoostHint')}</p>
        <p class="notice" id="mic-error" role="alert" hidden></p>
        <p class="notice" id="camera-error" role="alert" hidden></p>
        <p class="notice" id="picture-notice" role="status" hidden></p>
        <p class="notice" id="fullscreen-error" role="status" hidden></p>
      </section>
      <dialog id="settings-dialog" aria-labelledby="settings-title">
        <div class="dialog-heading">${icon('settings')}<h2 id="settings-title">${label('settingsTitle')}</h2></div>
        <p>${label('qualityDefault')}</p>
        ${['camera', 'microphone'].map((name) => `<section class="settings-section"><h3>${icon(name === 'camera' ? 'camera' : 'mic')}${label(name)}</h3><p class="source-name" id="${name}-source-name"></p><p class="notice" id="${name}-source-status" role="status" hidden></p><div class="source-picker" id="${name}-picker" hidden><label for="${name}-device">${label('sourceLabel')}</label><select id="${name}-device"></select></div>${name === 'camera' ? `
          <div class="format-control"><label for="camera-format">${label('formatLabel')}</label><select id="camera-format" aria-describedby="format-help format-notice">${CAMERA_FORMATS.map(({ id, label: key }) => `<option value="${id}" data-i18n="${key}">${t(key)}</option>`).join('')}</select><p id="format-help">${label('formatHelp')}</p><p class="notice" id="format-notice" role="status" hidden></p><button class="crop-button" id="allow-crop" type="button" hidden></button></div>` : '<p class="capture-detail" id="audio-detail" hidden></p>'}</section>`).join('')}
        <p class="notice" id="devices-error" role="status" hidden>${label('devicesError')}</p><p class="settings-note">${label('sourceHelp')}</p>
        ${closeButton()}
      </dialog>
      <dialog id="sound-dialog" aria-labelledby="sound-title">
        <div class="dialog-heading">${icon('headphones')}<h2 id="sound-title">${label('soundHelp')}</h2></div>
        <p>${label('soundIntro')}</p><ol class="sound-checks">
          <li><h3>${label('checkInput')}</h3><p class="check-result" id="check-input" role="status"></p><p>${label('checkInputHelp')}</p></li>
          <li><h3>${label('checkPlayback')}</h3><p class="check-result" id="check-playback" role="status"></p><p>${label('checkPlaybackHelp')}</p><button class="text-button" id="diagnostic-resume" type="button" hidden>${icon('play')}${label('resumeAudio')}</button></li>
          <li><h3>${label('checkRemote')}</h3><p class="check-result">${label('remoteUnknown')}</p><p>${label('checkRemoteHelp')}</p></li>
        </ol><div class="dialog-note">${icon('headphones')}<p>${label('guideNote')}</p></div>${closeButton()}
      </dialog>
    </section>
    <footer class="privacy-row"><p>${icon('shield')}${label('privacyBody')}</p><button class="text-button" id="guide-open" type="button">${label('guide')}${icon('chevron')}</button></footer>
  </main>
  <dialog id="guide-dialog" aria-labelledby="guide-title" aria-describedby="guide-intro">
    <div class="dialog-heading">${icon('portal')}<h2 id="guide-title">${label('guideTitle')}</h2></div><p id="guide-intro">${label('guideIntro')}</p>
    <ol><li>${label('guideStep1')}</li><li>${label('guideStep2')}</li><li>${label('guideStep3')}</li></ol>
    <div class="dialog-note">${icon('headphones')}<p>${label('guideNote')}</p></div><p>${label('guidePrivacy')}</p>${closeButton()}
  </dialog>
`;

const $ = (id) => document.getElementById(id);
const video = $('preview-video');
let savedCameraFormat = loadCameraFormat(storage);
const media = new MediaController({ video, cameraFormat: savedCameraFormat, onChange: render });
let levelFrame = 0;
let lastMeterTime = 0;
let lastSignalTime = -Infinity;
let inputDetected = false;
let fullscreenError = false;
const meters = [$('level-meter'), $('scene-meter')].map((meter) => [...meter.children]);

function inputKey() {
  const mic = media.microphone;
  if (mic.status === 'error') return mic.error;
  if (mic.status === 'requesting') return 'requesting';
  if (!isEngaged(mic)) return 'monitoringOff';
  if (mic.muted) return 'inputInterrupted';
  if (mic.status === 'paused') return 'inputUnmeasured';
  return inputDetected ? 'inputDetected' : 'inputQuiet';
}

function playbackKey() {
  const mic = media.microphone;
  if (mic.status === 'paused') return 'paused';
  if (mic.status !== 'active') return 'playbackOff';
  if (media.volume === 0) return 'playbackMuted';
  return 'playbackRunning';
}

function renderSound() {
  const input = inputKey();
  $('mic-status').textContent = t(media.microphone.error ? 'error' : input);
  $('playback-status').textContent = isEngaged(media.microphone) ? t(playbackKey()) : '';
  $('check-input').textContent = t(input);
  $('check-playback').textContent = t(playbackKey());
  $('diagnostic-resume').hidden = media.microphone.status !== 'paused';
  $('audio-scene-title').textContent = t(media.microphone.muted ? 'inputInterrupted' : media.microphone.status === 'paused' ? 'paused' : 'listeningTitle');
  $('scene-caption').textContent = t(input);
}

function renderSource(name) {
  const source = media.getSource(name);
  const device = media[name];
  const statusKey = device.error || (device.status === 'requesting' ? 'connecting' : device.muted ? 'interrupted' : device.status === 'paused' ? 'paused' : null);
  $(`${name}-source-status`).hidden = !statusKey;
  $(`${name}-source-status`).textContent = statusKey ? t(statusKey) : '';
  const devices = media.devices[name];
  $(`${name}-source-name`).textContent = source.label || t('defaultSource');
  const picker = $(`${name}-device`);
  const value = source.id;
  const choices = [{ id: '', label: t('defaultSource') }, ...devices];
  if (value && !devices.some(({ id }) => id === value)) choices.push({ id: value, label: `${source.label || t(name)} · ${t(source.missing ? 'sourceMissing' : 'sourceCurrent')}` });
  // Do not recreate native options on meter ticks or while a picker is being used.
  const signature = JSON.stringify(choices);
  if (picker.dataset.options !== signature) {
    picker.replaceChildren(...choices.map(({ id, label: text }) => new Option(text, id)));
    picker.dataset.options = signature;
  }
  picker.value = value;
  picker.disabled = Boolean(media.unavailable);
  const hidePicker = devices.length < 2 && !source.missing;
  if (hidePicker && document.activeElement === picker) {
    const nextFocus = name === 'camera' ? $('camera-format') : $('settings-dialog').querySelector('form button');
    nextFocus.focus({ preventScroll: true });
  }
  $(`${name}-picker`).hidden = hidePicker;
}

function render() {
  const camera = media.camera;
  const mic = media.microphone;
  const format = media.cameraFormatState;
  const cameraActive = camera.status === 'active';
  const cameraBusy = camera.status === 'requesting';
  const micEngaged = isEngaged(mic);
  const audioOnly = !cameraActive && !cameraBusy && ['active', 'paused'].includes(mic.status);
  const cameraState = camera.muted && cameraActive ? 'paused' : camera.status;
  document.querySelector('.intro').classList.toggle('is-compact', media.engaged);
  $('stage').dataset.state = cameraState;
  $('preview-name').textContent = t(audioOnly ? 'audioOnly' : 'preview');
  const stageKey = audioOnly ? (mic.muted ? 'interrupted' : mic.status === 'paused' ? 'paused' : 'listening')
    : format.busy ? 'formatSwitching' : { idle: 'standby', requesting: 'connecting', active: 'live', paused: 'interrupted', error: 'needsAttention' }[cameraState];
  $('preview-status').dataset.state = audioOnly ? (mic.muted ? 'paused' : mic.status) : format.busy ? 'requesting' : cameraState;
  $('preview-status-text').textContent = t(stageKey);
  $('empty-state').hidden = (cameraActive && !camera.muted) || audioOnly;
  $('audio-scene').hidden = !audioOnly;
  document.querySelector('.preview-footer').hidden = audioOnly;
  document.querySelector('.input-status').hidden = audioOnly;
  const emptyKeys = cameraBusy ? ['pendingTitle', format.busy ? 'formatPendingBody' : 'pendingBody', 'pendingHint']
    : camera.error ? ['errorTitle', camera.error, 'emptyHint']
    : camera.muted ? ['pausedTitle', 'pausedBody', 'emptyHint'] : ['emptyTitle', 'emptyBody', 'emptyHint'];
  $('empty-title').textContent = t(emptyKeys[0]);
  $('empty-body').textContent = t(emptyKeys[1]);
  $('empty-hint').textContent = t(emptyKeys[2]);
  $('empty-start').hidden = cameraBusy || cameraActive;
  $('empty-start').disabled = Boolean(media.unavailable);
  $('portal-illustration').classList.toggle('is-pending', cameraBusy);
  const settings = media.cameraStream?.getVideoTracks()[0]?.getSettings();
  const frameRate = settings?.frameRate ? `${Math.round(settings.frameRate * 10) / 10} ${t('fps')}` : '';
  $('preview-detail').textContent = cameraActive && settings?.width && settings?.height
    ? [`${settings.width} × ${settings.height}`, frameRate, cameraRatioLabel(settings), t(cameraModeLabel(settings))].filter(Boolean).join(' · ') : t(audioOnly ? 'audioLocal' : 'qualityDefault');
  $('preview-detail').title = cameraActive ? t('formatModeHelp') : '';
  $('camera-source').textContent = cameraActive ? media.getSource('camera').label : '';
  $('audio-source').textContent = media.getSource('microphone').label || t('defaultSource');
  for (const name of ['camera', 'microphone']) renderSource(name);
  $('devices-error').hidden = !media.deviceListError;
  $('camera-format').value = format.selected;
  $('camera-format').disabled = Boolean(media.unavailable);
  $('camera-format').setAttribute('aria-busy', String(format.busy));
  $('format-help').textContent = t(format.busy ? 'formatSwitching' : 'formatHelp');
  $('format-notice').hidden = !format.notice;
  $('format-notice').textContent = format.notice ? [format.fallback, t(format.notice)].filter(Boolean).join(' · ') : '';
  $('picture-notice').hidden = !format.notice;
  $('picture-notice').textContent = $('format-notice').textContent;
  $('allow-crop').hidden = !format.fallback;
  $('allow-crop').textContent = `${t('formatAllowCrop')}${format.fallback ? ` · ${format.fallback}` : ''}`;
  if (!format.busy && media.cameraFormat !== savedCameraFormat) {
    savedCameraFormat = media.cameraFormat;
    saveCameraFormat(storage, savedCameraFormat);
  }
  $('camera-action').textContent = t(cameraBusy ? 'cancel' : cameraActive ? 'stopCamera' : camera.error ? 'retryCamera' : 'startCamera');
  $('camera-action-icon').innerHTML = icon(cameraBusy ? 'x' : cameraActive ? 'cameraOff' : 'camera');
  $('camera-button').classList.toggle('is-active', isEngaged(camera));
  $('camera-button').disabled = Boolean(media.unavailable);
  $('camera-button').setAttribute('aria-busy', String(cameraBusy));
  $('microphone-switch').setAttribute('aria-checked', String(micEngaged));
  $('microphone-switch').setAttribute('aria-busy', String(mic.status === 'requesting'));
  $('microphone-switch').setAttribute('aria-label', t(mic.status === 'requesting' ? 'cancelMic' : micEngaged ? 'stopMic' : 'startMic'));
  $('microphone-switch').disabled = Boolean(media.unavailable);
  const audioSettings = media.microphoneStream?.getAudioTracks()[0]?.getSettings() || {};
  const audioDetails = [audioSettings.sampleRate && `${audioSettings.sampleRate / 1000} kHz`, audioSettings.sampleSize && `${audioSettings.sampleSize} ${t('bitDepth')}`, audioSettings.channelCount && `${audioSettings.channelCount} ${t('channels')}`].filter(Boolean);
  $('audio-detail').hidden = !['active', 'paused'].includes(mic.status) || !audioDetails.length;
  $('audio-detail').textContent = audioDetails.join(' · ');
  $('volume').disabled = !['active', 'paused'].includes(mic.status);
  $('volume').value = Math.round(media.volume * 100);
  $('volume-value').textContent = `${Math.round(media.volume * 100)}%`;
  $('volume').style.setProperty('--volume', `${media.volume / MAX_VOLUME * 100}%`);
  $('volume').setAttribute('aria-valuetext', `${Math.round(media.volume * 100)}%`);
  $('volume-value').classList.toggle('is-boosted', media.volume > 1);
  $('volume-boost-hint').hidden = media.volume <= 1 || !['active', 'paused'].includes(mic.status);
  $('resume-audio').hidden = mic.status !== 'paused';
  $('sound-advice').hidden = !micEngaged;
  $('mic-error').hidden = !mic.error;
  $('mic-error').textContent = mic.error ? t(mic.error) : '';
  $('camera-error').hidden = !camera.error || !audioOnly;
  $('camera-error').textContent = camera.error ? t(camera.error) : '';
  $('stop-all').disabled = !media.engaged;
  $('stop-all').title = t(media.engaged ? 'stopAll' : 'allOff');
  $('environment-error').hidden = !media.unavailable;
  $('environment-error').querySelector('p').textContent = media.unavailable ? t(media.unavailable) : '';
  $('fullscreen').disabled = !document.fullscreenEnabled;
  const fullscreenLabel = t(document.fullscreenElement ? 'exitFullscreen' : 'fullscreen');
  $('fullscreen').setAttribute('aria-label', fullscreenLabel);
  $('fullscreen').title = fullscreenLabel;
  $('fullscreen').innerHTML = icon(document.fullscreenElement ? 'shrink' : 'expand');
  $('fullscreen-error').hidden = !fullscreenError;
  $('fullscreen-error').textContent = fullscreenError ? t('errorFullscreen') : '';
  updateMeter();
  renderSound();
}

function drawMeter(time = 0) {
  if (time - lastMeterTime > 80 || time === 0) {
    const level = media.getLevel();
    if (level > 0.02) lastSignalTime = time;
    const detected = !media.microphone.muted && time - lastSignalTime < 1200;
    meters.forEach((meter) => meter.forEach((bar, index) => bar.classList.toggle('lit', index < Math.round(level * meter.length))));
    if (detected !== inputDetected) { inputDetected = detected; renderSound(); }
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
    inputDetected = false;
    lastSignalTime = -Infinity;
    meters.forEach((meter) => meter.forEach((bar) => bar.classList.remove('lit')));
  }
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $('language-label').textContent = language === 'en-US' ? '中文' : 'EN';
  $('language').setAttribute('aria-label', t('language'));
  $('language').title = t('language');
  $('controls').setAttribute('aria-label', t('controls'));
  video.setAttribute('aria-label', t('preview'));
  render();
}

$('language').addEventListener('click', () => { language = language === 'en-US' ? 'zh-CN' : 'en-US'; saveLanguage(storage, language); applyLanguage(); });
$('camera-button').addEventListener('click', () => isEngaged(media.camera) ? media.stopCamera() : media.startCamera());
for (const id of ['empty-start', 'add-camera']) $(id).addEventListener('click', () => { $('camera-button').focus({ preventScroll: true }); void media.startCamera(); });
$('camera-format').addEventListener('change', (event) => { void media.setCameraFormat(event.target.value); });
$('allow-crop').addEventListener('click', () => { $('camera-format').focus({ preventScroll: true }); void media.allowCameraCrop(); });
for (const name of ['camera', 'microphone']) $(`${name}-device`).addEventListener('change', (event) => { void media.selectDevice(name, event.target.value); });
$('microphone-switch').addEventListener('click', () => isEngaged(media.microphone) ? media.stopMicrophone() : media.startMicrophone());
$('stop-all').addEventListener('click', () => media.stopAll());
for (const id of ['resume-audio', 'diagnostic-resume']) $(id).addEventListener('click', () => {
  const nextFocus = id === 'diagnostic-resume' ? $('sound-dialog').querySelector('form button') : $('sound-help');
  nextFocus.focus({ preventScroll: true });
  void media.resumeAudio();
});
$('volume').addEventListener('input', (event) => { media.setVolume(Number(event.target.value) / 100); render(); });
$('fullscreen').addEventListener('click', async () => {
  try {
    fullscreenError = false;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('workspace').requestFullscreen();
  } catch { fullscreenError = true; }
  render();
});
document.addEventListener('fullscreenchange', render);
video.addEventListener('resize', render);
for (const [trigger, dialog] of [['guide-open', 'guide-dialog'], ['settings-open', 'settings-dialog'], ['sound-help', 'sound-dialog']]) {
  $(trigger).addEventListener('click', () => { if (dialog === 'settings-dialog') void media.refreshDevices(); $(dialog).showModal(); });
  $(dialog).addEventListener('click', (event) => {
    if (event.target !== $(dialog)) return;
    const rect = $(dialog).getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(dialog).close();
  });
}
document.addEventListener('visibilitychange', () => { updateMeter(); renderSound(); if (!document.hidden) void media.refreshDevices(); });
window.addEventListener('pagehide', () => media.stopAll());
if (import.meta.hot) import.meta.hot.dispose(() => { media.dispose(); cancelAnimationFrame(levelFrame); });
applyLanguage();
void media.watchPermissions();
void media.watchDevices();
