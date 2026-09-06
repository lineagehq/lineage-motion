import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

function isInsideCheckout(root, candidate) {
  const path = relative(root, candidate);
  return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

// This command owns configuration; the lower-level launcher remains available to tests.
try {
  const { values } = parseArgs({ options: {
    project: { type: 'string', default: 'My animation' },
    'data-dir': { type: 'string' }, port: { type: 'string', default: '4173' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: npm run dev:editor -- [--project "My animation"] [--data-dir /external/directory] [--port 4173]\nReopen with the same project name and checkout to retain edits. Use --port 0 for an available port.');
  } else {
    const root = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));
    const project = values.project.trim();
    if (!project || project.length > 120 || /[\x00-\x1f]/.test(project)) throw new Error('PROJECT_NAME_INVALID');
    const port = Number(values.port);
    if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port > 65535) throw new Error('PORT_INVALID');
    const base = resolve(values['data-dir'] ?? join(homedir(), '.local', 'share', 'lineage-motion'));
    if (isInsideCheckout(root, base)) throw new Error('DATA_DIRECTORY_INSIDE_CHECKOUT');
    mkdirSync(base, { recursive: true, mode: 0o700 });
    const resolvedBase = realpathSync(base);
    if (isInsideCheckout(root, resolvedBase)) throw new Error('DATA_DIRECTORY_INSIDE_CHECKOUT');
    const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
    const directory = join(resolvedBase, digest(root), digest(project));
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    process.env.PHASE3_DATABASE_PATH = join(directory, 'project.sqlite');
    process.env.PHASE3_EDITOR_PORT = String(port);
    process.env.PHASE3_HUMAN_CAPABILITY = randomBytes(32).toString('base64url');
    process.env.PHASE3_AGENT_CAPABILITY = randomBytes(32).toString('base64url');
    for (const key of ['PHASE4_REUSABLE_CUES', 'PHASE4_CURSOR_CLICK_REVEAL', 'LANDING_SHOT1_WORKSPACE', 'PHASE3_SERVICE_URL']) delete process.env[key];
    process.env.MOTION_PROJECT_NAME = project;
    const { launchEditor } = await import('./editor-server.mjs');
    await launchEditor({ onReady: (addresses) => {
      const contextPath = join(directory, 'session.json');
      writeFileSync(contextPath, JSON.stringify({ schemaVersion: 'motion.local-session.v1', project,
        ...addresses, agentCapability: process.env.PHASE3_AGENT_CAPABILITY }), { mode: 0o600 });
      chmodSync(contextPath, 0o600);
      console.log(`Open ${addresses.editorUrl}\nProject: ${project}\nLocal agent session: ${contextPath}\nPress Ctrl+C to stop. Edits are saved locally.`);
      return () => rmSync(contextPath, { force: true });
    } });
  }
} catch (error) {
  const code = String(error?.code ?? error?.message ?? 'STARTUP_FAILED');
  const message = code.includes('PORT') || code.includes('EADDRINUSE') || code.includes('already in use')
    ? 'That port is unavailable. Stop the other app or choose --port 0.'
    : code.includes('LOCK') ? 'This project is already open. Stop its other launcher before reopening it.'
    : code === 'PROJECT_NAME_INVALID' ? 'Choose a project name of 1–120 printable characters.'
    : code === 'DATA_DIRECTORY_INSIDE_CHECKOUT' ? 'Choose --data-dir outside the checkout to keep local data out of Git.'
    : 'Could not start the local project. Check that --data-dir is writable and outside the checkout, then try again.';
  console.error(`Lineage Motion: ${message}`); process.exit(1);
}
