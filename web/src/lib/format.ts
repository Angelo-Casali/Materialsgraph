/** Split a formula into text/subscript runs: "Li7La3Zr2O12" -> [Li,7,La,3,...]. Digits (and decimals) after a symbol or ')' become subscripts. */
export function formulaRuns(formula: string): { text: string; sub: boolean }[] {
  const runs: { text: string; sub: boolean }[] = [];
  const re = /(\d+(?:\.\d+)?)|([^\d]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    if (m[1] !== undefined) runs.push({ text: m[1], sub: runs.length > 0 && !/[\s-]$/.test(runs[runs.length - 1].text) });
    else runs.push({ text: m[2], sub: false });
  }
  return runs;
}

const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** Compact human number: 0.00012 -> "1.2×10⁻⁴", 3579 -> "3,579", 3.45 -> "3.45". */
export function fmtNumber(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-2 || a >= 1e5) {
    const exp = Math.floor(Math.log10(a));
    const mant = v / 10 ** exp;
    const m = Math.abs(mant - Math.round(mant)) < 0.05 ? String(Math.round(mant)) : mant.toFixed(1);
    const sup = String(exp).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
    return m === '1' ? `10${sup}` : `${m}×10${sup}`;
  }
  if (a >= 100) return Math.round(v).toLocaleString('en-US');
  return String(Number(v.toPrecision(3)));
}

export function fmtValue(v: number, unit: string): string {
  return unit ? `${fmtNumber(v)} ${unit}` : fmtNumber(v);
}

export function fmtRange(min?: number | null, max?: number | null, unit = ''): string {
  const u = unit ? ` ${unit}` : '';
  if (min != null && max != null) return `${fmtNumber(min)}–${fmtNumber(max)}${u}`;
  if (min != null) return `≥ ${fmtNumber(min)}${u}`;
  if (max != null) return `≤ ${fmtNumber(max)}${u}`;
  return 'any value';
}

/** Conditions are stored as a JSON string ("" = unspecified); render as readable text. */
export function fmtConditions(raw: string): string {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([k]) => k !== 'raw')
      .map(([k, v]) => {
        if (k === 'temperature_K' && typeof v === 'number') return `${Math.round(v - 273.15)} °C`;
        return `${k.replace(/_/g, ' ')}: ${v}`;
      })
      .join(' · ');
  } catch {
    return raw;
  }
}

export const prettyProp = (name: string) => name.replace(/_/g, ' ');

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  measured: 'Measured',
  dft: 'DFT computed',
  mlip_predicted: 'ML-potential predicted',
  literature_asserted: 'Literature asserted',
};

export const BASIS_LABEL: Record<string, string> = {
  computed: 'computed (not demonstrated)',
  literature: 'from literature',
  curated: 'curated reference',
};
