import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';

import {
  canonicalBytes,
  deriveElementId,
  sha256Hex,
  validateMotionDocument,
  type MotionDocument,
} from './index.js';

const validDocument = (): MotionDocument => ({
  schemaVersion: 'motion.document.v1',
  documentId: 'doc_synthetic',
  revision: 0,
  durationMs: 1000,
  presentation: {
    html: '<main data-motion-id="el_root"></main>',
    css: 'main { display: block; }\n',
  },
  elements: [
    {
      id: 'el_root',
      selectorHint: '.first-hint',
      structuralFingerprint: 'html/body/main[0]',
    },
  ],
  rules: [
    {
      id: 'rule_fade',
      sourceName: 'fade',
      tracks: [
        {
          id: 'track_fade_opacity',
          property: 'opacity',
          interpolation: 'continuous',
          keyframes: [
            { id: 'kf_0', offset: 0, value: '0' },
            { id: 'kf_1', offset: 1, value: '1' },
          ],
        },
      ],
    },
  ],
  applications: [
    {
      id: 'app_root',
      bindings: [{ elementId: 'el_root', delayOverridesMs: [0] }],
      selectorHint: '.first-hint',
      slots: [
        {
          id: 'slot_root_0',
          ruleId: 'rule_fade',
          durationMs: 1000,
          delayMs: 0,
          iterationCount: 1,
          direction: 'normal',
          fillMode: 'both',
          playState: 'running',
          timingFunction: { kind: 'keyword', value: 'linear' },
        },
      ],
    },
  ],
  tracks: [
    {
      id: 'element_track_root_opacity',
      elementId: 'el_root',
      ruleId: 'rule_fade',
      slotId: 'slot_root_0',
      property: 'opacity',
      interpolation: 'continuous',
      keyframeIds: ['kf_0', 'kf_1'],
    },
  ],
  cues: [],
  inventory: {
    sourceDigest: 'a'.repeat(64),
    ruleCount: 1,
    applicationCount: 1,
    slotCount: 1,
    trackCount: 1,
    supportedCount: 4,
    unsupportedCount: 0,
    missingCount: 0,
    diagnosticCodes: [],
  },
  provenance: {
    sourceKind: 'direct',
    originalSourceDigest: 'a'.repeat(64),
    materializedSourceDigest: 'a'.repeat(64),
    resourceLockDigest: null,
    stylesheetDigest: null,
    aggregateFontAssetDigest: null,
    fontAssetCount: 0,
  },
  reducedMotion: { mode: 'source-snapshot', css: '' },
});

describe('motion.document.v1', () => {
  test.each(['', 'abc', 'Neutral motion \u2603'])('browser-safe SHA-256 matches Node crypto', (value) => {
    expect(sha256Hex(value)).toBe(createHash('sha256').update(value).digest('hex'));
  });
  test('rejects a track that references an unknown canonical element', () => {
    const document = validDocument();
    document.tracks[0]!.elementId = 'el_missing';

    const result = validateMotionDocument(document);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'DOMAIN_UNKNOWN_ELEMENT',
          severity: 'error',
          summary: 'A track references an unknown canonical element.',
        },
      ],
    });
  });

  test('serializes equal documents to byte-identical canonical JSON', () => {
    const first = validDocument();
    const second = structuredClone(first);

    expect(canonicalBytes(first)).toEqual(canonicalBytes(second));
    expect(canonicalBytes(first).at(-1)).toBe(10);
  });

  test('validates schema-versioned cues and includes them in canonical bytes', () => {
    const withoutCue = validDocument();
    const withCue = validDocument();
    withCue.cues = [{
      schemaVersion: 'motion.cue.v1',
      id: 'cue_settle',
      label: 'Settle',
      timeMs: 750,
    }];

    expect(validateMotionDocument(withCue)).toEqual({ ok: true, document: withCue });
    expect(canonicalBytes(withCue)).not.toEqual(canonicalBytes(withoutCue));
  });

  test.each([
    ['DOMAIN_SCHEMA_INVALID', (document: MotionDocument) => {
      document.cues = [{
        schemaVersion: 'motion.cue.v1', id: 'cue_bad', label: '', timeMs: 100,
      }];
    }],
    ['DOMAIN_CUE_TIME_INVALID', (document: MotionDocument) => {
      document.cues = [{
        schemaVersion: 'motion.cue.v1', id: 'cue_late', label: 'Late', timeMs: 1001,
      }];
    }],
    ['DOMAIN_DUPLICATE_ID', (document: MotionDocument) => {
      document.cues = [
        { schemaVersion: 'motion.cue.v1', id: 'cue_same', label: 'First', timeMs: 100 },
        { schemaVersion: 'motion.cue.v1', id: 'cue_same', label: 'Second', timeMs: 200 },
      ];
    }],
  ])('rejects invalid canonical cues deterministically with %s', (code, mutate) => {
    const document = validDocument();
    mutate(document);

    expect(validateMotionDocument(document)).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code })],
    });
    expect(validateMotionDocument(structuredClone(document))).toEqual(
      validateMotionDocument(document),
    );
  });

  test('derives stable element identity from structure rather than selector hints', () => {
    const fingerprint = 'html/body/main[0]/section[1]';

    expect(deriveElementId(fingerprint, 0)).toBe(
      deriveElementId(fingerprint, 0),
    );
    expect(deriveElementId(fingerprint, 0)).not.toBe(
      deriveElementId('html/body/main[0]/section[2]', 0),
    );
  });

  test('uses collision ordinals to distinguish otherwise identical structural fingerprints', () => {
    const fingerprint = 'html[0]/body[0]/div[0]';

    expect(deriveElementId(fingerprint, 0)).toBe(deriveElementId(fingerprint, 0));
    expect(deriveElementId(fingerprint, 1)).toBe(deriveElementId(fingerprint, 1));
    expect(deriveElementId(fingerprint, 0)).not.toBe(deriveElementId(fingerprint, 1));
  });

  test.each([
    ['duplicate canonical element ID', (document: MotionDocument) => {
      document.elements.push(structuredClone(document.elements[0]!));
    }],
    ['duplicate application ID', (document: MotionDocument) => {
      document.applications.push(structuredClone(document.applications[0]!));
      document.inventory.applicationCount = 2;
      document.inventory.slotCount = 2;
    }],
    ['duplicate slot ID', (document: MotionDocument) => {
      document.applications[0]!.slots.push(structuredClone(document.applications[0]!.slots[0]!));
      document.applications[0]!.bindings[0]!.delayOverridesMs.push(0);
      document.inventory.slotCount = 2;
    }],
    ['duplicate rule-track ID', (document: MotionDocument) => {
      document.rules[0]!.tracks.push(structuredClone(document.rules[0]!.tracks[0]!));
    }],
    ['duplicate keyframe ID', (document: MotionDocument) => {
      document.rules[0]!.tracks[0]!.keyframes[1]!.id = 'kf_0';
    }],
    ['duplicate expanded-track ID', (document: MotionDocument) => {
      document.tracks.push(structuredClone(document.tracks[0]!));
      document.inventory.trackCount = 2;
    }],
  ])('rejects %s', (_name, mutate) => {
    const document = validDocument();
    mutate(document);

    expect(validateMotionDocument(document)).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'DOMAIN_DUPLICATE_ID' })],
    });
  });

  test.each([
    ['DOMAIN_UNKNOWN_MOTION_REFERENCE', (document: MotionDocument) => {
      document.applications[0]!.slots[0]!.ruleId = 'rule_missing';
    }],
    ['DOMAIN_TRACK_RELATIONSHIP_INVALID', (document: MotionDocument) => {
      document.tracks[0]!.property = 'transform';
    }],
    ['DOMAIN_TRACK_KEYFRAMES_MISMATCH', (document: MotionDocument) => {
      document.tracks[0]!.keyframeIds.reverse();
    }],
    ['DOMAIN_EXPANDED_TRACK_SET_MISMATCH', (document: MotionDocument) => {
      document.tracks = [];
      document.inventory.trackCount = 0;
    }],
    ['DOMAIN_PROVENANCE_INVALID', (document: MotionDocument) => {
      document.provenance.originalSourceDigest = 'b'.repeat(64);
    }],
  ])('rejects inconsistent canonical graph with %s', (code, mutate) => {
    const document = validDocument();
    mutate(document);

    expect(validateMotionDocument(document)).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code })],
    });
  });
});
