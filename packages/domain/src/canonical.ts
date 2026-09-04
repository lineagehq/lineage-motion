import type { MotionDocument } from './document.js';

export function canonicalBytes(document: MotionDocument): Uint8Array {
  return new TextEncoder().encode(`${stableStringify(document)}\n`);
}

/** Canonical JSON for durable protocol and store boundaries. */
export function canonicalJson(value: unknown): string {
  return `${stableStringify(value)}\n`;
}

/** Revision-neutral bytes for comparing canonical content across undo/redo revisions. */
export function canonicalContentBytes(document: MotionDocument): Uint8Array {
  const { revision: _revision, ...content } = document;
  return new TextEncoder().encode(`${stableStringify(content)}\n`);
}

export function formatCanonicalDecimal(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
