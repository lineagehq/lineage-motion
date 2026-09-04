import {
  formatCssKeyframePercentage,
  serializeCssTimingFunction,
  sha256Hex,
  type TimingFunction,
} from '../../domain/src/index.js';

export function formatTime(milliseconds: number): string {
  return `${Object.is(milliseconds, -0) ? 0 : milliseconds}ms`;
}

export function formatOffset(offset: number): string {
  return formatCssKeyframePercentage(offset);
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatTimingFunction(timing: TimingFunction): string {
  return serializeCssTimingFunction(timing);
}

export function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function digest(input: string | Uint8Array): string {
  return sha256Hex(input);
}
