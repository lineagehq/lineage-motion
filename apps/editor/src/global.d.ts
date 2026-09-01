import type { PreviewOverlayProjection, PreviewState, ProjectionRect, TimelineModel } from '../../../packages/preview-runtime/src/index.js';
import type { AuthoringOperation } from '../../../packages/domain/src/index.js';

declare global {
  interface Window {
    __motionEditor: {
      readonly compiledHtml: string;
      readonly trackIds: string[];
      readonly cueIds: string[];
      readonly canonicalProjection: TimelineModel;
      readState: () => PreviewState;
      inspectAuthoring: () => {
        documentId: string; revision: number; contentDigest: string; exportDigest: string; compiledHtml: string;
        undoCount: number; redoCount: number; consumedOperationIds: string[];
        selectedTrackId: string; selectedKeyframeId: string;
        selectedCreationElementId: string | null;
        unavailableSelection: boolean; unavailableCreation: boolean; draftConflictRevision: number | null; lastCommitSeq: number;
        draftStaleBaseRevision: number | null; draftDirty: boolean; draftValues: Record<string, string>;
        pendingRevision: number | null;
        serviceBacked: boolean; activeBranchId: string; immutableRefetchCount: number;
        lastCommit: import('../../../packages/motion-protocol/src/index.ts').CommitMetadata | null;
      };
      dispatch: (operation: AuthoringOperation) => Promise<{ ok: boolean; code?: string }>;
      openShotWorkspace: (config: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] }) => { ok: boolean; code?: string };
      inspectShotWorkspace: () => { open: boolean; mode: 'pose' | 'path'; momentMs: number; selectedElementIds: string[]; revision: number;
        previewMatchesCompiler: boolean; previewNavigationSourceMatchesCompiler: boolean; projection: PreviewOverlayProjection | null;
        compilerCommit: { committedHtml: string | null; lastNavigationSourceHtml: string | null; committedCompilerCss: string | null;
          activeCompilerCss: string | null; navigationSourceMatchesCommitted: boolean };
        lastPreviewCommitPromotion: { schemaVersion: 'motion.preview-css-commit-promotion.v1'; attempted: boolean;
          promoted: boolean; fallbackCode: string | null };
        waypointReleasePhase: 'idle' | 'flushing-latest' | 'committing' | 'publishing-geometry';
        geometry: Array<{ elementId: string; timeMs: number; contentBounds: ProjectionRect; overlayBounds: ProjectionRect;
          deltasDevicePixels: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number } }>;
        activeDraft: null | { commandBytes: string; compiledHtml: string; exportDigest: string; operation: AuthoringOperation } };
      inspectCueWorkspace: () => { active: boolean; pickRole: 'cursor' | 'pulse' | 'reveal' | null;
        selectedRoles: { cursor: boolean; pulse: boolean; reveal: boolean }; targetCandidateCount: number; pathHandleCount: number;
        authoredCues: Array<{ kind: 'cursor-path' | 'click' | 'reveal'; semantic: unknown; generatedTrackCount: number }> };
      switchBranch: (branchId: string) => Promise<void>;
      disconnectEvents: () => void;
      reconnectEvents: () => void;
    };
  }
}

export {};
