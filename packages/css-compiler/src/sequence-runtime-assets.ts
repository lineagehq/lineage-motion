import { parse } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

type Node = { nodeName: string; attrs?: Array<{ name: string; value: string }>; childNodes?: Node[] };
/** Compiler validation covers resource safety. This inventory adds readiness for CSS/inline images. */
export function sequenceImageAssets(html: string, css: string): string[] {
  const images = new Set<string>();
  const collect = (input: string) => {
    postcss.parse(input).walkDecls(declaration => {
      valueParser(declaration.value).walk(node => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
        const value = valueParser.stringify(node.nodes).trim().replace(/^["']|["']$/g, '');
        if (/^data:image\//i.test(value)) images.add(value);
      });
    });
  };
  collect(css);
  const visit = (node: Node) => {
    if (['audio', 'video'].includes(node.nodeName)) throw new Error('SEQUENCE_SOURCE_MEDIA_UNSUPPORTED');
    for (const attr of node.attrs ?? []) if (attr.name === 'style') collect(`x{${attr.value}}`);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html) as unknown as Node);
  return [...images].sort();
}
