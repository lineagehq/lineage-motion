import { createHash } from 'node:crypto';

import postcss, { type AtRule, type Declaration } from 'postcss';
import valueParser from 'postcss-value-parser';

import type { Diagnostic } from '../../domain/src/index.js';

export type FontMaterializationProvenance = {
  originalSourceDigest: string;
  materializedSourceDigest: string;
  resourceLockDigest: string;
  stylesheetDigest: string;
  aggregateFontAssetDigest: string;
  fontAssetCount: number;
};

export type FontMaterializationInput = {
  html: string;
  lockBytes: Uint8Array;
  resources: ReadonlyMap<string, Uint8Array>;
};

export type FontMaterializationResult =
  | {
    ok: true;
    html: string;
    provenance: FontMaterializationProvenance;
    diagnostics: [];
  }
  | {
    ok: false;
    html: null;
    diagnostics: Diagnostic[];
  };

type ResourceRecord = {
  ordinal?: number;
  relativePath: string;
  sourceUrl: string;
  finalUrl: string;
  status: number;
  mime: string;
  byteSize: number;
  sha256: string;
  redirectChain: Array<{
    url: string;
    status: number;
    mime: string;
    location: string | null;
  }>;
  redirectChainDigest: string;
};

type ResourceLock = {
  schemaVersion: 'motion.offline-font-resource-lock.v1';
  sourceReference: string;
  sourceReferenceDigest: string;
  stylesheet: ResourceRecord & { fontFaceCount: number };
  assets: ResourceRecord[];
  aggregateAssetDigest: string;
  licenseAssessment: {
    status: string;
    scope: string;
    redistribution: boolean;
  };
};

const descriptorAllowlist = new Set([
  'font-family',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-display',
  'src',
  'unicode-range',
]);
const fontMimeTypes = new Set([
  'font/woff2',
  'application/font-woff2',
  'font/ttf',
  'font/otf',
]);

export function materializeOfflineFontResources(
  input: FontMaterializationInput,
): FontMaterializationResult {
  const lock = parseLock(input.lockBytes);
  if (!lock) return failure('RESOURCE_LOCK_INVALID', 'The offline resource lock is invalid.');
  if (lock.sourceReferenceDigest !== digest(lock.sourceReference)) {
    return failure('RESOURCE_REFERENCE_DIGEST_MISMATCH', 'The source reference digest does not match.');
  }
  if (!isHttps(lock.sourceReference)
    || lock.stylesheet.sourceUrl !== lock.sourceReference
    || lock.stylesheet.status !== 200
    || lock.stylesheet.mime !== 'text/css'
    || !isSafeRelativePath(lock.stylesheet.relativePath)) {
    return failure('RESOURCE_LOCK_MAPPING_INVALID', 'The stylesheet mapping is invalid.');
  }
  if (!validateResponseRecord(lock.stylesheet)) {
    return failure('RESOURCE_LOCK_REDIRECT_MISMATCH', 'The stylesheet response chain does not match the lock.');
  }
  if (lock.licenseAssessment.status !== 'clear'
    || lock.licenseAssessment.redistribution !== false
    || !lock.licenseAssessment.scope.includes('local')) {
    return failure('RESOURCE_LICENSE_INVALID', 'The offline-use license assessment is invalid.');
  }

  const stylesheetBytes = input.resources.get(lock.stylesheet.relativePath);
  if (!stylesheetBytes
    || stylesheetBytes.byteLength !== lock.stylesheet.byteSize
    || digest(stylesheetBytes) !== lock.stylesheet.sha256) {
    return failure('RESOURCE_LOCK_DIGEST_MISMATCH', 'The stylesheet bytes do not match the lock.');
  }

  const assetPaths = new Set<string>();
  const assetUrls = new Set<string>();
  const assetDigests = new Set<string>();
  for (const [index, asset] of lock.assets.entries()) {
    if (asset.ordinal !== index
      || !isHttps(asset.sourceUrl)
      || asset.status !== 200
      || !fontMimeTypes.has(asset.mime)
      || !isSafeRelativePath(asset.relativePath)
      || assetPaths.has(asset.relativePath)
      || assetUrls.has(asset.sourceUrl)
      || assetDigests.has(asset.sha256)) {
      return failure('RESOURCE_LOCK_ASSET_MAPPING_INVALID', 'A font asset mapping is invalid or duplicated.');
    }
    if (!validateResponseRecord(asset)) {
      return failure('RESOURCE_LOCK_REDIRECT_MISMATCH', 'A font response chain does not match the lock.');
    }
    assetPaths.add(asset.relativePath);
    assetUrls.add(asset.sourceUrl);
    assetDigests.add(asset.sha256);
    const bytes = input.resources.get(asset.relativePath);
    if (!bytes) {
      return failure('RESOURCE_LOCK_ASSET_MISSING', 'A locked font asset is missing.');
    }
    if (bytes.byteLength !== asset.byteSize || digest(bytes) !== asset.sha256) {
      return failure('RESOURCE_LOCK_DIGEST_MISMATCH', 'A font asset does not match the lock.');
    }
    if (!hasFontSignature(bytes, asset.mime)) {
      return failure('RESOURCE_FONT_BYTES_INVALID', 'A locked font asset has an invalid binary signature.');
    }
  }
  if (lock.assets.length === 0
    || digest(lock.assets.map((asset) => asset.sha256).join('\n')) !== lock.aggregateAssetDigest) {
    return failure('RESOURCE_LOCK_AGGREGATE_MISMATCH', 'The aggregate font asset digest does not match.');
  }
  if (input.resources.size !== 1 + lock.assets.length
    || !input.resources.has(lock.stylesheet.relativePath)
    || lock.assets.some((asset) => !input.resources.has(asset.relativePath))) {
    return failure('RESOURCE_LOCK_ASSET_MAPPING_INVALID', 'The provided resource inventory does not match the lock.');
  }

  const sourceReferenceCount = countOccurrences(input.html, lock.sourceReference);
  if (sourceReferenceCount !== 1) {
    return failure('RESOURCE_REFERENCE_COUNT_INVALID', 'Exactly one locked font stylesheet reference is required.');
  }

  let root: postcss.Root;
  try {
    root = postcss.parse(new TextDecoder().decode(stylesheetBytes));
  } catch {
    return failure('RESOURCE_STYLESHEET_PARSE_FAILED', 'The locked font stylesheet could not be parsed.');
  }
  const assetByUrl = new Map(lock.assets.map((asset) => [asset.sourceUrl, asset]));
  const referencedAssetUrls = new Set<string>();
  let fontFaceCount = 0;
  for (const node of root.nodes) {
    if (node.type === 'comment') continue;
    if (node.type !== 'atrule') {
      return failure('RESOURCE_STYLESHEET_NON_FONT_RULE', 'The stylesheet contains a non-font rule.');
    }
    const name = node.name.toLowerCase();
    if (name === 'import') {
      return failure('RESOURCE_STYLESHEET_NESTED_IMPORT', 'Nested imports are not supported.');
    }
    if (name.endsWith('keyframes') || containsMotion(node)) {
      return failure('RESOURCE_STYLESHEET_MOTION', 'Motion syntax is not supported in font resources.');
    }
    if (name !== 'font-face') {
      return failure('RESOURCE_STYLESHEET_NON_FONT_RULE', 'The stylesheet contains an unsupported at-rule.');
    }
    fontFaceCount += 1;
    const result = validateFontFace(node, assetByUrl, input.resources, referencedAssetUrls);
    if (result) return result;
  }
  if (fontFaceCount === 0 || fontFaceCount !== lock.stylesheet.fontFaceCount) {
    return failure('RESOURCE_STYLESHEET_FACE_COUNT_MISMATCH', 'The font-face inventory does not match the lock.');
  }
  if (referencedAssetUrls.size !== lock.assets.length
    || lock.assets.some((asset) => !referencedAssetUrls.has(asset.sourceUrl))) {
    return failure('RESOURCE_LOCK_ASSET_MAPPING_INVALID', 'The stylesheet and font asset inventory do not match.');
  }

  const materializedFontCss = root.toString();
  const replacement = replaceExactStylesheetReference(
    input.html,
    lock.sourceReference,
    materializedFontCss,
  );
  if (!replacement) {
    return failure('RESOURCE_REFERENCE_INVALID', 'The locked stylesheet reference is not an approved import or link.');
  }
  if (containsLiveResource(replacement)) {
    return failure('RESOURCE_LIVE_URL_SURVIVED', 'A live or unresolved resource survived materialization.');
  }

  return {
    ok: true,
    html: replacement,
    provenance: {
      originalSourceDigest: digest(input.html),
      materializedSourceDigest: digest(replacement),
      resourceLockDigest: digest(input.lockBytes),
      stylesheetDigest: digest(stylesheetBytes),
      aggregateFontAssetDigest: lock.aggregateAssetDigest,
      fontAssetCount: lock.assets.length,
    },
    diagnostics: [],
  };
}

function validateFontFace(
  fontFace: AtRule,
  assetByUrl: ReadonlyMap<string, ResourceRecord>,
  resources: ReadonlyMap<string, Uint8Array>,
  referencedAssetUrls: Set<string>,
): FontMaterializationResult | null {
  let hasFamily = false;
  let hasSource = false;
  for (const child of fontFace.nodes ?? []) {
    if (child.type === 'comment') continue;
    if (child.type !== 'decl' || !descriptorAllowlist.has(child.prop.toLowerCase())) {
      return failure('RESOURCE_STYLESHEET_DESCRIPTOR_UNSUPPORTED', 'A font-face descriptor is unsupported.');
    }
    const property = child.prop.toLowerCase();
    if (property === 'font-family') hasFamily = true;
    if (property !== 'src') continue;
    hasSource = true;
    const result = materializeSourceDeclaration(child, assetByUrl, resources, referencedAssetUrls);
    if (result) return result;
  }
  if (!hasFamily || !hasSource) {
    return failure('RESOURCE_STYLESHEET_DESCRIPTOR_MISSING', 'A required font-face descriptor is missing.');
  }
  return null;
}

function materializeSourceDeclaration(
  declaration: Declaration,
  assetByUrl: ReadonlyMap<string, ResourceRecord>,
  resources: ReadonlyMap<string, Uint8Array>,
  referencedAssetUrls: Set<string>,
): FontMaterializationResult | null {
  const parsed = valueParser(declaration.value);
  let urlCount = 0;
  let diagnostic: FontMaterializationResult | null = null;
  parsed.walk((node) => {
    if (diagnostic || node.type !== 'function') return false;
    const functionName = node.value.toLowerCase();
    if (functionName === 'local') {
      diagnostic = failure('RESOURCE_STYLESHEET_LOCAL_SOURCE', 'Local font sources are not supported.');
      return false;
    }
    if (functionName !== 'url' && functionName !== 'format' && functionName !== 'tech') {
      diagnostic = failure('RESOURCE_STYLESHEET_SOURCE_UNSUPPORTED', 'A font source function is unsupported.');
      return false;
    }
    if (functionName !== 'url') return undefined;
    urlCount += 1;
    const rawUrl = valueParser.stringify(node.nodes).trim().replace(/^["']|["']$/g, '');
    const asset = assetByUrl.get(rawUrl);
    if (!asset) {
      diagnostic = failure('RESOURCE_LOCK_UNEXPECTED_URL', 'A font source is not present in the lock.');
      return false;
    }
    const bytes = resources.get(asset.relativePath);
    if (!bytes) {
      diagnostic = failure('RESOURCE_LOCK_ASSET_MISSING', 'A locked font asset is missing.');
      return false;
    }
    referencedAssetUrls.add(rawUrl);
    const dataUrl = `data:${asset.mime};base64,${Buffer.from(bytes).toString('base64')}`;
    node.nodes = [{
      type: 'word',
      value: `"${dataUrl}"`,
      sourceIndex: 0,
      sourceEndIndex: dataUrl.length + 2,
    }];
    return false;
  });
  if (diagnostic) return diagnostic;
  if (urlCount === 0) {
    return failure('RESOURCE_STYLESHEET_SOURCE_MISSING', 'A font-face source has no locked URL.');
  }
  declaration.value = parsed.toString();
  return null;
}

function replaceExactStylesheetReference(
  html: string,
  reference: string,
  fontCss: string,
): string | null {
  const escaped = escapeRegExp(reference);
  const importPattern = new RegExp(
    `@import\\s+(?:url\\(\\s*)?["']${escaped}["']\\s*\\)?\\s*;`,
    'i',
  );
  if (importPattern.test(html)) return html.replace(importPattern, fontCss.trim());
  const linkPattern = new RegExp(
    `<link\\b(?=[^>]*\\brel=["']stylesheet["'])(?=[^>]*\\bhref=["']${escaped}["'])[^>]*>`,
    'i',
  );
  if (linkPattern.test(html)) return html.replace(linkPattern, `<style>${fontCss}</style>`);
  return null;
}

function containsLiveResource(html: string): boolean {
  if (/https?:|@import|local\(/i.test(html)) return true;
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const match of styles) {
    try {
      const root = postcss.parse(match[1] ?? '');
      let live = false;
      root.walkDecls((declaration) => {
        valueParser(declaration.value).walk((node) => {
          if (node.type === 'function' && node.value.toLowerCase() === 'url') {
            const value = valueParser.stringify(node.nodes).trim().replace(/^["']|["']$/g, '');
            if (!value.startsWith('data:')) live = true;
          }
        });
      });
      if (live) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function containsMotion(atRule: AtRule): boolean {
  let found = false;
  atRule.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    if (property === 'animation' || property.startsWith('animation-')) found = true;
  });
  return found;
}

function parseLock(bytes: Uint8Array): ResourceLock | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (value.schemaVersion !== 'motion.offline-font-resource-lock.v1'
      || typeof value.sourceReference !== 'string'
      || typeof value.sourceReferenceDigest !== 'string'
      || !isResourceRecord(value.stylesheet, true)
      || !Array.isArray(value.assets)
      || !value.assets.every((asset) => isResourceRecord(asset, false))
      || typeof value.aggregateAssetDigest !== 'string'
      || !value.licenseAssessment
      || typeof value.licenseAssessment !== 'object') return null;
    return value as unknown as ResourceLock;
  } catch {
    return null;
  }
}

function isResourceRecord(value: unknown, stylesheet: boolean): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.relativePath === 'string'
    && typeof record.sourceUrl === 'string'
    && typeof record.finalUrl === 'string'
    && typeof record.status === 'number'
    && typeof record.mime === 'string'
    && typeof record.byteSize === 'number'
    && typeof record.sha256 === 'string'
    && Array.isArray(record.redirectChain)
    && typeof record.redirectChainDigest === 'string'
    && (stylesheet ? typeof record.fontFaceCount === 'number' : typeof record.ordinal === 'number');
}

function validateResponseRecord(record: ResourceRecord): boolean {
  if (!isHttps(record.finalUrl)
    || record.redirectChain.length === 0
    || digest(JSON.stringify(record.redirectChain)) !== record.redirectChainDigest) return false;
  const first = record.redirectChain[0]!;
  const last = record.redirectChain.at(-1)!;
  if (first.url !== record.sourceUrl
    || last.url !== record.finalUrl
    || last.status !== record.status
    || last.mime !== record.mime
    || last.location !== null) return false;
  return record.redirectChain.every((hop, index) => {
    if (!isHttps(hop.url) || typeof hop.status !== 'number' || typeof hop.mime !== 'string') return false;
    if (index === record.redirectChain.length - 1) return hop.location === null;
    if (!hop.location || !isHttps(hop.location)) return false;
    return hop.location === record.redirectChain[index + 1]!.url;
  });
}

function hasFontSignature(bytes: Uint8Array, mime: string): boolean {
  const signature = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (mime.includes('woff2')) return signature === 'wOF2';
  if (mime === 'font/ttf') {
    return signature === '\x00\x01\x00\x00' || signature === 'true';
  }
  if (mime === 'font/otf') return signature === 'OTTO';
  return false;
}

function failure(code: string, summary: string): FontMaterializationResult {
  return { ok: false, html: null, diagnostics: [{ code, severity: 'error', summary }] };
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.split(/[\\/]/).includes('..');
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
