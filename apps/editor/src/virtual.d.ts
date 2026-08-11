declare module 'virtual:motion-document' {
  const payload: {
    document: import('../../../packages/domain/src/index.js').MotionDocument;
    compiled: import('../../../packages/css-compiler/src/index.js').CompilerResult;
  };
  export default payload;
}
