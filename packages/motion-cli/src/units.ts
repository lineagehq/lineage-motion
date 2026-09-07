/** Exact decimal conversion: no binary floating point rounding at the CLI boundary. */
export function scaledDecimal(value: string, scale: bigint): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 80) throw new Error('CLI_UNIT_INVALID');
  const negative = value.startsWith('-'); const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const divisor = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`) * scale * (negative ? -1n : 1n);
  if (numerator % divisor) throw new Error('CLI_UNIT_PRECISION');
  return safe(numerator / divisor);
}
function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('CLI_UNIT_OVERFLOW');
  return Number(value);
}
export function pixelPpm(value: string, dimension: string): number {
  const pixels = BigInt(scaledDecimal(value, 1_000_000n));
  const viewport = BigInt(scaledDecimal(dimension, 1_000_000n));
  if (viewport <= 0n) throw new Error('CLI_UNIT_INVALID');
  const numerator = pixels * 1_000_000n;
  if (numerator % viewport) throw new Error('CLI_UNIT_PRECISION');
  return safe(numerator / viewport);
}
export function normalizeUnits(values: Map<string, string[]>): void {
  for (const [name, entries] of [...values]) {
    let canonical: string; let converted: string[];
    if (name.endsWith('-seconds')) {
      canonical = name.replace(/-seconds$/, '-ms'); converted = entries.map((v) => String(scaledDecimal(v, 1000n)));
    } else if (name === '--translate-x-pixels' || name === '--translate-y-pixels') {
      canonical = name.replace(/-pixels$/, '-microunits');
      converted = entries.map((v) => String(scaledDecimal(v, 1_000_000n)));
    } else if (name === '--delta-x-pixels' || name === '--delta-y-pixels') {
      canonical = name.replace(/-pixels$/, '-ppm');
      const dimension = values.get(name === '--delta-x-pixels' ? '--viewport-width' : '--viewport-height')?.[0];
      if (!dimension) throw new Error('CLI_VIEWPORT_REQUIRED');
      converted = entries.map((v) => String(pixelPpm(v, dimension)));
    } else continue;
    if (values.has(canonical)) throw new Error('CLI_UNIT_CONFLICT');
    values.delete(name); values.set(canonical, converted);
  }
}
