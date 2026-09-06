#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { checkIndex } from './repository-policy/staged-tree.mjs';
import { parsePushInput, selectPushSuites } from './repository-policy/push-selection.mjs';
import { cleanEnvironment, git, run, withPushSnapshot } from './repository-policy/push-snapshot.mjs';

try {
  const updates = parsePushInput(readFileSync(0, 'utf8'));
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const byTip = new Map();
  for (const update of updates) {
    const tip = git(root, ['rev-parse', '--verify', `${update.tip}^{commit}`]);
    let paths = null;
    if (!/^0+$/.test(update.base)) {
      try {
        paths = git(root, ['diff', '--no-renames', '--name-only', '-z', update.base, tip])
          .split('\0').filter(Boolean);
      } catch { /* Missing remote objects require all stateful leaves. */ }
    }
    const previous = byTip.get(tip);
    byTip.set(tip, previous === null || paths === null ? null : [...(previous ?? []), ...paths]);
  }
  for (const [tip, paths] of byTip) {
    console.log(`Verifying pushed commit ${tip}`);
    const passed = await withPushSnapshot(root, tip, async (snapshot) => {
      const policy = await checkIndex(snapshot, cleanEnvironment());
      if (!policy.passed) {
        console.error(JSON.stringify(policy));
        return false;
      }
      // Independent leaves share immutable source, while each service test owns
      // isolated data. Await every result: no failed child can become a green push.
      const selections = [['--tier', 'fast'], ...selectPushSuites(paths).map((suite) => ['--suite', suite])];
      const results = await Promise.all(selections.map((selection) =>
        run('node', ['scripts/run-verification.mjs', ...selection], snapshot)));
      return results.every((code) => code === 0);
    });
    if (!passed) throw new Error(`Verification failed for pushed commit ${tip}.`);
  }
  console.log(byTip.size ? 'Exact pushed-tip verification passed.' : 'No non-deletion tips to verify.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Push verification failed.');
  process.exitCode = 1;
}
