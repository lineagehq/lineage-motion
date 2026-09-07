import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type SessionContext = { project: string; projectId?: string; service: string; capability: string; directory: string; fingerprint: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function checkoutRoot(cwd = process.cwd()): string {
  try { return realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
  catch { throw new Error('CLI_PROJECT_DIRECTORY_REQUIRED'); }
}
export function sessionRoot(dataDir?: string, cwd?: string): string {
  const root = checkoutRoot(cwd);
  return join(resolve(dataDir ?? join(homedir(), '.local/share/lineage-motion')), hash(root).slice(0, 24));
}
export function sessionPath(project: string, dataDir?: string, cwd?: string): string {
  return join(sessionRoot(dataDir, cwd), hash(project).slice(0, 24), 'session.json');
}
export function privateRead(path: string): string {
  // O_NOFOLLOW closes the leaf symlink race; compare the opened file to the inspected inode.
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.())
    throw new Error('CLI_SESSION_UNSAFE');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size > 64_000
      || !opened.isFile() || (opened.mode & 0o777) !== 0o600 || opened.uid !== process.getuid?.())
      throw new Error('CLI_SESSION_UNSAFE');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
export function safeDirectory(path: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || info.uid !== process.getuid?.())
    throw new Error('CLI_SESSION_UNSAFE');
}
export function loopbackUrl(value: unknown, editor = false): string {
  if (typeof value !== 'string') throw new Error('CLI_SESSION_INVALID');
  let url: URL; try { url = new URL(value); } catch { throw new Error('CLI_SESSION_INVALID'); }
  if (url.protocol !== 'http:' || ![...['127.0.0.1', '[::1]'], ...(editor ? ['lineage-motion.localhost'] : [])].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('CLI_SESSION_UNSAFE');
  return url.origin;
}
function loadSessions(project?: string, dataDir?: string, cwd?: string): SessionContext[] {
  try {
    const root = sessionRoot(dataDir, cwd);
    safeDirectory(dirname(root)); safeDirectory(root);
    const directories = project ? [hash(project).slice(0, 24)] : readdirSync(root).filter((name) => /^[a-f0-9]{24}$/.test(name));
    const sessions: SessionContext[] = [];
    for (const name of directories) {
      const directory = join(root, name); safeDirectory(directory);
      let source: string;
      try { source = privateRead(join(directory, 'session.json')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !project) continue; throw error; }
      const session = JSON.parse(source) as Record<string, unknown>;
      const keys = session && Object.keys(session).sort().join(',');
      if (!session || !['agentCapability,editorUrl,project,schemaVersion,serviceUrl',
        'agentCapability,editorUrl,project,projectId,schemaVersion,serviceUrl'].includes(keys)
        || session.schemaVersion !== 'motion.local-session.v1' || typeof session.project !== 'string' || !session.project
        || hash(session.project).slice(0, 24) !== name || (project !== undefined && session.project !== project)
        || (Object.hasOwn(session, 'projectId') && (typeof session.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(session.projectId)))
        || typeof session.agentCapability !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(session.agentCapability))
        throw new Error('CLI_SESSION_INVALID');
      const service = loopbackUrl(session.serviceUrl); loopbackUrl(session.editorUrl, true);
      sessions.push({ project: session.project, ...(typeof session.projectId === 'string' ? { projectId: session.projectId } : {}), service, capability: session.agentCapability, directory,
        fingerprint: hash(JSON.stringify([session.project, service, session.agentCapability, directory,
          ...(typeof session.projectId === 'string' ? [session.projectId] : [])])) });
    }
    return sessions;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CLI_')) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('CLI_SESSION_NOT_FOUND');
    throw new Error('CLI_SESSION_INVALID');
  }
}
/** Never follow a redirect with a capability header, even to a different local port. */
export const sessionFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });

export function loadSession(project?: string, dataDir?: string, cwd?: string): SessionContext {
  const sessions = loadSessions(project, dataDir, cwd);
  if (sessions.length > 1) throw new Error('CLI_PROJECT_AMBIGUOUS');
  if (!sessions.length) throw new Error('CLI_SESSION_NOT_FOUND');
  return sessions[0]!;
}
export function listProjects(dataDir?: string): { schemaVersion: string; projects: string[] } {
  return { schemaVersion: 'motion.cli-project-list.v1',
    projects: loadSessions(undefined, dataDir).map((session) => session.project).sort() };
}
