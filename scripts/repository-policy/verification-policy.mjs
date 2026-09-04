import { trackedFiles } from './tracked-files.mjs';

const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx|js|mjs)$/;

export function discoverTrackedTests(repositoryRoot) {
  return trackedFiles(repositoryRoot).filter((path) => TEST_FILE.test(path));
}

export function validateVerificationManifest(repositoryRoot, suites, tiers) {
  const tests = discoverTrackedTests(repositoryRoot);
  const owners = new Map(tests.map((path) => [path, []]));
  for (const [suiteName, suite] of Object.entries(suites)) {
    for (const path of suite.files ?? []) {
      if (owners.has(path)) {
        owners.get(path).push(suiteName);
      }
    }
  }
  const unowned = [];
  const multiplyOwned = [];
  for (const [path, suiteNames] of owners) {
    if (suiteNames.length === 0) {
      unowned.push(path);
    } else if (suiteNames.length > 1) {
      multiplyOwned.push({ path, suites: suiteNames.sort() });
    }
  }
  const unknownNodes = [...new Set(
    Object.values(tiers).flat().filter((name) => !(name in suites)),
  )].sort();
  const privateInPublic = [...new Set(Object.entries(tiers)
    .filter(([tier]) => tier !== 'full')
    .flatMap(([, names]) => names)
    .filter((name) => suites[name]?.public === false))]
    .sort();
  return {
    passed: unowned.length === 0
      && multiplyOwned.length === 0
      && unknownNodes.length === 0
      && privateInPublic.length === 0,
    unowned,
    multiplyOwned,
    unknownNodes,
    privateInPublic,
  };
}
