import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importMotionHtml } from '../../css-import/src/index.ts';
import { canonicalBytes, sha256Hex } from '../../domain/src/index.ts';
import type { SequenceDocument } from '../../domain/src/sequence.ts';
import { compileSequence } from '../../css-compiler/src/sequence-compiler.ts';

function html(kind: 'a' | 'b'): string {
  const a = kind === 'a';
  return `<!doctype html><html><head><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden;background:${a ? 'white' : '#fff4cc'}}
.actor{width:30px;height:30px;background:${a ? 'blue' : 'red'};transform:translateX(17px);animation:move ${a ? '750ms linear 250ms 2 alternate both' : '1000ms linear 500ms 2 reverse none'}}
.pulse{width:30px;height:30px;background:black;animation:blink ${a ? 2000 : 3000}ms steps(2,end) both}
@keyframes move{from{transform:translateX(${a ? 0 : 10}px)}to{transform:translateX(${a ? 120 : 90}px)}}
@keyframes blink{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.actor,.pulse{animation:none}.actor{transform:translateX(${a ? 30 : 60}px)}.pulse{opacity:1}}
</style></head><body><div class="actor" aria-label="Shared object"></div><div class="pulse"></div></body></html>`;
}
// These tables specify the oracle independently of compiler scheduling code.
const scenarios = [
  { order: [0, 1], hold: 0, samples: [[0,0,0],[1000,0,1000],[1999,0,1999],[2000,1,0],[2001,1,1],[3500,1,1500],[4999,1,2999],[5000,1,3000],[5001,1,3000]] },
  { order: [1, 0], hold: 0, samples: [[0,1,0],[1500,1,1500],[2999,1,2999],[3000,0,0],[3001,0,1],[4000,0,1000],[4999,0,1999],[5000,0,2000],[5001,0,2000]] },
  { order: [0, 1], hold: 500, samples: [[1999,0,1999],[2000,0,2000],[2001,0,2000],[2499,0,2000],[2500,1,0],[2501,1,1],[5499,1,2999],[5500,1,3000],[5501,1,3000]] },
] as const;

test('standalone composition matches original native shots at independent cuts, holds and final states', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-sequence-oracle-'));
  const browser = await chromium.launch();
  try {
    const originals = [html('a'), html('b')];
    const sources = originals.map(source => {
      const imported = importMotionHtml(source);
      expect(imported.inventory.unsupportedCount).toBe(0); expect(imported.inventory.missingCount).toBe(0);
      return imported.document!;
    });
    expect(sources.map(source => source.durationMs)).toEqual([2000, 3000]);
    for (const scenario of scenarios) {
      const sequence: SequenceDocument = { schemaVersion: 'motion.sequence.v1', projectId: 'public', sequenceId: 'sequence',
        revision: 0, name: 'Public animation', viewport: { widthCssPixels: 320, heightCssPixels: 180 },
        finalState: 'last-shot-native-end', reducedMotion: 'source-snapshots-with-hard-cuts',
        clips: scenario.order.map((sourceIndex, index) => ({ clipId: `clip_${sourceIndex}`, name: 'Public shot',
          source: { documentId: sources[sourceIndex]!.documentId, revision: 0,
            canonicalDigest: sha256Hex(canonicalBytes(sources[sourceIndex]!)), durationMs: sources[sourceIndex]!.durationMs },
          endHoldMs: index === 0 ? scenario.hold : 0 })) };
      const artifact = compileSequence(sequence, sources); const path = join(directory, 'animation.html');
      await writeFile(path, artifact.html);
      for (const reducedMotion of ['no-preference', 'reduce'] as const) {
        let prior: string[] | undefined;
        for (let replay = 0; replay < 3; replay++) {
          expect(compileSequence(sequence, sources)).toEqual(artifact);
          const context = await browser.newContext({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1,
            reducedMotion, colorScheme: 'light', serviceWorkers: 'block' });
          const network: string[] = [];
          await context.route('**/*', async route => {
            if (/^https?:/.test(route.request().url())) { network.push('unexpected'); await route.abort(); }
            else await route.continue();
          });
          try {
            const actual = await context.newPage(); await actual.goto(pathToFileURL(path).href);
            await actual.evaluate(() => (window as unknown as { __motionSequence: { ready: Promise<void> } }).__motionSequence.ready);
            const expected = await context.newPage();
            const hashes: string[] = [];
            // Reverse traversal also proves that later seeks do not permanently finish earlier clips.
            for (const [global, sourceIndex, local] of [...scenario.samples, ...[...scenario.samples].reverse()]) {
              await expected.setContent(originals[sourceIndex]!);
              await expected.evaluate(time => {
                for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
              }, local);
              const state = await actual.evaluate(time => {
                const runtime = (window as unknown as { __motionSequence: { seek(ms: number): void; readState(): { localTimeMs: number; activeClipId: string } } }).__motionSequence;
                runtime.seek(time);
                const frames = [...document.querySelectorAll('iframe')];
                const visible = frames.filter(frame => getComputedStyle(frame).visibility === 'visible');
                const active = visible[0]!;
                return { ...runtime.readState(), visible: visible.length,
                  count: active.contentDocument!.getAnimations().length,
                  native: active.contentDocument!.getAnimations().every(animation => animation.constructor.name === 'CSSAnimation'),
                  inaccessible: frames.filter(frame => frame !== active).every(frame => frame.inert && frame.getAttribute('aria-hidden') === 'true') };
              }, global);
              expect(state).toMatchObject({ localTimeMs: local, activeClipId: `clip_${sourceIndex}`, visible: 1,
                count: reducedMotion === 'reduce' ? 0 : sourceIndex === 1 && local >= 2500 ? 1 : 2, native: true, inaccessible: true });
              const reference = sha256Hex(await expected.screenshot({ animations: 'allow' }));
              const observed = sha256Hex(await actual.screenshot({ animations: 'allow' }));
              expect(observed, `${scenario.order}/${scenario.hold}/${reducedMotion}/${global}`).toBe(reference); hashes.push(observed);
            }
            expect(network).toEqual([]); if (prior) expect(hashes).toEqual(prior); prior = hashes;
          } finally { await context.close(); }
        }
      }
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
}, 120_000);
