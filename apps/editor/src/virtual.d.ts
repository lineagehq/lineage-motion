declare module 'virtual:motion-document' {
  const payload: {
    document: import('../../../packages/domain/src/index.js').MotionDocument;
    compiled: import('../../../packages/css-compiler/src/index.js').CompilerResult;
    serviceBacked: boolean;
    humanCapability: string | null;
    shotWorkspace?: {
      schemaVersion: 'motion.editor-shot-workspace.v1';
      documentId: string;
      startMs: 0;
      landedMs: 700;
      settledMs: 2100;
      targetElementIds: string[];
    };
  };
  export default payload;
}
