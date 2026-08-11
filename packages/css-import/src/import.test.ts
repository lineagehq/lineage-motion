import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { importMotionHtml } from './index.js';

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/public-synthetic/foundation.html', import.meta.url),
);

describe('structural CSS motion import', () => {
  test('creates complete ordered rule, application, slot, delay, timing, and track inventories', async () => {
    const source = await readFile(fixturePath, 'utf8');

    const result = importMotionHtml(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.inventory).toMatchObject({
      ruleCount: 3,
      applicationCount: 2,
      slotCount: 3,
      trackCount: 8,
      unsupportedCount: 0,
      missingCount: 0,
    });
    expect(result.document).not.toBeNull();
    expect(result.document!.durationMs).toBe(1275);
    expect(result.document!.cues).toEqual([]);
    expect(result.document!.applications.map((application) => ({
      slotCount: application.slots.length,
      delays: application.slots.map((slot) => slot.delayMs),
      timings: application.slots.map((slot) => slot.timingFunction),
    }))).toEqual([
      {
        slotCount: 2,
        delays: [100, 50],
        timings: [
          { kind: 'keyword', value: 'ease' },
          { kind: 'steps', count: 3, position: 'end' },
        ],
      },
      {
        slotCount: 1,
        delays: [200],
        timings: [{ kind: 'steps', count: 2, position: 'start' }],
      },
    ]);
    expect(result.document!.applications[0]!.bindings.map((binding) =>
      binding.delayOverridesMs,
    )).toEqual([
      [100, 50],
      [250, 75],
    ]);
    expect(result.document!.tracks.map((track) => track.property).sort()).toEqual([
      'background-color',
      'background-color',
      'color',
      'opacity',
      'opacity',
      'opacity',
      'transform',
      'transform',
    ]);
    expect(result.document!.presentation.css).not.toMatch(
      /animation\s*:|@(?:-webkit-)?keyframes/i,
    );
    expect(result.document!.presentation.css).not.toContain('--cycle');
  });

  test('keeps element, application, slot, and expanded-track identity stable when selectors are renamed', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const renamed = source
      .replaceAll('synthetic-block', 'renamed-motion-block')
      .replaceAll('synthetic-caption', 'renamed-motion-caption');

    const original = importMotionHtml(source).document!;
    const rebound = importMotionHtml(renamed).document!;

    expect(rebound.elements.map((element) => element.id)).toEqual(
      original.elements.map((element) => element.id),
    );
    expect(rebound.applications.map((application) => application.id)).toEqual(
      original.applications.map((application) => application.id),
    );
    expect(rebound.applications.flatMap((application) =>
      application.slots.map((slot) => slot.id),
    )).toEqual(original.applications.flatMap((application) =>
      application.slots.map((slot) => slot.id),
    ));
    expect(rebound.tracks.map((track) => track.id)).toEqual(
      original.tracks.map((track) => track.id),
    );
  });

  test('assigns stable unique fingerprints and IDs to same-tag siblings', () => {
    const source = `<!doctype html><html><head><style>
      .peer { animation: fade 1s linear; }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    </style></head><body><div class="peer"></div><div class="peer"></div></body></html>`;

    const first = importMotionHtml(source).document!;
    const second = importMotionHtml(source).document!;

    expect(first.elements).toHaveLength(2);
    expect(new Set(first.elements.map((element) => element.structuralFingerprint)).size).toBe(2);
    expect(new Set(first.elements.map((element) => element.id)).size).toBe(2);
    expect(second.elements.map((element) => ({
      fingerprint: element.structuralFingerprint,
      id: element.id,
    }))).toEqual(first.elements.map((element) => ({
      fingerprint: element.structuralFingerprint,
      id: element.id,
    })));
  });

  test.each([
    ['IMPORT_PSEUDO_ELEMENT_MOTION', '.shape::before { animation: fade 1s; }'],
    ['IMPORT_RESPONSIVE_MOTION', '@media (width > 10px) { .shape { animation: fade 1s; } }'],
    ['IMPORT_COMPOSITION_UNSUPPORTED', '.shape { animation-composition: add; }'],
    ['IMPORT_TIMELINE_UNSUPPORTED', '.shape { animation-timeline: scroll(); }'],
    ['IMPORT_RANGE_UNSUPPORTED', '.shape { animation-range: entry 0% exit 100%; }'],
    ['IMPORT_TRIGGER_UNSUPPORTED', '.shape { animation-trigger: --enter; }'],
    ['IMPORT_ANIMATION_LONGHAND_UNSUPPORTED', '.shape { animation-timing-function: linear; }'],
  ])('fails atomically with %s', (code, extraCss) => {
    const result = importMotionHtml(`<!doctype html><html><head><style>
      .shape { width: 10px; }
      ${extraCss}
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    </style></head><body><div class="shape"></div></body></html>`);

    expect(result.document).toBeNull();
    expect(result.inventory.unsupportedCount).toBeGreaterThan(0);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(result.diagnostics.every((diagnostic) =>
      !diagnostic.summary.includes('.shape'),
    )).toBe(true);
  });

  test('fails atomically when an animation rule cannot bind exactly', () => {
    const result = importMotionHtml(`<!doctype html><html><head><style>
      .missing { animation: fade 1s linear; }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    </style></head><body></body></html>`);

    expect(result.document).toBeNull();
    expect(result.inventory.missingCount).toBe(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'IMPORT_BINDING_MISSING' }),
    ]);
  });

  test('rejects scripts and external resources without returning a partial document', () => {
    const result = importMotionHtml(`<!doctype html><html><head>
      <link rel="stylesheet" href="external.css">
      <style>@keyframes fade { from { opacity: 0; } to { opacity: 1; } }</style>
    </head><body><script>void 0</script></body></html>`);

    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'IMPORT_EXTERNAL_RESOURCE',
      'IMPORT_SCRIPT_UNSUPPORTED',
    ]);
  });

  test('rejects orphan delay overrides and CSS external resources atomically', () => {
    const delayed = importMotionHtml(`<!doctype html><html><head><style>
      .shape { animation-delay: 100ms; }
    </style></head><body><div class="shape"></div></body></html>`);
    const external = importMotionHtml(`<!doctype html><html><head><style>
      @import url("external.css");
      .shape { background-image: url("external.png"); }
    </style></head><body><div class="shape"></div></body></html>`);

    expect(delayed.document).toBeNull();
    expect(delayed.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'IMPORT_DELAY_WITHOUT_APPLICATION',
    );
    expect(external.document).toBeNull();
    expect(external.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'IMPORT_EXTERNAL_RESOURCE',
      'IMPORT_EXTERNAL_RESOURCE',
    ]);
  });

  test.each([
    ['IMPORT_INLINE_MOTION_UNSUPPORTED', '<div class="shape" style="animation: fade 1s"></div>'],
    ['IMPORT_EXTERNAL_RESOURCE', '<img srcset="//assets.example.invalid/a.png 1x">'],
    ['IMPORT_EXTERNAL_RESOURCE', '<video poster="poster.png"></video>'],
    ['IMPORT_EXTERNAL_RESOURCE', '<video><track src="captions.vtt"></video>'],
    ['IMPORT_EXTERNAL_RESOURCE', '<object data="payload.bin"></object>'],
    ['IMPORT_EXTERNAL_RESOURCE', '<svg><use href="//assets.example.invalid/sprite.svg#shape"></use></svg>'],
    ['IMPORT_EXTERNAL_RESOURCE', '<div style="background-image: url(artifact.png)"></div>'],
    ['IMPORT_EXTERNAL_RESOURCE', '<meta http-equiv="refresh" content="0; url=next.html">'],
  ])('rejects structural HTML motion/resources atomically with %s', (code, body) => {
    const result = importMotionHtml(`<!doctype html><html><head><style>
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    </style></head><body>${body}</body></html>`);

    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });

  test.each([
    ['IMPORT_TRANSITION_UNSUPPORTED', '.shape { transition: opacity 1s; }'],
    ['IMPORT_TRANSITION_UNSUPPORTED', '.shape { transition-duration: 1s; }'],
    ['IMPORT_PREFIXED_MOTION_UNSUPPORTED', '.shape { -webkit-animation: fade 1s; }'],
    ['IMPORT_PREFIXED_MOTION_UNSUPPORTED', '.shape { -moz-animation-duration: 1s; }'],
    ['IMPORT_PREFIXED_MOTION_UNSUPPORTED', '.shape { -webkit-transition: opacity 1s; }'],
    ['IMPORT_PREFIXED_MOTION_UNSUPPORTED', '.shape { -o-transition-property: opacity; }'],
    ['IMPORT_PREFIXED_MOTION_UNSUPPORTED', '@-webkit-keyframes fade { to { opacity: 1; } }'],
  ])('rejects stylesheet escape surface atomically with %s', (code, css) => {
    const result = importMotionHtml(`<!doctype html><html><head><style>
      ${css}
    </style></head><body><div class="shape"></div></body></html>`);

    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });

  test.each([
    ['IMPORT_INLINE_MOTION_UNSUPPORTED', '<div style="-webkit-animation: fade 1s"></div>'],
    ['IMPORT_INLINE_MOTION_UNSUPPORTED', '<div style="-moz-transition: opacity 1s"></div>'],
    ['IMPORT_DECLARATIVE_MOTION_UNSUPPORTED', '<svg><animate attributeName="opacity"></animate></svg>'],
    ['IMPORT_DECLARATIVE_MOTION_UNSUPPORTED', '<svg><animateMotion></animateMotion></svg>'],
    ['IMPORT_DECLARATIVE_MOTION_UNSUPPORTED', '<svg><animateTransform></animateTransform></svg>'],
    ['IMPORT_DECLARATIVE_MOTION_UNSUPPORTED', '<svg><set attributeName="opacity"></set></svg>'],
    ['IMPORT_DECLARATIVE_MOTION_UNSUPPORTED', '<marquee>moving</marquee>'],
    ['IMPORT_EVENT_HANDLER_UNSUPPORTED', '<div onclick="void 0"></div>'],
    ['IMPORT_EVENT_HANDLER_UNSUPPORTED', '<svg onload="void 0"></svg>'],
    ['IMPORT_EVENT_HANDLER_UNSUPPORTED', '<div onanimationend="void 0"></div>'],
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<a href="javascript:void 0">link</a>'],
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<form action="JaVaScRiPt:void 0"></form>'],
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<svg><use href="javascript:void 0"></use></svg>'],
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<img src="javascript:void 0">'],
  ])('rejects executable/declarative HTML escape surface atomically with %s', (code, body) => {
    const result = importMotionHtml(
      `<!doctype html><html><head></head><body>${body}</body></html>`,
    );

    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(JSON.stringify(result.diagnostics)).not.toContain('void 0');
  });
});
