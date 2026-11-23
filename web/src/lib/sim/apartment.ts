/**
 * The simulated apartment: an 80 m2 flat with five rooms, plus envelope presets.
 *
 * Plan in local coordinates (metres): x grows to the right (the "east" end), y grows from the front
 * facade (y = 0) to the back facade (y = 8). The whole plan is rotated by `frontFacing` degrees.
 *
 *   y=8 +-----------+-----------+-----------------+
 *       |  kitchen  |  bathroom |                 |
 *   y=5 +-----------+-----------+    bedroom 2    |
 *       |                       |-----------------+ y=4
 *       |      living room      |    bedroom 1    |
 *   y=0 +-----------------------+-----------------+
 *      x=0                     x=6              x=10
 *
 * Envelope presets: U-values and window types from the TABULA Italian building typology
 * (Corrado, Ballarini, Corgnati, Tala, Politecnico di Torino, 2011, Tables 4 and 5), source id
 * `tabula-it`. The "deep renovation" preset is an example of a well-insulated renovation, not a
 * legal minimum (editorial).
 */

export type Side = 'front' | 'back' | 'left' | 'right';

export interface WindowSpec {
  side: Side;
  /** glazed opening area including frame, m2 */
  area: number;
  /** only present when that side is an external wall */
}

export interface ZoneSpec {
  id: 'living' | 'kitchen' | 'bath' | 'bed1' | 'bed2';
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  windows: WindowSpec[];
  /** share of internal gains released in this room */
  gainShare: number;
}

export const HEIGHT = 2.7;
export const WIDTH = 10;
export const DEPTH = 8;

export const ZONES: ZoneSpec[] = [
  { id: 'living', name: 'Living room', x0: 0, y0: 0, x1: 6, y1: 5, windows: [{ side: 'front', area: 5.0 }, { side: 'left', area: 1.6 }], gainShare: 0.4 },
  { id: 'kitchen', name: 'Kitchen', x0: 0, y0: 5, x1: 3, y1: 8, windows: [{ side: 'back', area: 1.6 }, { side: 'left', area: 1.0 }], gainShare: 0.25 },
  { id: 'bath', name: 'Bathroom', x0: 3, y0: 5, x1: 6, y1: 8, windows: [{ side: 'back', area: 0.8 }], gainShare: 0.07 },
  { id: 'bed1', name: 'Bedroom 1', x0: 6, y0: 0, x1: 10, y1: 4, windows: [{ side: 'front', area: 2.0 }, { side: 'right', area: 1.2 }], gainShare: 0.14 },
  { id: 'bed2', name: 'Bedroom 2', x0: 6, y0: 4, x1: 10, y1: 8, windows: [{ side: 'back', area: 2.0 }, { side: 'right', area: 1.2 }], gainShare: 0.14 },
];

export type ZoneId = ZoneSpec['id'];

/** Interior door couplings (W/K) from air moving through doorways (editorial estimate). */
export const DOORS: [ZoneId, ZoneId, number][] = [
  ['living', 'kitchen', 40],
  ['living', 'bath', 8],
  ['living', 'bed1', 12],
  ['living', 'bed2', 12],
];

/** U-value of the plastered brick partitions between rooms, W/m2K (editorial). */
export const U_PARTITION = 1.8;

export type Exposure = 'two' | 'three' | 'four';
export const EXPOSURES: { id: Exposure; label: string; sides: Side[] }[] = [
  { id: 'two', label: 'Middle of the block: front and back walls outside', sides: ['front', 'back'] },
  { id: 'three', label: 'End of the block: front, back and bedroom end outside', sides: ['front', 'back', 'right'] },
  { id: 'four', label: 'Detached: all four walls outside', sides: ['front', 'back', 'left', 'right'] },
];

export type Below = 'heated' | 'unheated' | 'ground';
export type Above = 'heated' | 'roof';

export const BELOW_OPTIONS: { id: Below; label: string }[] = [
  { id: 'heated', label: 'Heated flat below' },
  { id: 'unheated', label: 'Unheated cellar or garage below' },
  { id: 'ground', label: 'On the ground' },
];
export const ABOVE_OPTIONS: { id: Above; label: string }[] = [
  { id: 'heated', label: 'Heated flat above' },
  { id: 'roof', label: 'Roof above (top floor)' },
];

/** Temperature-reduction factor towards an unheated cellar (editorial, typical of EN ISO 13789 practice). */
export const B_UNHEATED = 0.5;

export type MassClass = 'light' | 'medium' | 'heavy';
/** Effective mass area factor (x floor area) and internal heat capacity (J/K per m2 of floor), EN ISO 13790 Table 12. */
export const MASS: Record<MassClass, { label: string; am: number; cm: number }> = {
  light: { label: 'Light (timber frame, plasterboard)', am: 2.5, cm: 110_000 },
  medium: { label: 'Medium', am: 2.5, cm: 165_000 },
  heavy: { label: 'Heavy (brick and concrete, typical in Italy)', am: 3.0, cm: 260_000 },
};

export interface Envelope {
  uWall: number;
  uRoof: number;
  uFloor: number;
  uWindow: number;
  gWindow: number;
  /** air changes per hour through leaks and normal airing */
  ach: number;
}

export interface EnvelopePreset extends Envelope {
  id: string;
  label: string;
  windowLabel: string;
  sources: string[];
  editorial?: boolean;
}

/**
 * TABULA Italy, Tables 4-5: before 1976 no insulation (hollow-brick cavity wall 1.15, flat brick-concrete roof 1.85,
 * brick-concrete floor 1.30, single glazing in timber 4.9 / g 0.85); 1976-1990 low insulation (0.78 / 1.01 / 0.98,
 * double glazing 2.8 / 0.75); 1991-2005 medium (0.59 / 0.70 / 0.77, 2.8 / 0.75); after 2005 high (0.34 / 0.30 / 0.33,
 * low-e double glazing 2.2 / 0.67). Air change rates are editorial estimates of leakiness by period.
 */
export const ENVELOPES: EnvelopePreset[] = [
  { id: 'pre1976', label: 'Built before 1976, no insulation', uWall: 1.15, uRoof: 1.85, uFloor: 1.3, uWindow: 4.9, gWindow: 0.85, ach: 0.7, windowLabel: 'single glazing, timber frame', sources: ['tabula-it'] },
  { id: '1976', label: 'Built 1976-1990, little insulation', uWall: 0.78, uRoof: 1.01, uFloor: 0.98, uWindow: 2.8, gWindow: 0.75, ach: 0.5, windowLabel: 'double glazing, timber frame', sources: ['tabula-it'] },
  { id: '1991', label: 'Built 1991-2005, some insulation', uWall: 0.59, uRoof: 0.7, uFloor: 0.77, uWindow: 2.8, gWindow: 0.75, ach: 0.4, windowLabel: 'double glazing, timber frame', sources: ['tabula-it'] },
  { id: '2006', label: 'Built after 2005, insulated', uWall: 0.34, uRoof: 0.3, uFloor: 0.33, uWindow: 2.2, gWindow: 0.67, ach: 0.3, windowLabel: 'low-emissivity double glazing', sources: ['tabula-it'] },
  { id: 'deep', label: 'Deep renovation (example)', uWall: 0.2, uRoof: 0.18, uFloor: 0.25, uWindow: 1.0, gWindow: 0.5, ach: 0.15, windowLabel: 'triple glazing', sources: [], editorial: true },
];

export const SIDE_ANGLE: Record<Side, number> = { front: 0, right: 90, back: 180, left: 270 };

/** Compass azimuth (degrees clockwise from north) that a wall on `side` faces, given where the front faces. */
export function sideAzimuth(side: Side, frontFacing: number): number {
  return (((frontFacing + SIDE_ANGLE[side]) % 360) + 360) % 360;
}

export function zoneArea(z: ZoneSpec): number {
  return (z.x1 - z.x0) * (z.y1 - z.y0);
}

/** Length of the external wall of a zone on a given side of the flat (0 if the zone does not touch it). */
export function sideLength(z: ZoneSpec, side: Side): number {
  switch (side) {
    case 'front':
      return z.y0 === 0 ? z.x1 - z.x0 : 0;
    case 'back':
      return z.y1 === DEPTH ? z.x1 - z.x0 : 0;
    case 'left':
      return z.x0 === 0 ? z.y1 - z.y0 : 0;
    case 'right':
      return z.x1 === WIDTH ? z.y1 - z.y0 : 0;
  }
}

/** Length of the partition shared by two zones (0 if not adjacent). */
export function sharedLength(a: ZoneSpec, b: ZoneSpec): number {
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (a.x1 === b.x0 || b.x1 === a.x0) return overlap(a.y0, a.y1, b.y0, b.y1);
  if (a.y1 === b.y0 || b.y1 === a.y0) return overlap(a.x0, a.x1, b.x0, b.x1);
  return 0;
}

export const FLOOR_AREA = ZONES.reduce((s, z) => s + zoneArea(z), 0);
