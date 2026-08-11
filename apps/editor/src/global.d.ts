import type { PreviewState, TimelineModel } from '../../../packages/preview-runtime/src/index.js';

declare global {
  interface Window {
    __motionEditor: {
      compiledHtml: string;
      trackIds: string[];
      cueIds: string[];
      canonicalProjection: TimelineModel;
      readState: () => PreviewState;
    };
  }
}

export {};
