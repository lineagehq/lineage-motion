import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.js';
import { parseTransformPose, projectShotWorkspace, projectTrajectorySelection,
  projectTransformTrajectory, serializeTransformPose } from './index.js';

const source = readFileSync(resolve(import.meta.dirname, '../../../fixtures/public-synthetic/landing-shot1.html'), 'utf8');
const imported = importMotionHtml(source);
if (!imported.document) throw new Error(imported.diagnostics[0]?.code);
const document = imported.document;
const targets = document.elements.map((element) => element.id).sort();

describe('trajectory projection', () => {
  test('projects two selector-independent trajectories at exact Shot 1 moments', () => {
    const workspace = projectShotWorkspace(document, { startMs: 0, landedMs: 700, settledMs: 2100, targetElementIds: targets });
    expect(workspace.eligible).toBe(true);
    expect(workspace.trajectories.every((trajectory) => trajectory.eligible
      && [0, 700, 2100].every((time) => trajectory.waypoints.some((point) => point.timeMs === time)))).toBe(true);
    const renamed = structuredClone(document); renamed.applications.forEach((application) => { application.selectorHint = '.changed'; });
    expect(projectShotWorkspace(renamed, { startMs: 0, landedMs: 700, settledMs: 2100, targetElementIds: targets })).toEqual(workspace);
  });

  test('round-trips every safe fixed-point translate shape without binary-float loss', () => {
    const pose = parseTransformPose('translate(12.5px, -4px) scale(1.25) rotate(-6deg)');
    expect(pose).not.toBeNull();
    expect(parseTransformPose(serializeTransformPose(pose!))).toEqual(pose);
    for (const translateXMicrounits of [0, 1, -1, 72_000_001, -72_000_001, 8_999_999_999_999, -8_999_999_999_999]) {
      const exact = { translateXMicrounits, translateYMicrounits: translateXMicrounits === 0 ? 0 : -translateXMicrounits,
        scalePpm: 1_000_000, rotateMicrodegrees: 0 };
      expect(parseTransformPose(serializeTransformPose(exact))).toEqual(exact);
    }
  });

  test('keeps the translate grammar closed and rejects inexact or unsafe lengths', () => {
    for (const value of [
      'matrix(1,0,0,1,0,0)', 'translate(var(--x), 2px)', 'translate(calc(1px + 2px), 0px)',
      'translate(env(safe-area-inset-left), 0px)', 'translate(1%, 2px)', 'translate(1em, 0px)',
      'translate(1, 0px)', 'translate(0.0000001px, 0px)', 'translate(-0.0000001px, 0px)',
      'translate(9007199254.740992px, 0px)', 'translate(-9007199254.740992px, 0px)',
      'translate(1e1px, 0px)', 'skew(2deg)',
    ]) expect(parseTransformPose(value), value).toBeNull();
    expect(parseTransformPose('translate(1.0000000px, -0.0000000px)')).toMatchObject({
      translateXMicrounits: 1_000_000, translateYMicrounits: 0,
    });
    expect(parseTransformPose('translate(9007199254.740991px, -9007199254.740991px)')).toMatchObject({
      translateXMicrounits: Number.MAX_SAFE_INTEGER, translateYMicrounits: Number.MIN_SAFE_INTEGER,
    });
  });

  test('keeps caller selection order local while returning exact canonical targets', () => {
    const selection = projectTrajectorySelection(document, targets, 700);
    expect(selection.eligible).toBe(true);
    expect(selection.targets.map((target) => target.elementId)).toEqual(targets);
    expect(projectTransformTrajectory(document, 'missing')).toMatchObject({ eligible: false, code: 'TRAJECTORY_TRACK_MISSING' });
  });
});
