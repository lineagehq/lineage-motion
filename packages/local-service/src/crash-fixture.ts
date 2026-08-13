import { startLocalMotionService } from './index.ts';
import { createPhase3Seed } from './seed.ts';
import type { FaultPoint } from './sqlite-project-store.ts';

const [databasePath, point] = process.argv.slice(2) as [string | undefined, FaultPoint | undefined];
if (!databasePath || !['after-begin', 'after-inserts', 'before-commit', 'after-commit'].includes(point ?? '')) {
  throw new Error('CRASH_FIXTURE_ARGUMENTS_INVALID');
}
let armed = true;
const service = await startLocalMotionService({ databasePath, seed: createPhase3Seed(), fault: (candidate) => {
  if (armed && candidate === point) { armed = false; process.kill(process.pid, 'SIGKILL'); }
} });
process.stdout.write(`${JSON.stringify({ url: service.url })}\n`);
process.on('SIGTERM', () => { void service.close().finally(() => process.exit(0)); });
