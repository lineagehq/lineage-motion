import type { ChildProcess } from 'node:child_process';

// npm can exit while its command still owns inherited stdout/stderr pipes.
// Observe close from spawn time so repeated stop calls also await that command.
export function launcherShutdown(child: ChildProcess): () => Promise<void> {
  let closed = false;
  const completed = new Promise<void>((done) => child.once('close', () => { closed = true; done(); }));
  let stopping: Promise<void> | undefined;
  return () => stopping ??= (async () => {
    if (closed) return;
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([completed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* Already closed. */ }
          reject(new Error('Launcher shutdown timed out before command streams closed'));
        }, 5000);
      })]);
    } finally { clearTimeout(timer); }
  })();
}
