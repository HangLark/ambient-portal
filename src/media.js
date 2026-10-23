import { CameraFormatSession, CAMERA_FORMATS } from './camera-format.js';

const idleDevice = () => ({ status: 'idle', error: null, muted: false });
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());
export const isEngaged = (device) => ['requesting', 'active', 'paused'].includes(device.status);
export const DEFAULT_VOLUME = 0.35;
export const MAX_VOLUME = 2;

const rawAudio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const positive = (value) => Number.isFinite(value) && value > 0;

async function preferHighestAudioQuality(track) {
  if (!track.getCapabilities || !track.applyConstraints) return;
  try {
    const capabilities = track.getCapabilities();
    const constraints = { ...rawAudio, latency: { ideal: 0 } };
    for (const property of ['sampleRate', 'sampleSize', 'channelCount']) {
      const maximum = capabilities[property]?.max;
      if (positive(maximum)) constraints[property] = { ideal: maximum };
    }
    await track.applyConstraints(constraints);
  } catch {
    // Capabilities describe ranges, not every valid combination. Keep the working stream
    // if a driver rejects an upgrade; ended tracks and cancelled requests are checked by the caller.
  }
}

export function mediaErrorKey(error, device) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError': return 'errorPermission';
    case 'NotFoundError':
    case 'DevicesNotFoundError': return device === 'camera' ? 'errorCameraMissing' : 'errorMicMissing';
    case 'NotReadableError':
    case 'TrackStartError': return 'errorBusy';
    case 'OverconstrainedError': return 'errorConstraints';
    case 'AbortError': return 'errorDisconnected';
    default: return 'errorUnknown';
  }
}

/** Owns every media resource; UI sees state and explicit start/stop operations. */
export class MediaController {
  constructor({
    video,
    mediaDevices = globalThis.navigator?.mediaDevices,
    permissions = globalThis.navigator?.permissions,
    AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
    secure = globalThis.isSecureContext,
    cameraFormat = 'auto',
    onChange = () => {},
  }) {
    this.video = video;
    this.mediaDevices = mediaDevices;
    this.permissionAPI = permissions;
    this.AudioContext = AudioContext;
    this.onChange = onChange;
    this.unavailable = !secure ? 'errorInsecure' : !mediaDevices?.getUserMedia ? 'errorUnsupported' : null;
    this.camera = idleDevice();
    this.microphone = idleDevice();
    this.permissions = { camera: 'unknown', microphone: 'unknown' };
    this.volume = DEFAULT_VOLUME;
    this.unmutedVolume = DEFAULT_VOLUME;
    this.volumeReset = false;
    this.cameraRequest = 0;
    this.cameraFormat = CAMERA_FORMATS.some(({ id }) => id === cameraFormat) ? cameraFormat : 'auto';
    this.cameraFormats = null;
    this.microphoneRequest = 0;
    this.permissionListeners = [];
    this.devices = { camera: [], microphone: [] };
    this.selectedDevices = { camera: '', microphone: '' };
    this.deviceNames = new Map();
    this.deviceListError = false;
    this.deviceListRequest = 0;
    this.deviceChange = null;
    this.disposed = false;
  }

  get engaged() { return isEngaged(this.camera) || isEngaged(this.microphone); }

  get cameraFormatState() {
    return this.cameraFormats?.state || { selected: this.cameraFormat, busy: false, notice: null, fallback: null };
  }

  setCameraFormat(format) {
    if (this.disposed || !CAMERA_FORMATS.some(({ id }) => id === format)) return Promise.resolve();
    this.cameraFormat = format;
    if (this.cameraFormats) return this.cameraFormats.select(format);
    this.emit();
    return Promise.resolve();
  }

  allowCameraCrop() { return this.cameraFormats?.allowCrop() || Promise.resolve(); }

  emit() { if (!this.disposed) this.onChange(); }

  getSource(name) {
    const track = this[`${name}Stream`]?.getTracks()[0];
    const selected = this.selectedDevices[name];
    return {
      id: track?.getSettings().deviceId || selected,
      label: track?.label || this.deviceNames.get(`${name}:${selected}`) || '',
      missing: Boolean(selected && !track && !this.devices[name].some(({ id }) => id === selected)),
    };
  }

  async refreshDevices() {
    if (this.disposed || !this.mediaDevices?.enumerateDevices) return;
    const request = ++this.deviceListRequest;
    try {
      const devices = await this.mediaDevices.enumerateDevices();
      if (this.disposed || request !== this.deviceListRequest) return;
      for (const [name, kind] of [['camera', 'videoinput'], ['microphone', 'audioinput']]) {
        // Empty labels are permission placeholders, not a useful device picker.
        const inputs = devices.filter((device) => device.kind === kind && device.label && device.deviceId);
        const physical = inputs.filter((device) => !['default', 'communications'].includes(device.deviceId));
        this.devices[name] = inputs.filter((device) =>
          !['default', 'communications'].includes(device.deviceId) ||
          !physical.some((other) => device.groupId && other.groupId === device.groupId)
        ).map((device) => ({ id: device.deviceId, label: device.label }));
        for (const device of this.devices[name]) this.deviceNames.set(`${name}:${device.id}`, device.label);
      }
      this.deviceListError = false;
    } catch {
      if (this.disposed || request !== this.deviceListRequest) return;
      // A failed inventory must not clear a working source or interrupt capture.
      this.deviceListError = true;
    }
    this.emit();
  }

  watchDevices() {
    if (this.disposed || this.deviceChange) return;
    this.deviceChange = () => { void this.refreshDevices(); };
    this.mediaDevices?.addEventListener?.('devicechange', this.deviceChange);
    return this.refreshDevices();
  }

  selectDevice(name, id) {
    if (this.disposed || !['camera', 'microphone'].includes(name) || typeof id !== 'string') return Promise.resolve();
    if (id === this.selectedDevices[name]) return Promise.resolve();
    const restart = isEngaged(this[name]);
    this.selectedDevices[name] = id;
    // Release only this input before reopening: some drivers cannot open two cameras at once.
    // Existing request tokens also invalidate late permissions, format changes and audio callbacks.
    if (name === 'camera') this.stopCamera(false);
    else this.stopMicrophone(false);
    if (restart) return name === 'camera' ? this.startCamera() : this.startMicrophone();
    this.emit();
    return Promise.resolve();
  }

  async watchPermissions() {
    if (!this.permissionAPI?.query) return;
    await Promise.all(['camera', 'microphone'].map(async (name) => {
      try {
        const permission = await this.permissionAPI.query({ name });
        if (this.disposed) return;
        const update = () => {
          this.permissions[name] = permission.state;
          if (permission.state === 'denied' && isEngaged(this[name])) {
            this.fail(name, 'errorPermission');
          } else {
            this.emit();
          }
        };
        permission.addEventListener('change', update);
        this.permissionListeners.push(() => permission.removeEventListener('change', update));
        update();
      } catch { /* Camera/microphone permission queries are not supported everywhere. */ }
    }));
  }

  observeTrack(name, track, request) {
    const current = () => request === this[`${name}Request`];
    track.addEventListener('ended', () => {
      if (current()) this.fail(name, 'errorDisconnected');
    }, { once: true });
    const updateMute = () => {
      if (!current()) return;
      this[name].muted = track.muted;
      this.emit();
    };
    track.addEventListener('mute', updateMute);
    track.addEventListener('unmute', updateMute);
    this[name].muted = track.muted;
  }

  fail(name, error) {
    if (name === 'camera') this.stopCamera(false);
    else this.stopMicrophone(false);
    this[name] = { status: 'error', error, muted: false };
    if (error === 'errorPermission') this.permissions[name] = 'denied';
    this.emit();
  }

  async startCamera() {
    if (this.disposed || isEngaged(this.camera)) return;
    if (this.unavailable) return this.fail('camera', this.unavailable);
    const request = ++this.cameraRequest;
    this.camera = { status: 'requesting', error: null, muted: false };
    this.emit();
    let stream;
    let playing = false;
    try {
      stream = await this.mediaDevices.getUserMedia({
        video: {
          ...(this.selectedDevices.camera ? { deviceId: { exact: this.selectedDevices.camera } } : {}),
          width: { ideal: 3840 }, height: { ideal: 2160 },
          resizeMode: { ideal: 'none' },
        },
        audio: false,
      });
      // A permission prompt cannot be aborted. A late result must never revive a stopped session.
      if (request !== this.cameraRequest) return stopTracks(stream);
      this.cameraStream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') return this.fail('camera', 'errorDisconnected');
      this.observeTrack('camera', track, request);
      this.permissions.camera = 'granted';
      void this.refreshDevices();
      let supported;
      try { supported = this.mediaDevices.getSupportedConstraints?.(); } catch { /* Optional API. */ }
      this.cameraFormats = new CameraFormatSession(track, {
        supported,
        isCurrent: () => request === this.cameraRequest,
        onChange: () => {
          if (!this.cameraFormats.state.busy) this.cameraFormat = this.cameraFormats.state.selected;
          this.emit();
        },
      });
      await this.cameraFormats.select(this.cameraFormat);
      if (request !== this.cameraRequest) return stopTracks(stream);
      if (track.readyState === 'ended') return this.fail('camera', 'errorDisconnected');
      this.video.muted = true;
      this.video.srcObject = stream;
      playing = true;
      await this.video.play();
      if (request !== this.cameraRequest) return;
      this.camera.status = 'active';
      this.emit();
    } catch (error) {
      if (request !== this.cameraRequest) return stopTracks(stream);
      this.fail('camera', playing ? 'errorPlayback' : this.inputError(error, 'camera'));
    }
  }

  stopCamera(notify = true) {
    ++this.cameraRequest;
    this.cameraFormats = null;
    stopTracks(this.cameraStream);
    this.cameraStream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.camera = idleDevice();
    if (notify) this.emit();
  }

  async startMicrophone() {
    if (this.disposed || isEngaged(this.microphone)) return;
    if (this.unavailable) return this.fail('microphone', this.unavailable);
    if (!this.AudioContext) return this.fail('microphone', 'errorAudioUnsupported');
    // A new stream must not inherit a boost, including one hidden behind mute.
    // Preserve zero so restarting can never unmute playback on the user's behalf.
    this.volumeReset = this.volume > 1;
    if (this.volumeReset) this.volume = DEFAULT_VOLUME;
    if (this.unmutedVolume > 1) this.unmutedVolume = DEFAULT_VOLUME;
    const request = ++this.microphoneRequest;
    this.microphone = { status: 'requesting', error: null, muted: false };
    this.emit();
    let stream;
    let acquiring = false;
    try {
      // Create and resume inside the click gesture, before waiting for device permission.
      const context = new this.AudioContext({ latencyHint: 'interactive' });
      this.audioContext = context;
      void context.resume().catch(() => {});
      acquiring = true;
      stream = await this.mediaDevices.getUserMedia({
        audio: {
          ...(this.selectedDevices.microphone ? { deviceId: { exact: this.selectedDevices.microphone } } : {}),
          ...rawAudio,
          sampleRate: { ideal: 192000 },
          sampleSize: { ideal: 32 },
          channelCount: { ideal: 2 },
          latency: { ideal: 0 },
        },
        video: false,
      });
      if (request !== this.microphoneRequest) return stopTracks(stream);
      acquiring = false;
      this.microphoneStream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') return this.fail('microphone', 'errorDisconnected');
      this.observeTrack('microphone', track, request);
      this.permissions.microphone = 'granted';
      void this.refreshDevices();
      await preferHighestAudioQuality(track);
      if (request !== this.microphoneRequest) return stopTracks(stream);
      if (track.readyState === 'ended') return this.fail('microphone', 'errorDisconnected');
      this.source = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      this.samples = new Uint8Array(this.analyser.fftSize);
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      this.gain.gain.setTargetAtTime(this.volume, context.currentTime, 0.03);
      this.source.connect(this.analyser);
      this.analyser.connect(this.gain);
      this.gain.connect(context.destination);
      const updatePlayback = () => {
        if (request !== this.microphoneRequest) return;
        if (context.state === 'closed') return this.fail('microphone', 'errorAudio');
        this.microphone.status = context.state === 'running' ? 'active' : 'paused';
        this.emit();
      };
      context.onstatechange = updatePlayback;
      updatePlayback();
    } catch (error) {
      if (request !== this.microphoneRequest) return stopTracks(stream);
      this.fail('microphone', acquiring ? this.inputError(error, 'microphone') : 'errorAudio');
    }
  }

  async resumeAudio() {
    const context = this.audioContext;
    const request = this.microphoneRequest;
    if (!context) return;
    try {
      await context.resume();
      if (request !== this.microphoneRequest) return;
      this.microphone.status = context.state === 'running' ? 'active' : 'paused';
      this.emit();
    } catch {
      if (request === this.microphoneRequest) this.fail('microphone', 'errorAudio');
    }
  }

  inputError(error, name) {
    if (this.selectedDevices[name] && (error?.name === 'NotFoundError' ||
      (error?.name === 'OverconstrainedError' && error.constraint === 'deviceId'))) return 'errorSourceMissing';
    return mediaErrorKey(error, name);
  }

  setVolume(value) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.min(MAX_VOLUME, Math.max(0, value));
    this.volumeReset = false;
    if (this.volume > 0) this.unmutedVolume = this.volume;
    if (this.gain) {
      const gain = this.gain.gain;
      const time = this.audioContext.currentTime;
      gain.cancelScheduledValues(time);
      if (this.volume === 0) gain.setValueAtTime(0, time);
      else gain.setTargetAtTime(this.volume, time, 0.015);
    }
  }

  togglePlaybackMute() {
    if (!['active', 'paused'].includes(this.microphone.status)) return;
    this.setVolume(this.volume === 0 ? this.unmutedVolume : 0);
    this.emit();
  }

  getLevel() {
    if (!this.analyser || this.microphone.status !== 'active' || this.microphone.muted) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    const meanSquare = this.samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / this.samples.length;
    return Math.min(1, Math.sqrt(meanSquare) * 4);
  }

  stopMicrophone(notify = true) {
    ++this.microphoneRequest;
    stopTracks(this.microphoneStream);
    this.microphoneStream = null;
    for (const node of [this.source, this.analyser, this.gain]) node?.disconnect();
    if (this.audioContext) {
      this.audioContext.onstatechange = null;
      if (this.audioContext.state !== 'closed') void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.source = null;
    this.analyser = null;
    this.gain = null;
    this.samples = null;
    this.microphone = idleDevice();
    this.volumeReset = false;
    if (notify) this.emit();
  }

  stopAll() {
    this.stopCamera(false);
    this.stopMicrophone(false);
    this.emit();
  }

  dispose() {
    this.stopAll();
    this.disposed = true;
    this.permissionListeners.forEach((remove) => remove());
    this.permissionListeners = [];
    if (this.deviceChange) this.mediaDevices?.removeEventListener?.('devicechange', this.deviceChange);
    this.deviceChange = null;
  }
}
