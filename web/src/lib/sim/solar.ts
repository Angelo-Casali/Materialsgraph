/**
 * Sun position and irradiance on tilted surfaces.
 *
 * Sun position: NOAA / Spencer (1971) Fourier approximations for declination and equation of time,
 * accurate to a few tenths of a degree, ample for hourly building simulation.
 * Tilted-surface irradiance: isotropic-sky model (Liu & Jordan), with ground reflectance 0.2.
 */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** cosine of the zenith angle (0 or less: sun below the horizon) */
  cosZenith: number;
  /** solar azimuth in degrees, clockwise from north (90 = east, 180 = south) */
  azimuth: number;
}

/**
 * @param hourUtc fractional hours since 1 January 00:00 UTC of a non-leap year (0..8760)
 * @param lat latitude in degrees, north positive
 * @param lon longitude in degrees, east positive
 */
export function sunPosition(hourUtc: number, lat: number, lon: number): SunPosition {
  const day = Math.floor(hourUtc / 24); // 0-based day of year
  const hour = hourUtc - day * 24;
  const g = ((2 * Math.PI) / 365) * (day + (hour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMin = hour * 60 + eqTime + 4 * lon;
  const ha = (trueSolarMin / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const z = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const sinZ = Math.sin(z);
  let az = 180;
  if (sinZ > 1e-6) {
    const cosAz = (Math.sin(decl) - Math.sin(phi) * cosZ) / (Math.cos(phi) * sinZ);
    az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD;
    if (ha > 0) az = 360 - az;
  }
  return { cosZenith: cosZ, azimuth: az };
}

/**
 * Irradiance on a surface, W/m2 (isotropic sky).
 * @param tilt surface tilt from horizontal, degrees (90 = wall)
 * @param surfAz surface azimuth, degrees clockwise from north (180 = facing south)
 */
export function surfaceIrradiance(sun: SunPosition, dni: number, dhi: number, ghi: number, tilt: number, surfAz: number, albedo = 0.2): number {
  const beta = tilt * RAD;
  let beam = 0;
  if (sun.cosZenith > 0.01 && dni > 0) {
    const sinZ = Math.sqrt(Math.max(0, 1 - sun.cosZenith * sun.cosZenith));
    const cosInc = sun.cosZenith * Math.cos(beta) + sinZ * Math.sin(beta) * Math.cos((sun.azimuth - surfAz) * RAD);
    if (cosInc > 0) beam = dni * cosInc;
  }
  const sky = dhi * (1 + Math.cos(beta)) / 2;
  const ground = ghi * albedo * (1 - Math.cos(beta)) / 2;
  return beam + sky + ground;
}
