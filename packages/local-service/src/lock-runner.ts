import { spawn } from 'node:child_process';

export type StoreLock = { readonly holderPid: number; readonly lost: Promise<void>; release(): Promise<void> };

export async function acquireStoreLock(lockPath: string): Promise<StoreLock> {
  const script = `const owner=${process.pid},locker=process.ppid;process.stdout.write('LOCKED\\n');process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{try{process.kill(owner,0);process.kill(locker,0)}catch{process.exit(0)}},25)`;
  const child = spawn('/usr/bin/lockf', ['-kn', '-t', '0', lockPath, process.execPath, '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('STORE_LOCK_TIMEOUT')), 3000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('LOCKED\n')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('STORE_LOCKED')); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  let releasing = false;
  const lost = new Promise<void>((resolve) => child.once('exit', () => { if (!releasing) resolve(); }));
  return { holderPid: child.pid!, lost, release: async () => {
    if (child.exitCode !== null) return;
    releasing = true;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  } };
}
