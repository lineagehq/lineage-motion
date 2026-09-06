import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const children = new Set<ChildProcess>();
const states = new WeakMap<ChildProcess, { output: string; stderr: string; secrets: string[]; spawnError: string; droppingStderrLine: boolean }>();
const limit = 8192;
const recent: ChildProcess[] = [];
const stopping = new WeakMap<ChildProcess, Promise<void>>();

export function sanitizeServerDiagnostic(value: string, secrets: string[] = []): string {
  let result = value.replace(/\u001b\[[0-9;]*m/g, '');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[redacted]');
  return result.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:capability|token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url redacted]')
    .replace(/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/folders\/)[^\s"')]+/g, '[path redacted]');
}

export function spawnTestServer(command: string, args: string[], options: SpawnOptions): ChildProcess {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  const secrets = Object.entries(options.env ?? {}).filter(([key]) => /capability|token|password|secret/i.test(key))
    .map(([, value]) => value ?? '');
  const state = { output: '', stderr: '', secrets, spawnError: '', droppingStderrLine: false };
  states.set(child, state); children.add(child); recent.push(child);
  child.stdout?.on('data', (chunk) => { state.output = (state.output + chunk.toString()).slice(-limit); });
  child.stderr?.on('data', (chunk) => {
    // Keep a bounded in-memory tail; redact after joining chunks so split credentials are covered.
    let incoming = chunk.toString();
    if (state.droppingStderrLine) {
      const end = incoming.indexOf('\n');
      if (end < 0) return;
      incoming = incoming.slice(end + 1);
      state.droppingStderrLine = false;
    }
    const combined = state.stderr + incoming;
    if (combined.length <= limit) state.stderr = combined;
    else {
      const tail = combined.slice(-limit);
      // Keep discarding across chunks until the damaged line is complete.
      const end = tail.indexOf('\n');
      state.droppingStderrLine = end < 0;
      state.stderr = end < 0 ? '' : tail.slice(end + 1);
    }
  });
  child.once('error', (error) => { state.spawnError = sanitizeServerDiagnostic(error.message, secrets); });
  return child;
}

function signal(child: ChildProcess, kind: NodeJS.Signals) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, kind);
    else child.kill(kind);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

export function stopTestServer(child: ChildProcess | undefined): Promise<void> {
  if (!child) return Promise.resolve();
  const existing = stopping.get(child);
  if (existing) return existing;
  const stopped = new Promise<void>((resolve) => {
    const complete = () => { children.delete(child); resolve(); };
    if (!child.pid) { complete(); return; }
    if (child.exitCode !== null || child.signalCode !== null) {
      signal(child, 'SIGKILL'); complete(); return;
    }
    const timer = setTimeout(() => signal(child, 'SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(timer); signal(child, 'SIGKILL'); complete(); });
    signal(child, 'SIGTERM');
  });
  stopping.set(child, stopped);
  return stopped;
}

export function serverDiagnostic(child: ChildProcess): string {
  const state = states.get(child);
  return state ? sanitizeServerDiagnostic(state.stderr, state.secrets) || '(no stderr received)' : '(untracked process)';
}

export async function waitForTestServer(child: ChildProcess, timeoutMs = 10000): Promise<{ editorUrl: string; serviceUrl: string }> {
  const state = states.get(child);
  if (!state) throw new Error('Use spawnTestServer before waitForTestServer');
  try {
    return await new Promise((resolve, reject) => {
      const fail = (reason: string) => { cleanup(); reject(new Error(`${reason}\nServer stderr (sanitized, last ${limit} characters):\n${serverDiagnostic(child)}`)); };
      const onExit = (code: number | null, sig: string | null) => fail(`TEST_SERVER_EXIT_${code ?? sig}`);
      const onError = (error: Error) => fail(`TEST_SERVER_SPAWN_ERROR: ${sanitizeServerDiagnostic(error.message, state.secrets)}`);
      const inspect = () => {
        for (const line of state.output.split('\n').slice(0, -1)) {
          if (!line.startsWith('{')) continue;
          try {
            const value = JSON.parse(line) as { editorUrl?: string; serviceUrl?: string };
            if (typeof value.editorUrl !== 'string' || typeof value.serviceUrl !== 'string') continue;
            cleanup(); resolve({ editorUrl: value.editorUrl, serviceUrl: value.serviceUrl }); return;
          } catch { /* A partial or unrelated JSON log is not readiness. */ }
        }
      };
      const cleanup = () => { clearTimeout(timer); child.stdout?.off('data', inspect); child.off('exit', onExit); child.off('error', onError); };
      const timer = setTimeout(() => fail('TEST_SERVER_TIMEOUT'), timeoutMs);
      child.stdout?.on('data', inspect); child.once('exit', onExit); child.once('error', onError);
      if (state.spawnError) fail(`TEST_SERVER_SPAWN_ERROR: ${state.spawnError}`);
      else if (child.exitCode !== null || child.signalCode !== null) onExit(child.exitCode, child.signalCode);
      else inspect();
    });
  } catch (error) { await stopTestServer(child); throw error; }
}

// Worker interruption must not strand a detached Vite/service process tree.
process.once('exit', () => { for (const child of children) signal(child, 'SIGKILL'); });
for (const kind of ['SIGINT', 'SIGTERM'] as const) process.once(kind, () => {
  void Promise.all([...children].map(stopTestServer)).finally(() => process.exit(kind === 'SIGINT' ? 130 : 143));
});

export function takeServerDiagnostics(): string {
  return recent.splice(0).map((child, index) => `Server ${index + 1}: exit=${child.exitCode}, signal=${child.signalCode}\n${serverDiagnostic(child)}`).join('\n\n');
}

export async function stopAllTestServers(): Promise<void> {
  await Promise.all([...children].map(stopTestServer));
}
