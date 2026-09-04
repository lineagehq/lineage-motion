import type { SemanticAnimationInstance } from '../../domain/src/css-motion-semantics.js';
import type { ConstructRecord, OwnerInput, SamplePoint } from './index.js';

export type Inventory = OwnerInput['expectedInventory'];
export type AnimationRecord = SemanticAnimationInstance & Readonly<{
  keyframes: readonly (SemanticAnimationInstance['keyframes'][number] & { values: Readonly<Record<string, string>> })[];
}>;
export type StateRecord = Readonly<{
  targetId: string; computed: Readonly<Record<string, string>>;
  bounds: readonly [number, number, number, number]; pixelsSha256: string;
}>;
export type Observation = Readonly<{
  provenance: readonly Readonly<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }>[];
  animations: readonly AnimationRecord[];
  samples: readonly Readonly<{ timeMs: number; states: readonly StateRecord[] }>[];
  initialDigest: string; resetDigest: string; requests: readonly string[]; errors: readonly string[];
  resetCheckpoints: Readonly<{ beforeStart: string; afterStart: string; postLoop: string; afterReset: string }>;
  mutations: number; events: readonly string[];
}>;
export type Prepared = Readonly<{
  replayHtml: string; replayCss: string; inventory: Inventory; ledger: readonly ConstructRecord[];
  schedule: readonly SamplePoint[]; provenance: readonly Readonly<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }>[];
  requestLedger: readonly string[]; errors: readonly string[]; mutations: number;
}>;
export type LockedStylesheet = Readonly<{
  kind: 'inline' | 'external';
  css: string;
  href?: string;
}>;

