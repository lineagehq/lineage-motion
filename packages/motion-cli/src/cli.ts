import { canonicalJson } from '../../domain/src/index.ts';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';

export async function runCli(argv: string[], io: { stdout(value: string): void; stderr(value: string): void } = {
  stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value),
}): Promise<number> {
  const values = parseArgs(argv);
  if (!values) { io.stderr('Usage: motion-cli track-create --service URL --operation-id ID --document-id ID --expected-revision N --element-id ID\n'); return 2; }
  try {
    const response = await new MotionServiceClient(values.service).dispatch(makeTrackCreateCommand({
      operationId: values.operationId, documentId: values.documentId, expectedRevision: values.expectedRevision,
      elementId: values.elementId,
    }));
    io.stdout(canonicalJson(response));
    if (response.ok) return 0;
    return { VALIDATION: 2, STALE_REVISION: 3, OPERATION_ID_CONFLICT: 4, UNSUPPORTED_VERSION: 5, STORAGE_FAILURE: 6 }[response.code];
  } catch { io.stdout(canonicalJson({ ok: false, code: 'STORAGE_FAILURE' })); return 6; }
}
function parseArgs(argv: string[]) {
  if (argv[0] !== 'track-create') return null;
  const read = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const service = read('--service'), operationId = read('--operation-id'), documentId = read('--document-id'),
    expected = read('--expected-revision'), elementId = read('--element-id');
  const expectedRevision = Number(expected);
  if (!service || !operationId || !documentId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || (elementId !== 'el_a2849ff826f3e167' && elementId !== 'el_2dbee68b1ea318c8')) return null;
  return { service, operationId, documentId, expectedRevision,
    elementId: elementId as 'el_a2849ff826f3e167' | 'el_2dbee68b1ea318c8' };
}
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli(process.argv.slice(2));
