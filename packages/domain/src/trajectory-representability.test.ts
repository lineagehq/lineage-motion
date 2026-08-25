import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.js';
import { canonicalBytes, parseTransformPose, projectShotWorkspace, projectTransformTrajectory,
  sha256Hex, type MotionDocument } from './index.js';

const source = readFileSync(resolve(import.meta.dirname,
  '../../../fixtures/public-synthetic/trajectory-representability.html'), 'utf8');
const imported = importMotionHtml(source);
if (!imported.document) throw new Error(imported.diagnostics[0]?.code);
const base = imported.document;
const targetElementIds = base.elements.map((element) => element.id).sort();

function firstTransformTrack(document: MotionDocument) {
  const track = document.tracks.find((candidate) => candidate.property === 'transform')!;
  return document.rules.find((rule) => rule.id === track.ruleId)!.tracks.find((candidate) =>
    candidate.property === 'transform')!;
}

function nextUp(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  if (Object.is(value, -0)) return Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + (value >= 0 ? 1n : -1n));
  return view.getFloat64(0);
}

function nextDown(value: number): number {
  return -nextUp(-value);
}

function projectionAtMiddleSourceTime(sourceTimeMs: number) {
  const document = structuredClone(base);
  const ruleTrack = firstTransformTrack(document);
  ruleTrack.keyframes[1]!.offset = sourceTimeMs / 2100;
  const elementId = document.tracks.find((track) =>
    track.keyframeIds.includes(ruleTrack.keyframes[1]!.id))!.elementId;
  return projectTransformTrajectory(document, elementId);
}

describe('strict trajectory representability projection', () => {
  test('projects unique sub-microsecond-near integers without changing canonical bytes', () => {
    const before = sha256Hex(canonicalBytes(base));
    const workspace = projectShotWorkspace(base,
      { startMs: 0, landedMs: 700, settledMs: 2100, targetElementIds });
    expect(workspace.eligible).toBe(true);
    expect(workspace.trajectories.every((trajectory) => trajectory.eligible
      && trajectory.waypoints.map((waypoint) => waypoint.timeMs).join(',') === '0,700,2100')).toBe(true);
    expect(sha256Hex(canonicalBytes(base))).toBe(before);
  });

  test('admits every probed unique source time strictly inside the open one-nanosecond interval', () => {
    for (const deltaNanoseconds of [0.999, 0.9995, 0.9999]) {
      const deltaMilliseconds = deltaNanoseconds / 1_000_000;
      expect(projectionAtMiddleSourceTime(700 - deltaMilliseconds), `-${deltaNanoseconds} ns`)
        .toMatchObject({ eligible: true });
      expect(projectionAtMiddleSourceTime(700 + deltaMilliseconds), `+${deltaNanoseconds} ns`)
        .toMatchObject({ eligible: true });
    }
  });

  test('uses literal representable open boundaries on both sides without rounded buckets', () => {
    const lowerBoundaryMs = 700 - 0.000001;
    const upperBoundaryMs = 700 + 0.000001;

    for (const sourceTimeMs of [nextUp(lowerBoundaryMs), nextDown(upperBoundaryMs)]) {
      expect(projectionAtMiddleSourceTime(sourceTimeMs), `inside ${sourceTimeMs}`)
        .toMatchObject({ eligible: true });
    }
    for (const sourceTimeMs of [nextDown(lowerBoundaryMs), lowerBoundaryMs,
      upperBoundaryMs, nextUp(upperBoundaryMs)]) {
      expect(projectionAtMiddleSourceTime(sourceTimeMs), `boundary/outside ${sourceTimeMs}`)
        .toMatchObject({ eligible: false, code: 'TRAJECTORY_TIME_UNREPRESENTABLE' });
    }
  });

  test('rejects quantization collisions, threshold differences, genuine fractions, and unsafe ranges', () => {
    const collision = structuredClone(base); const collisionTrack = firstTransformTrack(collision);
    collisionTrack.keyframes[0]!.offset = 700 / 2100;
    collisionTrack.keyframes[1]!.offset = (700 + 0.0000005) / 2100;
    expect(projectTransformTrajectory(collision, collision.tracks.find((track) =>
      track.keyframeIds.includes(collisionTrack.keyframes[0]!.id))!.elementId)).toMatchObject({ eligible: false,
      code: 'TRAJECTORY_TIME_UNREPRESENTABLE' });

    for (const delta of [0.000002, 0.25]) {
      const hostile = structuredClone(base); firstTransformTrack(hostile).keyframes[1]!.offset = (700 + delta) / 2100;
      expect(projectShotWorkspace(hostile,
        { startMs: 0, landedMs: 700, settledMs: 2100, targetElementIds })).toMatchObject({ eligible: false });
    }

    const unsafe = structuredClone(base); const application = unsafe.applications[0]!;
    application.bindings[0]!.delayOverridesMs[0] = Number.MAX_SAFE_INTEGER;
    application.slots[0]!.delayMs = Number.MAX_SAFE_INTEGER;
    unsafe.durationMs = Number.MAX_SAFE_INTEGER;
    expect(projectTransformTrajectory(unsafe, application.bindings[0]!.elementId)).toMatchObject({ eligible: false });
  });

  test('rejects non-finite, out-of-range, and duplicate offsets', () => {
    for (const offset of [Number.NaN, Number.POSITIVE_INFINITY, -Number.MIN_VALUE, nextUp(1)]) {
      const hostile = structuredClone(base); firstTransformTrack(hostile).keyframes[1]!.offset = offset;
      expect(projectTransformTrajectory(hostile, hostile.tracks[0]!.elementId), String(offset))
        .toMatchObject({ eligible: false });
    }
    const duplicate = structuredClone(base); const duplicateTrack = firstTransformTrack(duplicate);
    duplicateTrack.keyframes[1]!.offset = duplicateTrack.keyframes[0]!.offset;
    expect(projectTransformTrajectory(duplicate, duplicate.tracks[0]!.elementId)).toMatchObject({ eligible: false });
  });

  test('admits only numeric unitless zero in translate length coordinates', () => {
    for (const value of ['translate(0, 2px)', 'translate(-0.0, +0e3)',
      'translateX(.0)', 'translateY(0E-2)', 'translate3d(0, 2px, 0)']) {
      expect(parseTransformPose(value), value).not.toBeNull();
    }
    for (const value of ['translate(1, 2px)', 'translate(0%, 2px)', 'translate(calc(0px), 2px)',
      'translate(var(--x), 2px)', 'translate(env(safe-area-inset-left), 2px)',
      'translate(0em, 2px)', 'translate3d(0, 2px, 1)', 'translateX(0) translateX(0)',
      'translate(0, 0) scale(1, 2)', 'translate(0, 0) skew(0deg)']) {
      expect(parseTransformPose(value), value).toBeNull();
    }
  });
});
