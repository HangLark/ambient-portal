export const CAMERA_FORMATS = [
  { id: 'auto', label: 'formatAuto' },
  { id: '16:9', ratio: 16 / 9, label: 'formatWide' },
  { id: '4:3', ratio: 4 / 3, label: 'formatStandard' },
  { id: '1:1', ratio: 1, label: 'formatSquare' },
  { id: '9:16', ratio: 9 / 16, label: 'formatPortrait' },
];

const preferenceKey = 'ambient-portal-camera-format';
const positive = (value) => Number.isFinite(value) && value > 0;
const validFormat = (id) => CAMERA_FORMATS.some((format) => format.id === id);
const ratioOf = (id) => CAMERA_FORMATS.find((format) => format.id === id)?.ratio;
// Some native formats are slightly off-ratio (for example, 1760 × 1328).
const matchesRatio = (settings, ratio) => positive(settings.width) && positive(settings.height)
  && Math.abs(settings.width / settings.height / ratio - 1) <= 0.01;

export function cameraRatioLabel(settings) {
  if (!positive(settings?.width) || !positive(settings?.height)) return '';
  return CAMERA_FORMATS.find(({ ratio }) => ratio && matchesRatio(settings, ratio))?.id
    || `${Math.round(settings.width / settings.height * 100) / 100}:1`;
}

export function loadCameraFormat(storage) {
  try {
    const value = storage?.getItem(preferenceKey);
    return validFormat(value) ? value : 'auto';
  } catch { return 'auto'; }
}

export function saveCameraFormat(storage, format) {
  if (!validFormat(format)) return;
  try { storage?.setItem(preferenceKey, format); } catch { /* Storage is optional. */ }
}

const read = (track, method) => {
  try { return track[method]?.() || {}; } catch { return {}; }
};
const sameDimensions = (a, b) => a.width === b.width && a.height === b.height;
const modeOf = (settings) => settings.resizeMode === 'none' ? 'native'
  : settings.resizeMode === 'crop-and-scale' ? 'adapted' : 'unknown';

function pinDimensions(constraints, settings) {
  const pinned = { ...constraints };
  for (const property of ['width', 'height']) {
    if (positive(settings[property])) pinned[property] = { exact: settings[property] };
  }
  return pinned;
}

/** One live track, one mutation at a time. Pending selections collapse to the latest. */
export class CameraFormatSession {
  constructor(track, { supported, isCurrent = () => true, onChange = () => {} } = {}) {
    this.track = track;
    this.supported = supported;
    this.isCurrent = () => isCurrent() && track.readyState !== 'ended';
    this.onChange = onChange;
    this.state = { selected: 'auto', busy: false, notice: null, fallback: null };
    this.applied = 'auto';
    this.pending = null;
    this.running = null;
  }

  select(format, allowCrop = false) {
    if (!validFormat(format) || !this.isCurrent()) return Promise.resolve();
    this.pending = { format, allowCrop };
    this.state = { selected: format, busy: true, notice: null, fallback: null };
    this.onChange();
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  allowCrop() {
    if (this.state.fallback) return this.select(this.state.fallback, true);
    return Promise.resolve();
  }

  async drain() {
    while (this.pending && this.isCurrent()) {
      const request = this.pending;
      this.pending = null;
      const result = await this.negotiate(request);
      if (!this.isCurrent()) return;
      if (result === 'success') this.applied = request.format;
      if (result === 'recovered') this.applied = 'auto';
      if (this.pending) continue;
      const canCrop = this.canResize('crop-and-scale');
      this.state = {
        selected: this.applied,
        busy: false,
        notice: result === 'success' ? null : result === 'recovered' ? 'formatRecovered' : 'formatUnavailable',
        fallback: result !== 'success' && request.format !== 'auto' && !request.allowCrop && canCrop
          ? request.format : null,
      };
      this.onChange();
    }
  }

  canResize(mode) {
    if (this.supported?.resizeMode === false) return false;
    const modes = read(this.track, 'getCapabilities').resizeMode;
    return modes ? modes.includes(mode) : this.supported?.resizeMode === true;
  }

  constraintsFor(format, allowCrop) {
    const capabilities = read(this.track, 'getCapabilities');
    const current = read(this.track, 'getSettings');
    const ratio = ratioOf(format);
    const constraints = {};
    let width = positive(capabilities.width?.max) ? capabilities.width.max : Math.max(current.width || 0, 3840);
    let height = positive(capabilities.height?.max) ? capabilities.height.max : Math.max(current.height || 0, 2160);
    if (ratio) {
      width = Math.min(width, height * ratio);
      height = width / ratio;
      constraints.aspectRatio = { min: ratio * 0.99, max: ratio * 1.01 };
    }
    if (positive(width)) constraints.width = { ideal: Math.round(width) };
    if (positive(height)) constraints.height = { ideal: Math.round(height) };
    if (this.canResize(allowCrop ? 'crop-and-scale' : 'none')) {
      constraints.resizeMode = { exact: allowCrop ? 'crop-and-scale' : 'none' };
    }
    return constraints;
  }

  accepts(settings, format, allowCrop) {
    if (format === 'auto') return true;
    return matchesRatio(settings, ratioOf(format)) && (allowCrop || modeOf(settings) === 'native');
  }

  async apply(constraints) {
    if (!this.isCurrent()) return false;
    await this.track.applyConstraints(constraints);
    return this.isCurrent();
  }

  async upgrade(format, allowCrop) {
    const constraints = this.constraintsFor(format, allowCrop);
    if (Object.keys(constraints).length && !await this.apply(constraints)) return false;
    const settings = read(this.track, 'getSettings');
    if (!this.accepts(settings, format, allowCrop)) throw new Error('Unverified camera format');

    // applyConstraints replaces the entire set. Preserve ratio and resize mode when
    // preferring frame rate, and pin dimensions so faster modes cannot lower resolution.
    const frameRate = read(this.track, 'getCapabilities').frameRate?.max;
    if (positive(frameRate) && positive(settings.width) && positive(settings.height)) {
      const pinned = pinDimensions(constraints, settings);
      try {
        if (!await this.apply({ ...pinned, frameRate: { ideal: frameRate } })) return false;
      } catch { /* A rejected frame-rate upgrade should keep the accepted resolution. */ }
      if (!this.isCurrent()) return false;
      const actual = read(this.track, 'getSettings');
      if (!sameDimensions(settings, actual) || !this.accepts(actual, format, allowCrop)) {
        if (!await this.apply(pinned)) return false;
        const restored = read(this.track, 'getSettings');
        if (sameDimensions(settings, restored) && this.accepts(restored, format, allowCrop)) return true;
        throw new Error('Resolution changed during frame-rate negotiation');
      }
    }
    return true;
  }

  async negotiate({ format, allowCrop }) {
    const before = read(this.track, 'getSettings');
    const original = pinDimensions(read(this.track, 'getConstraints'), before);
    if (positive(before.frameRate)) original.frameRate = { ideal: before.frameRate };
    if (before.resizeMode) original.resizeMode = { exact: before.resizeMode };
    if (!this.track.applyConstraints) return format === 'auto' ? 'success' : 'unavailable';
    // Without resize-mode control we cannot promise an uncropped fixed ratio.
    if (format !== 'auto' && !this.canResize(allowCrop ? 'crop-and-scale' : 'none')) return 'unavailable';
    try {
      return await this.upgrade(format, allowCrop) ? 'success' : 'cancelled';
    } catch {
      if (!this.isCurrent()) return 'cancelled';
      try {
        if (!await this.apply(original)) return 'cancelled';
      } catch { /* Some drivers reject restoration even while retaining the old format. */ }
      if (!this.isCurrent()) return 'cancelled';
      const restored = read(this.track, 'getSettings');
      if (sameDimensions(before, restored) && before.resizeMode === restored.resizeMode) return 'unavailable';
      // The previous format could not be restored. Keep a live preview and visibly reset
      // to Auto; never label a failed selection as applied or reopen the camera implicitly.
      try { await this.upgrade('auto', false); } catch { /* Retain the usable track. */ }
      return this.isCurrent() ? 'recovered' : 'cancelled';
    }
  }
}

export function cameraModeLabel(settings) {
  return { native: 'formatNative', adapted: 'formatAdapted', unknown: 'formatUnknown' }[modeOf(settings || {})];
}
