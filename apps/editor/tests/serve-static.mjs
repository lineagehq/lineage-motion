import { createServer } from 'vite';

// A deliberately nonpersistent editor for rejection and local-layout tests.
const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' });
await new Promise((resolve, reject) => {
  server.httpServer.once('error', reject);
  server.httpServer.listen(0, '127.0.0.1', resolve);
});
const address = server.httpServer.address();
const editorUrl = `http://lineage-motion.localhost:${address.port}`;
console.log(JSON.stringify({ editorUrl, serviceUrl: editorUrl }));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  void server.close().then(() => process.exit(0));
});
