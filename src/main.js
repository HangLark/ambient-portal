import './style.css';
import { icon } from './icons.js';
import { detectLanguage, saveLanguage, translate } from './i18n.js';
import { MediaController, isEngaged, DEFAULT_VOLUME, MAX_VOLUME } from './media.js';
import { CAMERA_FORMATS, cameraRatioLabel, cameraModeLabel, loadCameraFormat, saveCameraFormat } from './camera-format.js';

let storage;
try { storage = window.localStorage; } catch { /* Storage is optional. */ }
let language = detectLanguage(storage, navigator.languages || [navigator.language]);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let themePreference = document.documentElement.dataset.themePreference || 'system';
const themeOptions = [['system', 'themeSystem', 'monitor'], ['light', 'themeLight', 'sun'], ['dark', 'themeDark', 'moon']];
const t = (key) => translate(language, key);
const label = (key) => `<span data-i18n="${key}">${t(key)}</span>`;
const bars = (count) => '<i></i>'.repeat(count);
const closeButton = () => `<form method="dialog"><button class="text-button dialog-close" type="submit">${label('closeDialog')}</button></form>`;

document.querySelector('#app').innerHTML = `
  <a class="skip-link" href="#controls">${label('skip')}</a>
  <header class="site-header"><div class="header-inner">
    <a class="brand" href="#heading" aria-label="Ambient Portal">${icon('portal', 'brand-symbol')}<span>Ambient<span class="brand-light"> Portal</span></span></a>
    <div class="header-actions">
      <details class="theme-control" id="theme-control">
        <summary class="theme-button" id="theme-button"></summary>
        <fieldset class="theme-options"><legend>${label('theme')}</legend>
          ${themeOptions.map(([value, key, glyph]) => `<label><input type="radio" name="theme" value="${value}" />${icon(glyph)}${label(key)}</label>`).join('')}
        </fieldset>
      </details>
      <button class="language-button" id="language" type="button">${icon('globe')}<span id="language-label"></span></button>
    </div>
  </div></header>
  <main class="main-content">
    <section class="intro" aria-labelledby="heading"><h1 id="heading">${label('heading')}</h1><p class="intro-description">${label('intro')}</p></section>
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
          <button class="primary-button" id="empty-start" type="button">${icon('camera')}<span id="empty-action"></span></button>
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
          <div class="volume-group"><div class="volume-heading"><label for="volume">${label('volume')}</label><output for="volume" id="volume-value">${DEFAULT_VOLUME * 100}%</output></div><div class="volume-slider"><button class="icon-button mute-button" id="mute-playback" type="button" aria-describedby="playback-muted-help"></button><input id="volume" type="range" min="0" max="${MAX_VOLUME * 100}" value="${DEFAULT_VOLUME * 100}" step="1" aria-describedby="volume-boost-hint" /></div></div>
          <button class="stop-button" id="stop-all" type="button" disabled>${icon('stop')}${label('stopAll')}</button>
        </div>
        <div class="audio-status-row">
          <div class="input-status"><span class="level-meter" id="level-meter" aria-hidden="true">${bars(12)}</span><span id="mic-status"></span></div>
          <span class="playback-status" id="playback-status" role="status"></span>
          <button class="text-button resume-button" id="resume-audio" type="button" hidden>${icon('play')}${label('resumeAudio')}</button>
          <button class="text-button sound-help" id="sound-help" type="button">${icon('info')}${label('soundHelp')}</button>
        </div>
        <p class="sound-advice" id="sound-advice">${label('outputRoute')}</p>
        <p class="sound-advice" id="playback-muted-help" hidden>${label('playbackMutedHelp')}</p>
        <p class="notice" id="volume-reset-hint" role="status" hidden>${label('volumeResetHint')}</p>
        <p class="notice" id="volume-boost-hint" role="status" hidden>${label('volumeBoostHint')}</p>
        <p class="notice" id="mic-error" role="alert" hidden></p>
        <p class="notice" id="camera-error" role="alert" hidden></p>
        <p class="notice" id="picture-notice" role="status" hidden></p>
        <p class="notice" id="fullscreen-error" role="status" hidden></p>
      </section>
      <dialog id="playback-dialog" aria-labelledby="playback-title" aria-describedby="playback-intro playback-warning">
        <div class="dialog-heading">${icon('headphones')}<h2 id="playback-title">${label('playbackTitle')}</h2></div>
        <p id="playback-intro">${label('playbackIntro')}</p>
        <div class="dialog-note playback-route">${icon('volume')}<p>${label('outputRoute')}</p></div>
        <p>${label('playbackCheck')}</p><p id="playback-warning">${label('playbackWarning')}</p>
        <form method="dialog" class="dialog-actions">
          <button class="text-button" id="playback-cancel" type="submit" autofocus>${label('cancelPlayback')}</button>
          <button class="primary-button" id="playback-confirm" type="button">${label('confirmPlayback')}</button>
        </form>
      </dialog>
      <dialog id="settings-dialog" aria-labelledby="settings-title">
        <div class="dialog-heading">${icon('settings')}<h2 id="settings-title">${label('settingsTitle')}</h2></div>
        <p>${label('qualityDefault')}</p>
        ${['camera', 'microphone'].map((name) => `<section class="settings-section"><h3>${icon(name === 'camera' ? 'camera' : 'mic')}${label(name)}</h3><p class="source-name" id="${name}-source-name"></p><p class="notice" id="${name}-source-status" role="status" hidden></p><div class="source-picker" id="${name}-picker" hidden><label for="${name}-device">${label('sourceLabel')}</label><select id="${name}-device"></select></div>${name === 'camera' ? `
          <div class="format-control"><label for="camera-format">${label('formatLabel')}</label><select id="camera-format" aria-describedby="format-help format-notice">${CAMERA_FORMATS.map(({ id, label: key }) => `<option value="${id}" data-i18n="${key}">${t(key)}</option>`).join('')}</select><p id="format-help">${label('formatHelp')}</p><p class="notice" id="format-notice" role="status" hidden></p><button class="crop-button" id="allow-crop" type="button" aria-describedby="crop-help" hidden></button><p id="crop-help" hidden>${label('formatCropHelp')}</p></div>` : '<p class="capture-detail" id="audio-detail" hidden></p>'}</section>`).join('')}
        <p class="notice" id="devices-error" role="status" hidden>${label('devicesError')}</p><p class="settings-note">${label('sourceHelp')}</p>
        ${closeButton()}
      </dialog>
      <dialog id="sound-dialog" aria-labelledby="sound-title">
        <div class="dialog-heading">${icon('headphones')}<h2 id="sound-title">${label('soundHelp')}</h2></div>
        <p>${label('soundIntro')}</p><ol class="sound-checks">
          <li><h3>${label('checkInput')}</h3><p class="check-result" id="check-input" role="status"></p><p id="check-input-help"></p><button class="text-button" id="diagnostic-start" type="button" hidden>${icon('mic')}${label('startListening')}</button></li>
          <li><h3>${label('checkPlayback')}</h3><p class="check-result" id="check-playback" role="status"></p><p id="check-playback-help"></p><button class="text-button" id="diagnostic-resume" type="button" hidden>${icon('play')}${label('resumeAudio')}</button><button class="text-button" id="diagnostic-unmute" type="button" hidden>${icon('volume')}${label('restoreVolume')} ${DEFAULT_VOLUME * 100}%</button></li>
          <li><h3>${label('checkRemote')}</h3><p class="check-result">${label('remoteUnknown')}</p><p>${label('checkRemoteHelp')}</p></li>
        </ol><div class="dialog-note">${icon('headphones')}<p>${label('soundAdvice')}</p></div>${closeButton()}
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
let playbackConfirmed = false;
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
  const mic = media.microphone;
  const input = inputKey();
  const playback = playbackKey();
  $('mic-status').textContent = t(mic.error ? 'error' : input);
  $('playback-status').textContent = ['active', 'paused'].includes(mic.status) ? t(playback) : '';
  $('check-input').textContent = t(input);
  $('check-playback').textContent = t(playback);
  const inputHelp = mic.error ? 'checkInputError' : mic.status === 'requesting' ? 'micPendingBody'
    : !isEngaged(mic) ? 'checkInputStart' : mic.muted ? 'checkInputInterrupted'
      : mic.status === 'paused' ? 'checkInputPaused' : 'checkInputHelp';
  $('check-input-help').textContent = t(inputHelp);
  $('check-playback-help').textContent = t({ playbackOff: 'checkPlaybackOff', playbackMuted: 'checkPlaybackMuted', paused: 'checkPlaybackPaused', playbackRunning: 'checkPlaybackHelp' }[playback]);
  $('diagnostic-start').hidden = isEngaged(mic) || Boolean(media.unavailable);
  $('diagnostic-resume').hidden = mic.status !== 'paused';
  $('diagnostic-unmute').hidden = mic.status !== 'active' || media.volume !== 0;
  const sceneTitle = mic.status === 'requesting' ? 'micPendingTitle' : mic.muted ? 'inputInterrupted'
    : mic.status === 'paused' ? 'paused' : media.volume === 0 ? 'playbackMutedTitle' : 'listeningTitle';
  $('audio-scene-title').textContent = t(sceneTitle);
  $('scene-caption').textContent = t(mic.status === 'requesting' ? 'micPendingBody' : input);
  $('scene-meter').hidden = mic.status === 'requesting';
}

function renderSource(name) {
  const source = media.getSource(name);
  const device = media[name];
  const statusKey = device.error || (device.status === 'requesting' ? 'connecting' : device.muted ? 'interrupted' : device.status === 'paused' ? 'paused' : null)
    || (name === 'microphone' && media.volumeReset ? 'volumeResetHint' : null);
  $(`${name}-source-status`).hidden = !statusKey;
  $(`${name}-source-status`).textContent = statusKey ? t(statusKey) : '';
  const devices = media.devices[name];
  $(`${name}-source-name`).textContent = source.label || t(isEngaged(device) && device.status !== 'requesting' ? 'sourceUnnamed' : 'sourcePending');
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
  $(`${name}-source-name`).hidden = !hidePicker;
}

function render() {
  const camera = media.camera;
  const mic = media.microphone;
  const format = media.cameraFormatState;
  const cameraActive = camera.status === 'active';
  const cameraBusy = camera.status === 'requesting';
  const micEngaged = isEngaged(mic);
  const audioOnly = !cameraActive && !cameraBusy && micEngaged;
  const cameraState = camera.muted && cameraActive ? 'paused' : camera.status;
  document.querySelector('.intro').classList.toggle('is-compact', media.engaged);
  $('stage').dataset.state = cameraState;
  $('preview-name').textContent = t(audioOnly ? 'audioOnly' : 'preview');
  const stageKey = audioOnly ? (mic.status === 'requesting' ? 'connecting' : mic.muted ? 'interrupted' : mic.status === 'paused' ? 'paused' : media.volume === 0 ? 'playbackMutedShort' : 'listening')
    : format.busy ? 'formatSwitching' : { idle: 'standby', requesting: 'connecting', active: 'live', paused: 'interrupted', error: 'needsAttention' }[cameraState];
  $('preview-status').dataset.state = audioOnly ? (mic.status === 'active' && (mic.muted || media.volume === 0) ? 'paused' : mic.status) : format.busy ? 'requesting' : cameraState;
  $('preview-status-text').textContent = t(stageKey);
  $('empty-state').hidden = (cameraActive && !camera.muted) || audioOnly;
  $('audio-scene').hidden = !audioOnly;
  document.querySelector('.preview-footer').hidden = !cameraActive;
  document.querySelector('.input-status').hidden = audioOnly;
  const emptyKeys = cameraBusy ? [format.busy ? 'formatPendingTitle' : 'pendingTitle', format.busy ? 'formatPendingBody' : 'pendingBody', 'pendingHint']
    : camera.error ? ['errorTitle', camera.error, null]
    : camera.muted ? ['pausedTitle', 'pausedBody', null] : ['emptyTitle', 'emptyBody', 'emptyHint'];
  $('empty-title').textContent = t(emptyKeys[0]);
  $('empty-body').textContent = t(emptyKeys[1]);
  $('empty-hint').textContent = emptyKeys[2] ? t(emptyKeys[2]) : '';
  $('empty-hint').hidden = !emptyKeys[2] || Boolean(media.unavailable);
  $('empty-action').textContent = t(camera.error ? 'retryCamera' : 'startCamera');
  $('empty-start').hidden = cameraBusy || cameraActive;
  $('empty-start').disabled = Boolean(media.unavailable);
  $('portal-illustration').classList.toggle('is-pending', cameraBusy);
  const settings = media.cameraStream?.getVideoTracks()[0]?.getSettings();
  const frameRate = settings?.frameRate ? `${Math.round(settings.frameRate * 10) / 10} ${t('fps')}` : '';
  $('preview-detail').textContent = cameraActive && settings?.width && settings?.height
    ? [`${settings.width} × ${settings.height}`, frameRate, cameraRatioLabel(settings), t(cameraModeLabel(settings))].filter(Boolean).join(' · ') : t('captureUnknown');
  $('preview-detail').title = cameraActive ? t('formatModeHelp') : '';
  $('camera-source').textContent = cameraActive ? media.getSource('camera').label : '';
  const audioSource = media.getSource('microphone');
  $('audio-source').textContent = audioSource.label || t('sourceUnnamed');
  $('audio-source').hidden = mic.status === 'requesting' && !audioSource.label;
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
  $('crop-help').hidden = !format.fallback;
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
  const playbackMuted = media.volume === 0;
  const muteLabel = playbackMuted ? `${t('unmutePlayback')} · ${Math.round(media.unmutedVolume * 100)}%` : t('mutePlayback');
  $('mute-playback').disabled = $('volume').disabled;
  $('mute-playback').dataset.muted = String(playbackMuted);
  $('mute-playback').setAttribute('aria-label', muteLabel);
  if (playbackMuted && micEngaged) $('mute-playback').setAttribute('aria-describedby', 'playback-muted-help');
  else $('mute-playback').removeAttribute('aria-describedby');
  $('mute-playback').title = muteLabel;
  $('mute-playback').innerHTML = icon(playbackMuted ? 'volumeOff' : 'volume');
  $('playback-muted-help').hidden = !micEngaged || !playbackMuted;
  $('volume-reset-hint').hidden = !micEngaged || !media.volumeReset;
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

function applyTheme() {
  const root = document.documentElement;
  const theme = themePreference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themePreference;
  root.dataset.themePreference = themePreference;
  root.dataset.theme = theme;
  const [, key, glyph] = themeOptions.find(([value]) => value === themePreference);
  const current = `${t('theme')}: ${t(key)}${themePreference === 'system' ? ` · ${t(theme === 'dark' ? 'themeDark' : 'themeLight')}` : ''}`;
  $('theme-button').innerHTML = icon(glyph);
  $('theme-button').setAttribute('aria-label', current);
  $('theme-button').title = current;
  document.querySelectorAll('input[name="theme"]').forEach((input) => { input.checked = input.value === themePreference; });
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--page-bg').trim();
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
  applyTheme();
  render();
}

document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener('change', () => {
  themePreference = input.value;
  try { storage?.setItem('ambient-portal.theme', themePreference); } catch { /* Keep the choice for this session. */ }
  applyTheme();
}));
const followSystemTheme = () => { if (themePreference === 'system') applyTheme(); };
systemTheme.addEventListener('change', followSystemTheme);
const dismissTheme = (event) => { if (!$('theme-control').contains(event.target)) $('theme-control').open = false; };
const closeThemeWithEscape = (event) => {
  if (event.key === 'Escape' && $('theme-control').open) {
    $('theme-control').open = false;
    $('theme-button').focus({ preventScroll: true });
  }
};
document.addEventListener('click', dismissTheme);
document.addEventListener('keydown', closeThemeWithEscape);
$('theme-control').addEventListener('focusout', (event) => {
  if (event.relatedTarget && !$('theme-control').contains(event.relatedTarget)) $('theme-control').open = false;
});
$('language').addEventListener('click', () => { language = language === 'en-US' ? 'zh-CN' : 'en-US'; saveLanguage(storage, language); applyLanguage(); });
$('camera-button').addEventListener('click', () => isEngaged(media.camera) ? media.stopCamera() : media.startCamera());
for (const id of ['empty-start', 'add-camera']) $(id).addEventListener('click', () => { $('camera-button').focus({ preventScroll: true }); void media.startCamera(); });
$('camera-format').addEventListener('change', (event) => { void media.setCameraFormat(event.target.value); });
$('allow-crop').addEventListener('click', () => { $('camera-format').focus({ preventScroll: true }); void media.allowCameraCrop(); });
for (const name of ['camera', 'microphone']) $(`${name}-device`).addEventListener('change', (event) => { void media.selectDevice(name, event.target.value); });
function startListening() {
  // The confirmation click retains user activation for AudioContext.resume().
  const focusTarget = $('sound-dialog').open ? $('sound-dialog').querySelector('form button') : $('microphone-switch');
  focusTarget.focus({ preventScroll: true });
  void media.startMicrophone();
}

function requestListening() {
  if (playbackConfirmed) startListening();
  else $('playback-dialog').showModal();
}

$('playback-confirm').addEventListener('click', () => {
  playbackConfirmed = true;
  $('playback-dialog').close();
  startListening();
});
$('microphone-switch').addEventListener('click', () => isEngaged(media.microphone) ? media.stopMicrophone() : requestListening());
$('stop-all').addEventListener('click', () => media.stopAll());
$('diagnostic-start').addEventListener('click', requestListening);
$('diagnostic-unmute').addEventListener('click', () => {
  $('sound-dialog').querySelector('form button').focus({ preventScroll: true });
  media.setVolume(DEFAULT_VOLUME);
  render();
});
for (const id of ['resume-audio', 'diagnostic-resume']) $(id).addEventListener('click', () => {
  const nextFocus = id === 'diagnostic-resume' ? $('sound-dialog').querySelector('form button') : $('sound-help');
  nextFocus.focus({ preventScroll: true });
  void media.resumeAudio();
});
$('volume').addEventListener('input', (event) => { media.setVolume(Number(event.target.value) / 100); render(); });
$('mute-playback').addEventListener('click', () => media.togglePlaybackMute());
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
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
document.addEventListener('visibilitychange', () => { updateMeter(); renderSound(); if (!document.hidden) void media.refreshDevices(); });
window.addEventListener('pagehide', () => {
  playbackConfirmed = false;
  $('playback-dialog').close();
  media.stopAll();
});
if (import.meta.hot) import.meta.hot.dispose(() => {
  media.dispose(); cancelAnimationFrame(levelFrame);
  systemTheme.removeEventListener('change', followSystemTheme);
  document.removeEventListener('click', dismissTheme);
  document.removeEventListener('keydown', closeThemeWithEscape);
});
applyLanguage();
void media.watchPermissions();
void media.watchDevices();
