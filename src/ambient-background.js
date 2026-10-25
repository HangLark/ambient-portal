// CSS owns playback, so pause, reduced motion and hidden states also stop the drift.
export function initAmbientBackground(root) {
  const random = (min, max) => (min + Math.random() * (max - min)).toFixed(3);
  const colors = [...root.querySelectorAll('.ambient-color')];
  const varyPath = (color) => {
    for (let step = 1; step <= 4; step++) {
      color.style.setProperty(`--drift-${step}`, `translate(${random(-18, 18)}%, ${random(-20, 20)}%) rotate(${random(-24, 24)}deg) scale(${random(0.82, 1.18)}, ${random(0.82, 1.18)})`);
    }
  };
  const nextPath = (event) => {
    if (event.animationName === 'ambient-drift') varyPath(event.target);
  };
  for (const color of colors) {
    varyPath(color);
    color.style.setProperty('--drift-duration', `${random(80, 110)}s`);
    color.style.setProperty('--drift-delay', `${random(-60, 0)}s`);
  }
  // Every path meets at the same resting pose, so a new random route never jumps.
  root.addEventListener('animationiteration', nextPath);
  return () => root.removeEventListener('animationiteration', nextPath);
}
