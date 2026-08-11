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
      };
      dispatch: (operation: AuthoringOperation) => Promise<{ ok: boolean; code?: string }>;
    };
  }
}

export {};
