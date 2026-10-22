// A finite driver mode table: capability maxima are deliberately not a valid pair.
export class CameraTrack extends EventTarget {
  readyState = 'live';
  muted = false;
  calls = [];
  constraints = {};
  settings = { width: 1552, height: 1552, frameRate: 30, resizeMode: 'none' };
  modes = [
    { width: 1552, height: 1552, frameRate: 30 },
    { width: 1920, height: 1080, frameRate: 60 },
    { width: 1760, height: 1328, frameRate: 30 },
  ];
  stop() { this.readyState = 'ended'; }
  getSettings() { return { ...this.settings }; }
  getConstraints() { return structuredClone(this.constraints); }
  getCapabilities() {
    return {
      width: { min: 2, max: 1920 }, height: { min: 2, max: 1552 },
      frameRate: { min: 1, max: 60 }, resizeMode: ['none', 'crop-and-scale'],
    };
  }
  async applyConstraints(constraints) {
    this.calls.push(structuredClone(constraints));
    if (this.readyState === 'ended') throw new Error('Stopped track');
    const resizeMode = constraints.resizeMode?.exact || 'none';
    let candidates = this.modes;
    if (resizeMode === 'crop-and-scale') {
      candidates = [{
        width: constraints.width?.exact || constraints.width?.ideal || 1280,
        height: constraints.height?.exact || constraints.height?.ideal || 720,
        frameRate: 30,
      }];
    }
    candidates = candidates.filter((mode) => {
      if (constraints.width?.exact && mode.width !== constraints.width.exact) return false;
      if (constraints.height?.exact && mode.height !== constraints.height.exact) return false;
      const ratio = mode.width / mode.height;
      return (!constraints.aspectRatio?.min || ratio >= constraints.aspectRatio.min)
        && (!constraints.aspectRatio?.max || ratio <= constraints.aspectRatio.max);
    });
    if (!candidates.length) throw Object.assign(new Error('Unsupported mode'), { name: 'OverconstrainedError' });
    const distance = (mode) => ['width', 'height'].reduce((sum, key) => {
      const ideal = constraints[key]?.ideal;
      return sum + (ideal ? Math.abs(mode[key] - ideal) / ideal : 0);
    }, 0);
    const mode = candidates.toSorted((a, b) => distance(a) - distance(b))[0];
    this.settings = { ...mode, resizeMode };
    this.constraints = structuredClone(constraints);
  }
}

export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

export const cameraStream = (track = new CameraTrack()) => ({
  track, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [],
});
