import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { importMotionHtml, materializeOfflineFontResources } from './index.js';

const stylesheetReference = 'https://styles.example.invalid/font.css';
const assetReference = 'https://assets.example.invalid/font.woff2';
const fontBytes = Buffer.from('wOF2-synthetic-font-bytes');
const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

function fontCss(source = `url("${assetReference}") format("woff2")`): string {
  return `/* synthetic font */
@font-face {
  font-family: "Synthetic Sans";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: ${source};
  unicode-range: U+0000-00FF;
}
`;
}

function bundle(stylesheet = fontCss()): {
  html: string;
  lockBytes: Uint8Array;
  resources: Map<string, Uint8Array>;
} {
  const stylesheetBytes = Buffer.from(stylesheet);
  const assetDigest = sha256(fontBytes);
  const stylesheetChain = [{
    url: stylesheetReference,
    status: 200,
    mime: 'text/css',
    location: null,
  }];
  const assetChain = [{
    url: assetReference,
    status: 200,
    mime: 'font/woff2',
    location: null,
  }];
  const lock = {
    schemaVersion: 'motion.offline-font-resource-lock.v1',
    sourceReference: stylesheetReference,
    sourceReferenceDigest: sha256(stylesheetReference),
    requestHeaders: { accept: '*/*' },
    stylesheet: {
      relativePath: 'stylesheet.css',
      sourceUrl: stylesheetReference,
      finalUrl: stylesheetReference,
      status: 200,
      mime: 'text/css',
      byteSize: stylesheetBytes.length,
      sha256: sha256(stylesheetBytes),
      redirectChain: stylesheetChain,
      redirectChainDigest: sha256(JSON.stringify(stylesheetChain)),
      fontFaceCount: 1,
    },
    assets: [{
      ordinal: 0,
      sourceUrl: assetReference,
      finalUrl: assetReference,
      relativePath: 'assets/000.woff2',
      status: 200,
      mime: 'font/woff2',
      byteSize: fontBytes.length,
      sha256: assetDigest,
      redirectChain: assetChain,
      redirectChainDigest: sha256(JSON.stringify(assetChain)),
      copyrightMetadataPresent: false,
    }],
    aggregateAssetDigest: sha256(assetDigest),
    licenseAssessment: {
      status: 'clear',
      scope: 'local-ignored-acceptance-only',
      basis: 'synthetic-test',
      redistribution: false,
    },
  };
  return {
    html: `<!doctype html><html><head><style>@import url("${stylesheetReference}");
      .shape { width: 10px; animation: fade 1s linear; }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    </style></head><body><div class="shape"></div></body></html>`,
    lockBytes: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`),
    resources: new Map([
      ['stylesheet.css', stylesheetBytes],
      ['assets/000.woff2', fontBytes],
    ]),
  };
}

describe('offline-pinned-font-materialization-v1', () => {
  test('embeds every verified font byte and removes the exact external reference', () => {
    const input = bundle();

    const result = materializeOfflineFontResources(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('data:font/woff2;base64,');
    expect(result.html).not.toMatch(/https?:|@import|local\(|url\((?!["']?data:)/i);
    expect(result.provenance).toMatchObject({
      originalSourceDigest: sha256(input.html),
      stylesheetDigest: sha256(fontCss()),
      aggregateFontAssetDigest: sha256(sha256(fontBytes)),
      fontAssetCount: 1,
    });
    expect(result.provenance.materializedSourceDigest).toBe(sha256(result.html));
    expect(result.diagnostics).toEqual([]);

    const imported = importMotionHtml(result.html, result.provenance);
    expect(imported.document?.provenance).toEqual({
      sourceKind: 'offline-font-materialized',
      ...result.provenance,
    });
  });

  test.each([
    ['RESOURCE_LOCK_DIGEST_MISMATCH', (input: ReturnType<typeof bundle>) => {
      const lock = JSON.parse(new TextDecoder().decode(input.lockBytes));
      lock.stylesheet.sha256 = '0'.repeat(64);
      input.lockBytes = Buffer.from(JSON.stringify(lock));
    }],
    ['RESOURCE_LOCK_ASSET_MISSING', (input: ReturnType<typeof bundle>) => {
      input.resources.delete('assets/000.woff2');
    }],
    ['RESOURCE_LOCK_ASSET_MAPPING_INVALID', (input: ReturnType<typeof bundle>) => {
      const lock = JSON.parse(new TextDecoder().decode(input.lockBytes));
      const arbitrary = Buffer.from('arbitrary-binary-content');
      lock.assets[0].mime = 'application/octet-stream';
      lock.assets[0].byteSize = arbitrary.length;
      lock.assets[0].sha256 = sha256(arbitrary);
      lock.assets[0].redirectChain[0].mime = 'application/octet-stream';
      lock.assets[0].redirectChainDigest = sha256(JSON.stringify(lock.assets[0].redirectChain));
      lock.aggregateAssetDigest = sha256(lock.assets[0].sha256);
      input.resources.set('assets/000.woff2', arbitrary);
      input.lockBytes = Buffer.from(JSON.stringify(lock));
    }],
    ['RESOURCE_LOCK_REDIRECT_MISMATCH', (input: ReturnType<typeof bundle>) => {
      const lock = JSON.parse(new TextDecoder().decode(input.lockBytes));
      lock.stylesheet.redirectChainDigest = '0'.repeat(64);
      input.lockBytes = Buffer.from(JSON.stringify(lock));
    }],
    ['RESOURCE_STYLESHEET_NON_FONT_RULE', (input: ReturnType<typeof bundle>) => {
      replaceStylesheet(input, '.ordinary { color: red; }');
    }],
    ['RESOURCE_STYLESHEET_NESTED_IMPORT', (input: ReturnType<typeof bundle>) => {
      replaceStylesheet(input, '@import url("https://unexpected.invalid/other.css");');
    }],
    ['RESOURCE_STYLESHEET_MOTION', (input: ReturnType<typeof bundle>) => {
      replaceStylesheet(input, '@keyframes move { to { transform: none; } }');
    }],
    ['RESOURCE_STYLESHEET_DESCRIPTOR_UNSUPPORTED', (input: ReturnType<typeof bundle>) => {
      replaceStylesheet(input, fontCss().replace('font-display: swap;', 'unknown-font-field: value;'));
    }],
    ['RESOURCE_STYLESHEET_LOCAL_SOURCE', (input: ReturnType<typeof bundle>) => {
      replaceStylesheet(input, fontCss('local("Synthetic Sans"), url("https://assets.example.invalid/font.woff2")'));
    }],
    ['RESOURCE_LOCK_UNEXPECTED_URL', (input: ReturnType<typeof bundle>) => {
      replaceStylesheet(input, fontCss('url("https://unexpected.invalid/font.woff2")'));
    }],
  ])('fails atomically with sanitized %s', (code, mutate) => {
    const input = bundle();
    mutate(input);

    const result = materializeOfflineFontResources(input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.html).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(
      /https?:|example\.invalid|Synthetic Sans|stylesheet\.css|assets\//,
    );
  });

  test('requires exactly one explicitly locked reference', () => {
    const input = bundle();
    input.html = input.html.replace('</style>', `@import url("${stylesheetReference}");</style>`);

    const result = materializeOfflineFontResources(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'RESOURCE_REFERENCE_COUNT_INVALID',
      ]);
    }
  });
});

function replaceStylesheet(
  input: ReturnType<typeof bundle>,
  stylesheet: string,
): void {
  const bytes = Buffer.from(stylesheet);
  input.resources.set('stylesheet.css', bytes);
  const lock = JSON.parse(new TextDecoder().decode(input.lockBytes));
  lock.stylesheet.byteSize = bytes.length;
  lock.stylesheet.sha256 = sha256(bytes);
  input.lockBytes = Buffer.from(JSON.stringify(lock));
}
