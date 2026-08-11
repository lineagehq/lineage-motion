import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { canonicalBytes } from '../../domain/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { compileMotionDocument } from './index.js';

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/public-synthetic/foundation.html', import.meta.url),
);

describe('deterministic pure HTML/CSS compiler', () => {
  test('reconstructs rule, application, slot, track, and keyframe motion from canonical records', async () => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    expect(imported.document).not.toBeNull();

    const compiled = compileMotionDocument(imported.document!);

    expect(compiled.css.match(/@keyframes motion_rule_/g)).toHaveLength(3);
    expect(compiled.css).toContain('[data-motion-id="');
    expect(compiled.css).toContain('animation: motion_rule_0000');
    expect(compiled.css).toContain(', motion_rule_0001');
    expect(compiled.css).toContain('steps(3, end)');
    expect(compiled.css).toContain('100ms');
    expect(compiled.html).toContain(`<style>\n${compiled.css}</style>`);
    expect(compiled.html).not.toContain('glide');
    expect(compiled.receipt).toMatchObject({
      schemaVersion: 'motion.compiler-receipt.v1',
      deterministic: true,
      inventory: {
        ruleCount: 3,
        applicationCount: 2,
        slotCount: 3,
        trackCount: 8,
        unsupportedCount: 0,
        missingCount: 0,
      },
      provenance: {
        sourceKind: 'direct',
        originalSourceDigest: imported.inventory.sourceDigest,
        materializedSourceDigest: imported.inventory.sourceDigest,
        resourceLockDigest: null,
        stylesheetDigest: null,
        aggregateFontAssetDigest: null,
        fontAssetCount: 0,
      },
    });
  });

  test('produces byte-identical HTML, CSS, digest, and receipt on three consecutive runs', async () => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    const canonical = canonicalBytes(imported.document!);

    const runs = [0, 1, 2].map(() => compileMotionDocument(imported.document!));

    expect(runs.map((run) => run.html)).toEqual(Array(3).fill(runs[0]!.html));
    expect(runs.map((run) => run.css)).toEqual(Array(3).fill(runs[0]!.css));
    expect(runs.map((run) => run.exportDigest)).toEqual(Array(3).fill(runs[0]!.exportDigest));
    expect(runs.map((run) => JSON.stringify(run.receipt))).toEqual(
      Array(3).fill(JSON.stringify(runs[0]!.receipt)),
    );
    expect(runs[0]!.receipt.documentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(new TextDecoder().decode(canonical).endsWith('\n')).toBe(true);
  });

  test('rejects opaque motion declarations in presentation CSS', async () => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.css += '.x { animation: hidden 1s; }\n';

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_OPAQUE_MOTION',
    );
  });

  test('rejects canonical presentation that contains a live resource reference', async () => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.css += '@font-face { src: url("https://assets.example.invalid/font.woff2"); }\n';

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_LIVE_RESOURCE',
    );
  });

  test.each([
    '<img srcset="//assets.example.invalid/a.png 1x">',
    '<video poster="poster.png"></video>',
    '<object data="payload.bin"></object>',
    '<div style="background-image: url(artifact.png)"></div>',
    '<meta http-equiv="refresh" content="0; url=next.html">',
  ])('rejects unresolved structural HTML resource surface', async (markup) => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.html = imported.document!.presentation.html.replace(
      '</body>', `${markup}</body>`,
    );

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_LIVE_RESOURCE',
    );
  });

  test('rejects inline opaque motion in canonical presentation HTML', async () => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.html = imported.document!.presentation.html.replace(
      '</body>', '<div style="animation: hidden 1s"></div></body>',
    );

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_OPAQUE_MOTION',
    );
  });

  test.each([
    '.shape { transition: opacity 1s; }',
    '.shape { -webkit-animation: hidden 1s; }',
    '.shape { -moz-transition-property: opacity; }',
    '@-webkit-keyframes hidden { to { opacity: 1; } }',
  ])('rejects transition or prefixed motion in canonical presentation CSS', async (css) => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.css += css;

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_OPAQUE_MOTION',
    );
  });

  test.each([
    '<div style="-webkit-animation: hidden 1s"></div>',
    '<svg><animate attributeName="opacity"></animate></svg>',
    '<svg><animateMotion></animateMotion></svg>',
    '<svg><animateTransform></animateTransform></svg>',
    '<svg><set attributeName="opacity"></set></svg>',
    '<marquee>moving</marquee>',
  ])('rejects inline or declarative motion in canonical presentation HTML', async (markup) => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.html = imported.document!.presentation.html.replace(
      '</body>', `${markup}</body>`,
    );

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_OPAQUE_MOTION',
    );
  });

  test.each([
    '<div onclick="void 0"></div>',
    '<svg onload="void 0"></svg>',
    '<a href="javascript:void 0">link</a>',
    '<form action="JaVaScRiPt:void 0"></form>',
  ])('rejects executable attributes in canonical presentation HTML', async (markup) => {
    const imported = importMotionHtml(await readFile(fixturePath, 'utf8'));
    imported.document!.presentation.html = imported.document!.presentation.html.replace(
      '</body>', `${markup}</body>`,
    );

    expect(() => compileMotionDocument(imported.document!)).toThrowError(
      'COMPILER_EXECUTABLE_HTML',
    );
  });
});
