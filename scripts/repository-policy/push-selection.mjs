const ZERO = /^0+$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function parsePushInput(input) {
  return input.split('\n').filter((line) => line.trim()).map((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !OID.test(fields[1]) || !OID.test(fields[3])) {
      throw new Error('Malformed pre-push ref input; refusing an unverified push.');
    }
    return { localRef: fields[0], tip: fields[1], remoteRef: fields[2], base: fields[3] };
  }).filter(({ tip }) => !ZERO.test(tip));
}

export function selectPushSuites(paths) {
  const selected = ['typecheck', 'build', 'determinism'];
  // Only known presentation-only/prose paths avoid the stateful leaves. All
  // unknown, shared, dependency, executable documentation and tooling changes
  // broaden. Renames include both paths; an unknown baseline passes null.
  const presentationOnly = paths !== null && paths.every((path) =>
    /^(?:README|LICENSE)(?:\.md)?$/.test(path)
    || /^docs\/[^\n]+\.md$/.test(path)
    || /^apps\/editor\/src\/[^\n]+\.css$/.test(path));
  if (!presentationOnly) selected.push('service-integration', 'parity');
  return selected;
}
