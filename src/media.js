const idleDevice = () => ({ status: 'idle', error: null, muted: false });
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());
const isEngaged = (device) => ['requesting', 'active', 'paused'].includes(device.status);

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
    this.volume = 0.35;
    this.cameraRequest = 0;
    this.microphoneRequest = 0;
    this.permissionListeners = [];
    this.disposed = false;
  }

  get engaged() { return isEngaged(this.camera) || isEngaged(this.microphone); }

  emit() { if (!this.disposed) this.onChange(); }

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
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      // A permission prompt cannot be aborted. A late result must never revive a stopped session.
      if (request !== this.cameraRequest) return stopTracks(stream);
      this.cameraStream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') return this.fail('camera', 'errorDisconnected');
      this.observeTrack('camera', track, request);
      this.permissions.camera = 'granted';
      this.video.muted = true;
      this.video.srcObject = stream;
      playing = true;
      await this.video.play();
      if (request !== this.cameraRequest) return;
      this.camera.status = 'active';
      this.emit();
    } catch (error) {
      if (request !== this.cameraRequest) return stopTracks(stream);
      this.fail('camera', playing ? 'errorPlayback' : mediaErrorKey(error, 'camera'));
    }
  }

  stopCamera(notify = true) {
    ++this.cameraRequest;
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: { ideal: 1 },
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
      this.source = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      this.samples = new Uint8Array(this.analyser.fftSize);
      this.gain = context.createGain();
      this.gain.gain.value = this.volume;
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
      this.fail('microphone', acquiring ? mediaErrorKey(error, 'microphone') : 'errorAudio');
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

  setVolume(value) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.min(1, Math.max(0, value));
    if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.015);
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
  }
}
