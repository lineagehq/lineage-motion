import { expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.ts';
import { createTrajectorySeed, createPhase4ReusableCueSeed } from '../../local-service/src/seed.ts';
import { certifySequenceViewport } from './sequence-viewport.ts';
const source = '<html><head><style>html,body{margin:0;width:320px;height:180px;overflow:hidden}.actor{width:20px;height:20px;animation:move 2s linear both}@keyframes move{from{transform:translateX(0px)}to{transform:translateX(100px)}}</style></head><body><div class="actor"></div><div></div></body></html>';
function imported(html = source) {
  const result = importMotionHtml(html); expect(result.document).not.toBeNull();
  return result.document!;
}
test('certifies the actual two public starters and fixed root imports', () => {
  expect(certifySequenceViewport(createTrajectorySeed())).toEqual({ widthCssPixels: 800, heightCssPixels: 450 });
  expect(certifySequenceViewport(createPhase4ReusableCueSeed())).toEqual({ widthCssPixels: 640, heightCssPixels: 360 });
  expect(certifySequenceViewport(imported())).toEqual({ widthCssPixels: 320, heightCssPixels: 180 });
});
test.each([
  'body{width:321px}', 'body{width:320px!important}', '@media(min-width:1px){body{width:320px}}',
  'body{width:var(--size)}', 'body{inline-size:320px}', 'body{padding:1px}', 'html{transform:scale(2)}',
  'body{all:initial}', 'body:hover{width:10px}', 'body:has(.actor:hover){padding:10px}',
  'body::before{content:"x"}', '@layer other{body{width:320px}}', 'body{overflow-x:visible}',
  'body{margin-left:auto}', 'body{min-width:400px}', 'body{position:fixed}',
])('rejects ambiguous or changing boundary geometry: %s', css => {
  const document = imported(); document.presentation.css += css;
  expect(() => certifySequenceViewport(document)).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
});
test('checks inline boundary styles and requires explicit clipping', () => {
  expect(() => certifySequenceViewport(imported(source.replace('<body>', '<body style="width:400px">')))).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
  expect(() => certifySequenceViewport(imported(source.replace('overflow:hidden', '')))).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
});
test('resolves static complex selectors without rejecting interior geometry', () => {
  const document = imported(); document.presentation.css += 'body > .actor:first-child{width:30px} body:not(.absent){width:320px}';
  expect(certifySequenceViewport(document)).toEqual({ widthCssPixels: 320, heightCssPixels: 180 });
  document.presentation.css += 'html > body:not(.absent){width:321px}';
  expect(() => certifySequenceViewport(document)).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
});
test('rejects boundary animations and reduced-motion geometry', () => {
  const document = imported(); document.presentation.html = document.presentation.html.replace('<body>', `<body data-motion-id="${document.elements[0]!.id}">`);
  expect(() => certifySequenceViewport(document)).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
  const other = imported(); other.reducedMotion.css = '@media(prefers-reduced-motion:reduce){body{width:640px;animation:none}}';
  expect(() => certifySequenceViewport(other)).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
});
test('stage shape requires a single neutral fixed-size child and no extra flow text', () => {
  const document = createTrajectorySeed();
  document.presentation.html = document.presentation.html.replace('</body>', 'extra text</body>');
  expect(() => certifySequenceViewport(document)).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
});

test('does not assume a conditional embedded stylesheet is unconditional', () => {
  const document = imported(); document.presentation.html = document.presentation.html.replace('</head>', '<style media="print">body{width:320px}</style></head>');
  expect(() => certifySequenceViewport(document)).toThrow('SEQUENCE_VIEWPORT_UNSUPPORTED');
});

test('fixed roots do not treat their sole animated child as a stage boundary', () => {
  expect(certifySequenceViewport(imported(source.replace('<div></div>', '')))).toEqual({ widthCssPixels: 320, heightCssPixels: 180 });
});
