import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaController } from '../src/media.js';
import { cameraStream } from './helpers/camera.js';

class Track extends EventTarget {
  readyState = 'live';
  muted = false;
  stops = 0;
  stop() { this.readyState = 'ended'; this.stops++; }
  getSettings() { return { width: 1280, height: 720 }; }
}

function stream(kind = 'video') {
  const track = new Track();
  return {
    track,
    getTracks: () => [track],
    getVideoTracks: () => kind === 'video' ? [track] : [],
    getAudioTracks: () => kind === 'audio' ? [track] : [],
  };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class AudioNode {
  connections = [];
  disconnected = false;
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; }
}

class AudioContext {
  static instances = [];
  state = 'suspended';
  destination = {};
  currentTime = 0;
  resumes = 0;
  closes = 0;
  constructor() { AudioContext.instances.push(this); }
  async resume() { this.resumes++; this.state = 'running'; this.onstatechange?.(); }
  async close() { this.closes++; this.state = 'closed'; }
  createMediaStreamSource() { return new AudioNode(); }
  createAnalyser() {
    const node = new AudioNode();
    node.getByteTimeDomainData = (data) => data.fill(128);
    return node;
  }
  createGain() {
    const node = new AudioNode();
    node.gain = { value: 1, setTargetAtTime: (value) => { node.gain.value = value; } };
    return node;
  }
}

function setup(options = {}) {
  const video = { muted: false, srcObject: null, play: async () => {}, pause() {} };
  const captured = [];
  const mediaDevices = { getUserMedia: async (constraints) => {
    const result = stream(constraints.audio ? 'audio' : 'video');
    captured.push({ constraints, stream: result });
    return result;
  } };
  const controller = new MediaController({ video, mediaDevices, AudioContext, secure: true, permissions: null, ...options });
  return { controller, video, captured };
}

test('camera requests video only and plays a muted direct stream; stop releases it', async () => {
  const { controller, video, captured } = setup();
  await controller.startCamera();
  assert.equal(controller.camera.status, 'active');
  assert.equal(captured[0].constraints.audio, false);
  assert.equal(video.srcObject, captured[0].stream);
  assert.equal(video.muted, true);
  assert.equal(controller.microphone.status, 'idle');
  controller.stopAll();
  assert.equal(captured[0].stream.track.readyState, 'ended');
  assert.equal(video.srcObject, null);
  assert.equal(controller.engaged, false);
});

test('cancelled permission requests release tracks that arrive later', async () => {
  const pending = deferred();
  const { controller, video } = setup({ mediaDevices: { getUserMedia: () => pending.promise } });
  const starting = controller.startCamera();
  assert.equal(controller.camera.status, 'requesting');
  controller.stopAll();
  const late = stream();
  pending.resolve(late);
  await starting;
  assert.equal(late.track.readyState, 'ended');
  assert.equal(controller.camera.status, 'idle');
  assert.equal(video.srcObject, null);
});

test('an old request cannot replace a newer active camera session', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const { controller, video } = setup({ mediaDevices: { getUserMedia: () => (++calls === 1 ? first : second).promise } });
  const a = controller.startCamera();
  controller.stopCamera();
  const b = controller.startCamera();
  const current = stream(), stale = stream();
  second.resolve(current);
  await b;
  first.resolve(stale);
  await a;
  assert.equal(stale.track.readyState, 'ended');
  assert.equal(current.track.readyState, 'live');
  assert.equal(video.srcObject, current);
  assert.equal(controller.camera.status, 'active');
  controller.dispose();
});

test('cancelled requests cannot replace idle state with a late rejection', async () => {
  const pending = deferred();
  const { controller } = setup({ mediaDevices: { getUserMedia: () => pending.promise } });
  const starting = controller.startCamera();
  controller.stopAll();
  pending.reject({ name: 'NotAllowedError' });
  await starting;
  assert.equal(controller.camera.status, 'idle');
  assert.equal(controller.camera.error, null);
});

test('stopping during video.play never revives the preview', async () => {
  const play = deferred(), entered = deferred();
  const { controller, video, captured } = setup();
  video.play = () => { entered.resolve(); return play.promise; };
  const starting = controller.startCamera();
  await entered.promise;
  controller.stopCamera();
  play.resolve();
  await starting;
  assert.equal(controller.camera.status, 'idle');
  assert.equal(video.srcObject, null);
  assert.equal(captured[0].stream.track.readyState, 'ended');
});

test('camera playback failure releases its acquired stream', async () => {
  const { controller, video, captured } = setup();
  video.play = async () => { throw new Error('Playback failed'); };
  await controller.startCamera();
  assert.equal(controller.camera.error, 'errorPlayback');
  assert.equal(captured[0].stream.track.readyState, 'ended');
  assert.equal(video.srcObject, null);
});

test('microphone resumes audio in the user gesture before awaiting permission', async () => {
  const pending = deferred();
  const { controller } = setup({ mediaDevices: { getUserMedia: () => pending.promise } });
  const starting = controller.startMicrophone();
  const context = controller.audioContext;
  assert.equal(context.resumes, 1);
  assert.equal(controller.camera.status, 'idle');
  pending.resolve(stream('audio'));
  await starting;
  assert.equal(controller.microphone.status, 'active');
  assert.equal(controller.gain.gain.value, 0.35);
  assert.deepEqual(controller.gain.connections, [context.destination]);
  controller.setVolume(0.7);
  assert.equal(controller.gain.gain.value, 0.7);
  assert.equal(controller.getLevel(), 0);
  const source = controller.source;
  controller.stopMicrophone();
  assert.equal(context.closes, 1);
  assert.equal(source.disconnected, true);
  assert.equal(controller.audioContext, null);
});

test('microphone cancellation closes audio immediately and stops a late stream', async () => {
  const pending = deferred();
  const { controller } = setup({ mediaDevices: { getUserMedia: () => pending.promise } });
  const starting = controller.startMicrophone();
  const context = controller.audioContext;
  controller.stopAll();
  assert.equal(context.state, 'closed');
  const late = stream('audio');
  pending.resolve(late);
  await starting;
  assert.equal(late.track.readyState, 'ended');
  assert.equal(controller.microphone.status, 'idle');
});

test('permission rejection closes the pending audio context', async () => {
  const pending = deferred();
  const { controller } = setup({ mediaDevices: { getUserMedia: () => pending.promise } });
  const starting = controller.startMicrophone();
  const context = controller.audioContext;
  pending.reject({ name: 'NotAllowedError' });
  await starting;
  assert.equal(controller.microphone.error, 'errorPermission');
  assert.equal(context.state, 'closed');
  assert.equal(controller.permissions.microphone, 'denied');
});

test('audio graph failures release both audio context and microphone tracks', async () => {
  class BrokenContext extends AudioContext {
    createMediaStreamSource() { throw new Error('Cannot create source'); }
  }
  const { controller, captured } = setup({ AudioContext: BrokenContext });
  await controller.startMicrophone();
  assert.equal(controller.microphone.error, 'errorAudio');
  assert.equal(captured[0].stream.track.readyState, 'ended');
  assert.equal(controller.audioContext, null);
});

test('autoplay restrictions expose a paused state and can be resumed', async () => {
  class RestrictedContext extends AudioContext {
    async resume() {
      this.resumes++;
      if (this.resumes > 1) { this.state = 'running'; this.onstatechange?.(); }
    }
  }
  const { controller } = setup({ AudioContext: RestrictedContext });
  await controller.startMicrophone();
  assert.equal(controller.microphone.status, 'paused');
  await controller.resumeAudio();
  assert.equal(controller.microphone.status, 'active');
  controller.dispose();
});

test('device disconnect releases that device while the other keeps running', async () => {
  const { controller, captured } = setup();
  await controller.startCamera();
  await controller.startMicrophone();
  captured[0].stream.track.dispatchEvent(new Event('ended'));
  assert.equal(controller.camera.error, 'errorDisconnected');
  assert.equal(controller.microphone.status, 'active');
  captured[1].stream.track.dispatchEvent(new Event('ended'));
  assert.equal(controller.microphone.error, 'errorDisconnected');
  assert.equal(controller.audioContext, null);
});

test('permission revocation stops an active device and listeners are removed on disposal', async () => {
  const permission = new EventTarget();
  permission.state = 'granted';
  const { controller, captured } = setup({ permissions: { query: async () => permission } });
  await controller.watchPermissions();
  await controller.startCamera();
  permission.state = 'denied';
  permission.dispatchEvent(new Event('change'));
  assert.equal(captured[0].stream.track.readyState, 'ended');
  assert.equal(controller.camera.error, 'errorPermission');
  controller.dispose();
  permission.state = 'granted';
  permission.dispatchEvent(new Event('change'));
  assert.equal(controller.permissions.camera, 'denied');
});

test('track mute is visible and unmute restores the active signal', async () => {
  const { controller, captured } = setup();
  await controller.startCamera();
  captured[0].stream.track.muted = true;
  captured[0].stream.track.dispatchEvent(new Event('mute'));
  assert.equal(controller.camera.muted, true);
  captured[0].stream.track.muted = false;
  captured[0].stream.track.dispatchEvent(new Event('unmute'));
  assert.equal(controller.camera.muted, false);
  controller.dispose();
});

for (const [errorName, key] of [['NotAllowedError', 'errorPermission'], ['NotFoundError', 'errorCameraMissing'], ['NotReadableError', 'errorBusy'], ['OverconstrainedError', 'errorConstraints'], ['AbortError', 'errorDisconnected'], ['OtherError', 'errorUnknown']]) {
  test(`${errorName} has a recoverable localized error state`, async () => {
    const { controller } = setup({ mediaDevices: { getUserMedia: async () => { throw { name: errorName }; } } });
    await controller.startCamera();
    assert.equal(controller.camera.error, key);
    assert.equal(controller.engaged, false);
  });
}

test('insecure and unsupported environments never request devices', async () => {
  const { controller, captured } = setup({ secure: false });
  await controller.startCamera();
  await controller.startMicrophone();
  assert.equal(captured.length, 0);
  assert.equal(controller.camera.error, 'errorInsecure');
  const unsupported = setup({ mediaDevices: null }).controller;
  await unsupported.startCamera();
  assert.equal(unsupported.camera.error, 'errorUnsupported');
});

test('repeated starts do not allocate duplicate streams and stop is idempotent', async () => {
  const { controller, captured } = setup();
  await Promise.all([controller.startCamera(), controller.startCamera()]);
  await Promise.all([controller.startMicrophone(), controller.startMicrophone()]);
  assert.equal(captured.length, 2);
  controller.stopAll();
  controller.stopAll();
  assert.ok(captured.every(({ stream }) => stream.track.stops === 1));
});

test('camera prioritizes native resolution above 4K before maximizing frame rate at that resolution', async () => {
  const input = stream();
  const applied = [];
  let settings = { width: 3840, height: 2160, frameRate: 60 };
  input.track.getCapabilities = () => ({
    width: { max: 7680 }, height: { max: 4320 }, frameRate: { max: 120 },
    resizeMode: ['none', 'crop-and-scale'],
  });
  input.track.getSettings = () => settings;
  input.track.applyConstraints = async (constraints) => {
    applied.push(constraints);
    if (constraints.frameRate) {
      // This camera supports 120 fps only at lower resolutions, and 30 fps at 8K.
      assert.equal(constraints.width.exact, 7680);
      assert.equal(constraints.height.exact, 4320);
      assert.equal(constraints.frameRate.ideal, 120);
      settings = { width: 7680, height: 4320, frameRate: 30 };
    } else {
      assert.equal(constraints.width.ideal, 7680);
      assert.equal(constraints.height.ideal, 4320);
      assert.equal(constraints.resizeMode.exact, 'none');
      settings = { width: 7680, height: 4320, frameRate: 15 };
    }
  };
  const { controller, video } = setup({ mediaDevices: { getUserMedia: async () => input } });
  await controller.startCamera();
  assert.equal(applied.length, 2);
  assert.equal(controller.camera.status, 'active');
  assert.equal(video.srcObject, input);
  assert.deepEqual(input.track.getSettings(), { width: 7680, height: 4320, frameRate: 30 });
  controller.dispose();
});

test('microphone requests unprocessed capture at the highest reported audio specifications', async () => {
  const input = stream('audio');
  const applied = [];
  let requested;
  input.track.getCapabilities = () => ({
    sampleRate: { max: 96000 }, sampleSize: { max: 24 }, channelCount: { max: 4 },
  });
  input.track.applyConstraints = async (constraints) => { applied.push(constraints); };
  const { controller } = setup({ mediaDevices: { getUserMedia: async (constraints) => {
    requested = constraints;
    return input;
  } } });
  await controller.startMicrophone();
  assert.equal(controller.microphone.status, 'active');
  assert.equal(requested.video, false);
  for (const constraints of [requested.audio, ...applied]) {
    assert.equal(constraints.echoCancellation, false);
    assert.equal(constraints.noiseSuppression, false);
    assert.equal(constraints.autoGainControl, false);
  }
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].sampleRate, { ideal: 96000 });
  assert.deepEqual(applied[0].sampleSize, { ideal: 24 });
  assert.deepEqual(applied[0].channelCount, { ideal: 4 });
  controller.dispose();
});

for (const kind of ['video', 'audio']) {
  const device = kind === 'video' ? 'camera' : 'microphone';
  const start = kind === 'video' ? 'startCamera' : 'startMicrophone';

  test(`${device} keeps a usable stream when a quality upgrade is rejected`, async () => {
    const input = stream(kind);
    input.track.getCapabilities = () => ({ width: { max: 7680 }, height: { max: 4320 } });
    input.track.applyConstraints = async () => { throw { name: 'OverconstrainedError' }; };
    const { controller } = setup({ mediaDevices: { getUserMedia: async () => input } });
    await controller[start]();
    assert.equal(controller[device].status, 'active');
    assert.equal(input.track.readyState, 'live');
    controller.dispose();
    assert.equal(input.track.readyState, 'ended');
  });

  test(`stopping ${device} during quality negotiation releases resources and cannot replace a new session`, async () => {
    const upgrading = deferred(), entered = deferred();
    const old = stream(kind), current = stream(kind);
    let calls = 0, upgrades = 0;
    old.track.getCapabilities = () => ({ width: { max: 7680 }, frameRate: { max: 120 } });
    old.track.applyConstraints = () => { upgrades++; entered.resolve(); return upgrading.promise; };
    const { controller, video } = setup({ mediaDevices: { getUserMedia: async () => ++calls === 1 ? old : current } });
    const starting = controller[start]();
    await entered.promise;
    const oldContext = controller.audioContext;
    controller.stopAll();
    assert.equal(old.track.readyState, 'ended');
    assert.equal(video.srcObject, null);
    assert.equal(controller.audioContext, null);
    if (oldContext) assert.equal(oldContext.state, 'closed');
    await controller[start]();
    const currentContext = controller.audioContext;
    upgrading.resolve();
    await starting;
    assert.equal(upgrades, 1);
    assert.equal(controller[device].status, 'active');
    assert.equal(current.track.readyState, 'live');
    if (kind === 'video') assert.equal(video.srcObject, current);
    else {
      assert.equal(controller.microphoneStream, current);
      assert.equal(controller.audioContext, currentContext);
      assert.equal(currentContext.state, 'running');
    }
    controller.dispose();
  });

  test(`${device} disconnect during quality negotiation stays disconnected`, async () => {
    const upgrading = deferred(), entered = deferred();
    const input = stream(kind);
    input.track.getCapabilities = () => ({ width: { max: 3840 } });
    input.track.applyConstraints = () => { entered.resolve(); return upgrading.promise; };
    const { controller, video } = setup({ mediaDevices: { getUserMedia: async () => input } });
    const starting = controller[start]();
    await entered.promise;
    input.track.readyState = 'ended';
    input.track.dispatchEvent(new Event('ended'));
    upgrading.resolve();
    await starting;
    assert.equal(controller[device].error, 'errorDisconnected');
    assert.equal(video.srcObject, null);
    assert.ok(!controller.audioContext);
  });
}

test('playback gain reaches 200%, is bounded, and survives an in-session microphone restart', async () => {
  const { controller } = setup();
  await controller.startMicrophone();
  assert.equal(controller.gain.gain.value, 0.35);
  controller.setVolume(2);
  assert.equal(controller.gain.gain.value, 2);
  controller.setVolume(3);
  assert.equal(controller.volume, 2);
  assert.equal(controller.gain.gain.value, 2);
  controller.setVolume(NaN);
  assert.equal(controller.volume, 2);
  controller.stopMicrophone();
  await controller.startMicrophone();
  assert.equal(controller.gain.gain.value, 2);
  controller.setVolume(-1);
  assert.equal(controller.gain.gain.value, 0);
  controller.dispose();
});

test('ratio selection while permission is pending uses the latest preference without another device request', async () => {
  const permission = deferred();
  const input = cameraStream();
  let captures = 0;
  const { controller } = setup({ cameraFormat: '16:9', mediaDevices: { getUserMedia: () => {
    captures++;
    return permission.promise;
  } } });
  const starting = controller.startCamera();
  await controller.setCameraFormat('4:3');
  permission.resolve(input);
  await starting;
  assert.equal(captures, 1);
  assert.equal(controller.cameraFormatState.selected, '4:3');
  assert.equal(input.track.getSettings().width, 1760);
  controller.dispose();
});

test('switching active formats preserves track observers and microphone playback', async () => {
  const input = cameraStream(), mic = stream('audio');
  let captures = 0;
  const { controller, video } = setup({ mediaDevices: { getUserMedia: async (constraints) => {
    captures++;
    return constraints.audio ? mic : input;
  } } });
  await controller.startMicrophone();
  const context = controller.audioContext;
  await controller.startCamera();
  await controller.setCameraFormat('16:9');
  await controller.setCameraFormat('4:3');
  assert.equal(captures, 2);
  assert.equal(video.srcObject, input);
  assert.equal(controller.audioContext, context);
  assert.equal(controller.microphone.status, 'active');
  input.track.muted = true;
  input.track.dispatchEvent(new Event('mute'));
  assert.equal(controller.camera.muted, true);
  input.track.stop();
  input.track.dispatchEvent(new Event('ended'));
  assert.equal(controller.camera.error, 'errorDisconnected');
  assert.equal(controller.microphone.status, 'active');
  controller.dispose();
});

test('stopping an active format switch invalidates its queue without affecting a restarted session', async () => {
  const old = cameraStream(), current = cameraStream();
  let captures = 0;
  const { controller, video } = setup({ mediaDevices: { getUserMedia: async () => ++captures === 1 ? old : current } });
  await controller.startCamera();
  const entered = deferred(), release = deferred();
  let changes = 0;
  old.track.applyConstraints = async () => { changes++; entered.resolve(); await release.promise; };
  const switching = controller.setCameraFormat('16:9');
  await entered.promise;
  const pending = controller.setCameraFormat('4:3');
  controller.stopCamera();
  assert.equal(old.track.readyState, 'ended');
  await controller.startCamera();
  assert.equal(controller.cameraFormatState.selected, '4:3');
  release.resolve();
  await Promise.all([switching, pending]);
  assert.equal(changes, 1);
  assert.equal(video.srcObject, current);
  assert.equal(controller.camera.status, 'active');
  assert.equal(controller.cameraFormatState.selected, '4:3');
  controller.dispose();
});
