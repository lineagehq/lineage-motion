import { admitShotTargets, ShotStaticBindingConflict } from './shot-targets.ts';
import { canonicalJson, sha256Hex, validateMotionDocument, type MotionDocument } from '../../domain/src/index.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { importMotionHtml } from '../../css-import/src/index.ts';
import type { ShotAdmissionCommand, ShotAdmissionFailure, ShotInventory } from '../../motion-protocol/src/project.ts';
import { createTrajectorySeed, createPhase4ReusableCueSeed } from './seed.ts';
export type PreparedShot = { document: MotionDocument; canonicalDigest: string; exportDigest: string; inventory: ShotInventory };
export function prepareShot(command: ShotAdmissionCommand): PreparedShot | ShotAdmissionFailure {
  let document: MotionDocument;
  if (command.source.kind === 'html-css') {
    const imported = importMotionHtml(command.source.html);
    if (!imported.document || imported.inventory.unsupportedCount || imported.inventory.missingCount)
      return { ok: false, code: 'IMPORT_REJECTED', diagnosticCode: imported.diagnostics[0]?.code ?? 'IMPORT_INCOMPLETE', inventory: imported.inventory };
    document = imported.document;
  } else document = command.source.starterId === 'trajectory' ? createTrajectorySeed() : createPhase4ReusableCueSeed();
  // Source binding identities remain scoped to the new document; only its instance identity changes.
  try { document = admitShotTargets({ ...document, documentId: command.documentId, revision: 0 }); }
  catch (error) {
    if (!(error instanceof ShotStaticBindingConflict)) throw error;
    const diagnosticCode = 'SHOT_STATIC_BINDING_CONFLICT';
    return { ok: false, code: 'IMPORT_REJECTED', diagnosticCode, inventory: { ...document.inventory,
      unsupportedCount: document.inventory.unsupportedCount + 1,
      diagnosticCodes: [...document.inventory.diagnosticCodes, diagnosticCode] } };
  }
  if (!validateMotionDocument(document).ok) return { ok: false, code: 'IMPORT_REJECTED', diagnosticCode: 'SHOT_DOCUMENT_INVALID', inventory: document.inventory };
  try { const compiled = compileMotionDocument(document);
    return { document, canonicalDigest: sha256Hex(canonicalJson(document)), exportDigest: compiled.exportDigest, inventory: document.inventory };
  } catch { return { ok: false, code: 'IMPORT_REJECTED', diagnosticCode: 'SHOT_COMPILE_REJECTED', inventory: document.inventory }; }
}
