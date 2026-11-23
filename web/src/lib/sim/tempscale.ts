/**
 * Temperature colour scale shared by the 3D view, its legend and the charts.
 * Diverging blue <-> red around a neutral grey at 21 degC (comfort), built from the site's validated
 * blue ramp and a matching red arm; every use also prints the temperature as text.
 */

export const TEMP_STOPS: [number, string][] = [
  [-10, '#104281'],
  [0, '#256abf'],
  [10, '#86b6ef'],
  [17, '#cde2fb'],
  [21, '#f0efec'],
  [25, '#f6cfc6'],
  [32, '#ec8f84'],
  [45, '#e34948'],
  [60, '#a12a29'],
  [80, '#6e1717'],
];

/** Legend ticks (degC) shown under every temperature colour cue. */
export const TEMP_TICKS = [-10, 0, 10, 21, 32, 45, 60];

const hexToRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const STOPS_RGB = TEMP_STOPS.map(([t, h]) => [t, ...hexToRgb(h)] as [number, number, number, number]);

/** RGB in 0..1 for a temperature. */
export function tempRgb(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const s = STOPS_RGB;
  if (!(t > s[0][0])) {
    out[0] = s[0][1] / 255;
    out[1] = s[0][2] / 255;
    out[2] = s[0][3] / 255;
    return out;
  }
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const a = s[i - 1];
      const b = s[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      out[0] = (a[1] + f * (b[1] - a[1])) / 255;
      out[1] = (a[2] + f * (b[2] - a[2])) / 255;
      out[2] = (a[3] + f * (b[3] - a[3])) / 255;
      return out;
    }
  }
  const z = s[s.length - 1];
  out[0] = z[1] / 255;
  out[1] = z[2] / 255;
  out[2] = z[3] / 255;
  return out;
}

export function tempCss(t: number): string {
  const [r, g, b] = tempRgb(t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** CSS gradient for the legend, mapped linearly between the first and last tick. */
export function tempGradient(lo = TEMP_TICKS[0], hi = TEMP_TICKS[TEMP_TICKS.length - 1]): string {
  const stops: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = lo + ((hi - lo) * i) / 20;
    stops.push(`${tempCss(t)} ${i * 5}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
