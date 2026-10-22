import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaController } from '../src/media.js';

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
  const play = deferred();
  const { controller, video, captured } = setup();
  video.play = () => play.promise;
  const starting = controller.startCamera();
  await Promise.resolve();
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
