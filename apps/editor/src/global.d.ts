import type { PreviewState, TimelineModel } from '../../../packages/preview-runtime/src/index.js';
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
      switchBranch: (branchId: string) => Promise<void>;
      disconnectEvents: () => void;
      reconnectEvents: () => void;
    };
  }
}

export {};
