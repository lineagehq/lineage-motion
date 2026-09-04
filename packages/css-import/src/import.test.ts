import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { importMotionHtml } from './index.js';

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/public-synthetic/foundation.html', import.meta.url),
);
const longhandFixturePath = fileURLToPath(
  new URL('../../../fixtures/public-synthetic/animation-longhands-reduced-motion.html', import.meta.url),
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
    ['IMPORT_ANIMATION_LONGHAND_INCOMPLETE', '.shape { animation-timing-function: linear; }'],
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

  test('fails atomically instead of dropping an unregistered motion-path progress track', () => {
    const result = importMotionHtml(`<!doctype html><html><head><style>
      .shape { animation: travel 2100ms linear both; }
      @keyframes travel {
        0% { offset-distance: 0%; transform: translate(0px, 0px); }
        33.333333% { offset-distance: 40%; transform: translate(40px, 20px); }
        100% { offset-distance: 100%; transform: translate(100px, 50px); }
      }
    </style></head><body><div class="shape"></div></body></html>`);

    expect(result.document).toBeNull();
    expect(result.inventory).toMatchObject({
      ruleCount: 1,
      applicationCount: 1,
      slotCount: 1,
      trackCount: 1,
      unsupportedCount: 1,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'IMPORT_ANIMATED_PROPERTY_UNSUPPORTED' }),
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

  test('imports one complete distributed longhand tuple and retains exact reduced presentation', async () => {
    const result = importMotionHtml(await readFile(longhandFixturePath, 'utf8'));

    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(result.inventory).toMatchObject({
      ruleCount: 1, applicationCount: 1, slotCount: 1, trackCount: 2,
      unsupportedCount: 0, missingCount: 0,
    });
    expect(result.document!.applications[0]!.slots[0]).toMatchObject({
      durationMs: 1200, delayMs: 100, iterationCount: 1,
      direction: 'normal', fillMode: 'both', playState: 'running',
      timingFunction: { kind: 'keyword', value: 'linear' },
    });
    expect(result.document!.applications[0]!.bindings[0]!.delayOverridesMs).toEqual([100]);
    expect(result.document!.presentation.css).not.toMatch(/animation-|@media|@keyframes/);
    expect(result.document!.reducedMotion.css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(result.document!.reducedMotion.css).toContain('animation: none');
    expect(result.document!.reducedMotion.css).toContain('background: rgb(90, 99, 116)');
    expect(result.document!.reducedMotion.css).toContain('.proof-peer { opacity: 1; }');
  });

  test.each([
    ['IMPORT_ANIMATION_LONGHAND_INCOMPLETE', '.target { animation-name: move; }'],
    ['IMPORT_ANIMATION_LONGHAND_INVALID', completeLonghands('animation-duration: var(--duration);')],
    ['IMPORT_ANIMATION_LONGHAND_INVALID', completeLonghands('animation-fill-mode: inherit;')],
    ['IMPORT_ANIMATION_LONGHAND_INVALID', completeLonghands('animation-name: move, other;')],
    ['IMPORT_ANIMATION_LONGHAND_INVALID', completeLonghands('animation-duration: 1s !important;')],
    ['IMPORT_ANIMATION_LONGHAND_CONFLICT', `${completeLonghands()} .target { animation-duration: 2s; }`],
    ['IMPORT_ANIMATION_LONGHAND_INVALID', `${completeLonghands()} .target { animation: move 1s; }`],
    ['IMPORT_COMPOSITION_UNSUPPORTED', '.target { animation-composition: add; }'],
  ])('rejects hostile longhand grammar atomically with %s', (code, css) => {
    const result = importMotionHtml(longhandSource(css));
    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });

  test.each([
    '@media (prefers-reduced-motion: reduce) { .target { transition: none; } }',
    '@media (prefers-reduced-motion: reduce) { .target::before { animation: none; } }',
    '@media (prefers-reduced-motion: reduce) { @supports (display: grid) { .target { animation: none; } } }',
    '@media (prefers-reduced-motion: reduce) { .target { animation: none !important; } }',
    '@media (prefers-reduced-motion: reduce) { .target { animation-duration: calc(0ms); } }',
  ])('rejects reduced-motion branches outside the registered snapshot', (css) => {
    const result = importMotionHtml(longhandSource(`${completeLonghands()} ${css}`));
    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'IMPORT_RESPONSIVE_MOTION',
    );
  });

  test('accepts only registered duration/timing overrides alongside animation:none', () => {
    const css = `${completeLonghands()} @media (prefers-reduced-motion: reduce) {
      .target { animation: none; animation-duration: .001ms; animation-timing-function: linear; opacity: 1; }
    }`;
    const result = importMotionHtml(longhandSource(css));
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.reducedMotion.css).toContain('animation-duration: .001ms');
    expect(result.document?.reducedMotion.css).toContain('animation-timing-function: linear');
  });

  test('accepts a registered finite duration/timing reduced-motion snapshot without animation:none', () => {
    const result = importMotionHtml(longhandSource(`${completeLonghands()}
      @media (prefers-reduced-motion: reduce) {
        .target { animation-duration: 0ms; animation-timing-function: steps(1, end); opacity: 1; }
      }`));
    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
  });

  test.each([
    'animation-duration: 1ms, 2ms',
    'animation-duration: var(--duration)',
    'animation-duration: 1ms !important',
    'animation-timing-function: linear, ease',
    'animation-timing-function: frames(2)',
    'animation-delay: 0ms',
    '--motion: 1',
  ])('rejects hostile registered reduced-motion declaration grammar: %s', (declaration) => {
    const result = importMotionHtml(longhandSource(`${completeLonghands()}
      @media (prefers-reduced-motion: reduce) { .target { animation: none; ${declaration}; } }`));
    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('IMPORT_RESPONSIVE_MOTION');
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
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<a href="vbscript:msgbox(1)">link</a>'],
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<object data="data:text/html,<script>void 0</script>"></object>'],
    ['IMPORT_JAVASCRIPT_URL_UNSUPPORTED', '<a href="java&#x09;script:void 0">link</a>'],
  ])('rejects executable/declarative HTML escape surface atomically with %s', (code, body) => {
    const result = importMotionHtml(
      `<!doctype html><html><head></head><body>${body}</body></html>`,
    );

    expect(result.document).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(JSON.stringify(result.diagnostics)).not.toContain('void 0');
  });
});

function completeLonghands(replacement = ''): string {
  const declarations = [
    'animation-name: move;', 'animation-duration: 1s;',
    'animation-timing-function: linear;', 'animation-delay: 0ms;',
    'animation-iteration-count: 1;', 'animation-direction: normal;',
    'animation-fill-mode: both;', 'animation-play-state: running;',
  ];
  if (replacement) {
    const property = replacement.slice(0, replacement.indexOf(':'));
    const index = declarations.findIndex((declaration) => declaration.startsWith(`${property}:`));
    declarations[index] = replacement;
  }
  return `.target { ${declarations.join(' ')} }`;
}

function longhandSource(css: string): string {
  return `<!doctype html><html><head><style>
    ${css}
    @keyframes move { from { transform: translateX(0px); } to { transform: translateX(10px); } }
  </style></head><body><div class="target"></div></body></html>`;
}
