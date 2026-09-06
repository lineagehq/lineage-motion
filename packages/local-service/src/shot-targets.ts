import { selectAll } from 'css-select';
import { isTag, isText, type ParentNode } from 'domhandler';
import { parse, serialize } from 'parse5';
import { adapter as treeAdapter } from 'parse5-htmlparser2-tree-adapter';
import { deriveElementId, type MotionDocument } from '../../domain/src/index.ts';
import { fingerprint } from '../../css-import/src/import-utilities.ts';
type Target = MotionDocument['elements'][number] & { label?: string };
export class ShotStaticBindingConflict extends Error {
  constructor() { super('SHOT_STATIC_BINDING_CONFLICT'); }
}
/** Admit visible body targets without changing source selectors or animation inventories. */
export function admitShotTargets(document: MotionDocument): MotionDocument {
  const dom = parse(document.presentation.html, { treeAdapter }) as unknown as ParentNode;
  const elements: Target[] = document.elements.map(element => ({ ...element }));
  const byFingerprint = new Map(elements.map(element => [element.structuralFingerprint, element]));
  for (const node of selectAll('body *', dom)) {
    if (!isTag(node)) continue;
    if (['script', 'style', 'link', 'meta', 'template', 'noscript', 'source'].includes(node.name)) continue;
    const structuralFingerprint = fingerprint(node);
    const leaf = !node.children.some(isTag);
    const text = node.children.filter(isText).map(child => child.data).join('');
    let target = byFingerprint.get(structuralFingerprint);
    // Existing animated targets remain; static leaves are the bounded visual authoring surface.
    if (!target && !leaf) continue;
    if (!target) {
      target = { id: deriveElementId(structuralFingerprint, 0), structuralFingerprint, selectorHint: node.name };
      if (elements.some(element => element.id === target!.id)) throw new Error('SHOT_TARGET_ID_COLLISION');
      elements.push(target); byFingerprint.set(structuralFingerprint, target);
    }
    const label = (node.attribs['aria-label'] || node.attribs.id || text.trim() || node.attribs.class || node.name)
      .replace(/\s+/g, ' ').trim().slice(0, 160);
    if (label) target.label = label;
    if (leaf && text.length > 0) target.editableText = text;
    const sourceBinding = node.attribs['data-motion-id'];
    if (sourceBinding !== undefined && sourceBinding !== target.id) throw new ShotStaticBindingConflict();
    node.attribs['data-motion-id'] = target.id;
  }
  return { ...document, elements, presentation: { ...document.presentation, html: serialize(dom, { treeAdapter }) } };
}
