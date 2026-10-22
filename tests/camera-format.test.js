import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraFormatSession, cameraRatioLabel, cameraModeLabel, loadCameraFormat, saveCameraFormat } from '../src/camera-format.js';
import { CameraTrack, deferred } from './helpers/camera.js';

for (const [format, width, height] of [['auto', 1552, 1552], ['16:9', 1920, 1080], ['4:3', 1760, 1328], ['1:1', 1552, 1552]]) {
  test(`${format} negotiates a native driver mode rather than assuming capability maxima coexist`, async () => {
    const track = new CameraTrack();
    const session = new CameraFormatSession(track);
    await session.select(format);
    assert.equal(session.state.selected, format);
    assert.equal(session.state.notice, null);
    assert.equal(track.getSettings().width, width);
    assert.equal(track.getSettings().height, height);
    assert.equal(cameraModeLabel(track.getSettings()), 'formatNative');
    assert.equal(track.calls.length, 2);
    const [resolution, fps] = track.calls;
    assert.equal(resolution.frameRate, undefined);
    assert.equal(fps.width.exact, width);
    assert.equal(fps.height.exact, height);
    assert.deepEqual(fps.resizeMode, resolution.resizeMode);
    assert.deepEqual(fps.aspectRatio, resolution.aspectRatio);
    assert.equal(fps.frameRate.ideal, 60);
  });
}

test('unsupported native ratio retains the picture, and cropping needs a separate explicit action', async () => {
  const track = new CameraTrack();
  const session = new CameraFormatSession(track);
  await session.select('16:9');
  const before = track.getSettings();
  await session.select('9:16');
  assert.equal(session.state.selected, '16:9');
  assert.equal(session.state.notice, 'formatUnavailable');
  assert.equal(session.state.fallback, '9:16');
  assert.deepEqual(track.getSettings(), before);
  assert.ok(track.calls.every((constraints) => constraints.resizeMode.exact === 'none'));
  await session.allowCrop();
  assert.equal(session.state.selected, '9:16');
  assert.equal(session.state.notice, null);
  assert.equal(session.state.fallback, null);
  assert.equal(cameraRatioLabel(track.getSettings()), '9:16');
  assert.equal(cameraModeLabel(track.getSettings()), 'formatAdapted');
  assert.equal(track.getConstraints().resizeMode.exact, 'crop-and-scale');
  await session.select('1:1');
  assert.equal(track.getSettings().resizeMode, 'none');
});

test('an ignored aspect-ratio constraint is not success, and rollback restores the prior full constraints', async () => {
  const track = new CameraTrack();
  const session = new CameraFormatSession(track);
  await session.select('1:1');
  const before = track.getSettings();
  const apply = track.applyConstraints.bind(track);
  let ignored = false;
  track.applyConstraints = async (constraints) => {
    if (!ignored) {
      ignored = true;
      track.constraints = constraints;
      track.settings = { width: 1280, height: 720, frameRate: 30, resizeMode: 'none' };
    } else await apply(constraints);
  };
  await session.select('4:3');
  assert.equal(session.state.selected, '1:1');
  assert.equal(session.state.notice, 'formatUnavailable');
  assert.deepEqual(track.getSettings(), before);
  assert.equal(track.getConstraints().resizeMode.exact, 'none');
  assert.equal(track.getConstraints().width.exact, 1552);
  assert.equal(track.getConstraints().aspectRatio.min, 0.99);
});

test('unreported resize mode cannot be presented as verified native capture', async () => {
  const track = new CameraTrack();
  track.getSettings = () => ({ width: 1552, height: 1552, frameRate: 30 });
  const session = new CameraFormatSession(track);
  await session.select('1:1');
  assert.equal(session.state.selected, 'auto');
  assert.equal(session.state.notice, 'formatUnavailable');
  assert.equal(cameraModeLabel(track.getSettings()), 'formatUnknown');
});

test('missing constraint APIs and explicitly unsupported resize control degrade honestly', async () => {
  for (const unsupported of ['api', 'resize']) {
    const track = new CameraTrack();
    if (unsupported === 'api') track.applyConstraints = undefined;
    const session = new CameraFormatSession(track, { supported: { resizeMode: false } });
    await session.select('1:1');
    assert.equal(session.state.notice, 'formatUnavailable');
    assert.equal(session.state.fallback, null);
    assert.equal(track.calls.length, 0);
    await session.select('auto');
    assert.equal(session.state.notice, null);
    assert.equal(session.state.selected, 'auto');
  }
});

test('a rejected frame-rate upgrade preserves the negotiated resolution', async () => {
  const track = new CameraTrack();
  const apply = track.applyConstraints.bind(track);
  track.applyConstraints = async (constraints) => {
    if (constraints.frameRate) throw new Error('FPS upgrade unavailable');
    await apply(constraints);
  };
  const session = new CameraFormatSession(track);
  await session.select('4:3');
  assert.equal(session.state.notice, null);
  assert.equal(session.state.selected, '4:3');
  assert.equal(track.getSettings().width, 1760);
  assert.equal(track.getSettings().frameRate, 30);
});

test('missing capability ranges retain high initial dimension preferences when replacing constraints', async () => {
  const track = new CameraTrack();
  track.getCapabilities = () => ({});
  const session = new CameraFormatSession(track, { supported: { resizeMode: true } });
  await session.select('auto');
  assert.equal(session.state.notice, null);
  assert.equal(track.calls[0].width.ideal, 3840);
  assert.equal(track.calls[0].height.ideal, 2160);
});

test('rejected crop fallback keeps the working mode and does not save crop permission', async () => {
  const track = new CameraTrack();
  const apply = track.applyConstraints.bind(track);
  track.applyConstraints = async (constraints) => {
    if (constraints.resizeMode?.exact === 'crop-and-scale') throw new Error('Crop unavailable');
    await apply(constraints);
  };
  const session = new CameraFormatSession(track);
  await session.select('1:1');
  const before = track.getSettings();
  await session.select('9:16');
  await session.allowCrop();
  assert.equal(session.state.selected, '1:1');
  assert.equal(session.state.notice, 'formatUnavailable');
  assert.equal(session.state.fallback, null);
  assert.deepEqual(track.getSettings(), before);
});

test('a driver that ignores pinned dimensions during FPS optimization is restored to the accepted mode', async () => {
  const track = new CameraTrack();
  const apply = track.applyConstraints.bind(track);
  let ignored = false;
  track.applyConstraints = async (constraints) => {
    if (constraints.frameRate && !ignored) {
      ignored = true;
      track.settings = { width: 640, height: 480, frameRate: 60, resizeMode: 'none' };
    } else await apply(constraints);
  };
  const session = new CameraFormatSession(track);
  await session.select('4:3');
  assert.equal(session.state.notice, null);
  assert.equal(track.getSettings().width, 1760);
  assert.equal(track.getSettings().height, 1328);
});

test('failed rollback visibly resets to Auto and keeps a usable track', async () => {
  const track = new CameraTrack();
  const apply = track.applyConstraints.bind(track);
  let calls = 0;
  track.applyConstraints = async (constraints) => {
    calls++;
    if (calls === 1) track.settings = { width: 640, height: 480, frameRate: 30, resizeMode: 'none' };
    else if (calls === 2) throw new Error('Cannot restore');
    else await apply(constraints);
  };
  const session = new CameraFormatSession(track);
  await session.select('16:9');
  assert.equal(session.state.selected, 'auto');
  assert.equal(session.state.notice, 'formatRecovered');
  assert.equal(track.readyState, 'live');
  assert.equal(track.getSettings().width, 1552);
});

test('rapid changes are serialized and only the last pending selection is negotiated', async () => {
  const track = new CameraTrack();
  const apply = track.applyConstraints.bind(track);
  const entered = deferred(), release = deferred();
  let calls = 0, inFlight = 0, maximum = 0;
  track.applyConstraints = async (constraints) => {
    maximum = Math.max(maximum, ++inFlight);
    if (++calls === 1) { entered.resolve(); await release.promise; }
    await apply(constraints);
    inFlight--;
  };
  const session = new CameraFormatSession(track);
  const first = session.select('16:9');
  await entered.promise;
  const middle = session.select('4:3');
  const latest = session.select('1:1');
  assert.equal(session.state.busy, true);
  assert.equal(session.state.selected, '1:1');
  assert.equal(calls, 1);
  release.resolve();
  await Promise.all([first, middle, latest]);
  assert.equal(maximum, 1);
  assert.equal(session.state.busy, false);
  assert.equal(session.state.selected, '1:1');
  assert.equal(cameraRatioLabel(track.getSettings()), '1:1');
  assert.equal(track.calls.length, 4);
  assert.ok(track.calls.every((constraints) => constraints.aspectRatio.min !== 4 / 3 * 0.99));
});

test('stopping while a mutation is pending cannot negotiate the next request or publish a stale result', async () => {
  const track = new CameraTrack();
  const entered = deferred(), release = deferred();
  let calls = 0, changes = 0;
  track.applyConstraints = async () => { calls++; entered.resolve(); await release.promise; };
  const session = new CameraFormatSession(track, { onChange: () => changes++ });
  const first = session.select('16:9');
  await entered.promise;
  const latest = session.select('4:3');
  track.stop();
  const changesAtStop = changes;
  release.resolve();
  await Promise.all([first, latest]);
  assert.equal(calls, 1);
  assert.equal(changes, changesAtStop);
});

test('ratio labels use actual dimensions, including approximate native ratios and nonstandard modes', () => {
  assert.equal(cameraRatioLabel({ width: 1760, height: 1328 }), '4:3');
  assert.equal(cameraRatioLabel({ width: 2000, height: 1000 }), '2:1');
  assert.equal(cameraRatioLabel({ width: 0, height: 0 }), '');
  assert.equal(cameraModeLabel({ resizeMode: 'crop-and-scale' }), 'formatAdapted');
});

test('only valid ratio preferences persist; unavailable or malformed storage remains optional', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(loadCameraFormat(storage), 'auto');
  saveCameraFormat(storage, '9:16');
  assert.equal(loadCameraFormat(storage), '9:16');
  saveCameraFormat(storage, 'bad');
  assert.equal(loadCameraFormat(storage), '9:16');
  assert.equal(loadCameraFormat({ getItem: () => '{invalid}' }), 'auto');
  const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  assert.equal(loadCameraFormat(blocked), 'auto');
  assert.doesNotThrow(() => saveCameraFormat(blocked, '1:1'));
});
