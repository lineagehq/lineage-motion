import { expect, test } from 'vitest';
import { parseOptions, parseArgumentValues } from './arguments.ts';
import { pixelPpm, scaledDecimal } from './units.ts';
const transport = ['--service', 'http://127.0.0.1:1234', '--capability', 'synthetic'];
test('rejects duplicate, unknown, missing, ambiguous and noncanonical arguments before transport', () => {
  for (const tail of [['--what', 'secret-sentinel'], ['--value'], ['--value', '--track-id', 'x'],
    ['--expected-revision', '1e2'], ['--expected-revision', ' 2 '], ['--expected-revision', ''],
    ['--service', 'http://other'], ['--value', '1', '--value', '2'], ['--project', 'Other'], ['--claim', 'x']])
    expect(() => parseOptions(['head', ...transport, ...tail])).toThrow(/^CLI_/);
  expect(parseOptions(['head', ...transport]).actor).toBe('human'); // Explicit transport compatibility.
  expect(parseArgumentValues(['cue-create', '--target-id', 'a', '--target-id', 'b']).get('--target-id')).toEqual(['a', 'b']);
});
test('converts decimal seconds and pixels exactly, rejecting precision, overflow and alias conflicts', () => {
  expect(scaledDecimal('0.001', 1000n)).toBe(1); expect(scaledDecimal('-0.001', 1000n)).toBe(-1);
  expect(scaledDecimal('9007199254740.991', 1000n)).toBe(Number.MAX_SAFE_INTEGER);
  expect(scaledDecimal('1.000001', 1_000_000n)).toBe(1000001);
  for (const value of ['0.0001', 'NaN', 'Infinity', '1e3', '', ' 1', '0x10', '9007199254740.992'])
    expect(() => scaledDecimal(value, 1000n)).toThrow(/^CLI_UNIT_/);
  expect(pixelPpm('1', '1000')).toBe(1000); expect(pixelPpm('-0.5', '1000')).toBe(-500);
  expect(() => pixelPpm('1', '3')).toThrow('CLI_UNIT_PRECISION');
  expect(() => pixelPpm('1', '0')).toThrow('CLI_UNIT_INVALID');
  const options = parseOptions(['pose-set', ...transport, '--moment-seconds', '1.234', '--translate-x-pixels', '-0.000001']);
  expect(options.read('--moment-ms')).toBe('1234'); expect(options.read('--translate-x-microunits')).toBe('-1');
  expect(() => parseOptions(['pose-set', ...transport, '--time-seconds', '1', '--time-ms', '1000'])).toThrow('CLI_UNIT_CONFLICT');
  expect(() => parseOptions(['waypoints-translate', ...transport, '--delta-x-pixels', '1'])).toThrow('CLI_VIEWPORT_REQUIRED');
});
