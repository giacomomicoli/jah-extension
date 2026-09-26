// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CONTEXT_LENGTH, createAnchor, resolveTarget } from '../../src/content/anchor';
import { resolveNodePath } from '../../src/content/dompath';
import { resolveAnchor } from '../../src/content/resolver';
import { TextMap } from '../../src/content/textmap';
import type { TextAnchor } from '../../src/shared/types';

const P = {
  intro:
    'Chip makers keep pushing the limits of silicon, and this generation of desktop processors is no exception to that rule.',
  bench:
    'In the first benchmark the result is cached after the initial run, so later runs complete almost instantly and the chart flattens out.',
  warmup:
    'When we disabled the warm-up phase the result is cached only once the driver finishes compiling every shader, which adds a delay.',
  conclusion:
    'Our conclusion is simple: the result is cached aggressively on every platform we tested, but only Intel exposes a switch to turn it off.',
  outro: 'Intel also promised a firmware update for next month, together with new documentation for developers.',
};
const ORIGINAL = [P.intro, P.bench, P.warmup, P.conclusion, P.outro];

function article(paragraphs: string[]): string {
  return `<article><h1>Benchmarks</h1>${paragraphs.map((text) => `<p>${text}</p>`).join('')}</article>`;
}

function load(html: string): TextMap {
  document.body.innerHTML = html;
  return new TextMap(document.body);
}

function anchorAt(map: TextMap, phrase: string, occurrence = 0): TextAnchor {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) {
    at = map.text.indexOf(phrase, at + 1);
    if (at < 0) throw new Error(`"${phrase}" not found`);
  }
  return createAnchor(map, at, at + phrase.length);
}

function resolveIn(html: string, anchor: TextAnchor) {
  const map = load(html);
  const result = resolveAnchor(anchor, resolveTarget(map));
  const text = result.status === 'unresolved' ? '' : map.text.slice(result.start, result.end);
  const surroundings = result.status === 'unresolved' ? '' : map.text.slice(Math.max(0, result.start - 40), result.end + 40);
  return { map, result, text, surroundings };
}

describe('createAnchor', () => {
  it('stores quote, bounded context, offsets, DOM hint and fingerprints', () => {
    const map = load(article(ORIGINAL));
    const anchor = anchorAt(map, 'only Intel exposes a switch');
    expect(anchor.exact).toBe('only Intel exposes a switch');
    expect(anchor.prefix.length).toBe(CONTEXT_LENGTH);
    expect(anchor.prefix.endsWith('every platform we tested, but ')).toBe(true);
    expect(anchor.suffix.startsWith(' to turn it off.')).toBe(true);
    expect(map.text.slice(anchor.start, anchor.end)).toBe(anchor.exact);
    expect(anchor.localFingerprint).toBeTruthy();
    expect(anchor.textFingerprint).toBe(map.fingerprint);

    const hinted = resolveNodePath(anchor.domHint!.startPath, document.body) as Text;
    expect(hinted.data.slice(anchor.domHint!.startOffset)).toMatch(/^only Intel/);
  });
});

describe('resolveAnchor', () => {
  it('uses the fast path when the page text is unchanged, even if the DOM was restructured', () => {
    const map = load(article(ORIGINAL));
    const anchor = anchorAt(map, 'the chart flattens out');
    const restructured = `<main><section><div>${article(ORIGINAL)}</div></section></main>`;
    const { result, text } = resolveIn(restructured, anchor);
    expect(result).toMatchObject({ status: 'resolved', method: 'fingerprint' });
    expect(text).toBe('the chart flattens out');
  });

  it('follows the highlight when content is inserted before it', () => {
    const anchor = anchorAt(load(article(ORIGINAL)), 'so later runs complete almost instantly');
    const changed = article(['Update: we re-ran every test with the latest BIOS and a new cooler.', ...ORIGINAL]);
    const { result, surroundings } = resolveIn(changed, anchor);
    expect(result.status).toBe('resolved');
    expect(surroundings).toContain('after the initial run, so later runs complete almost instantly and the chart');
  });

  it('picks the right occurrence of a repeated phrase using its context', () => {
    const map = load(article(ORIGINAL));
    // Second of three identical quotes: the warm-up paragraph.
    const anchor = anchorAt(map, 'the result is cached', 1);
    expect(anchor.suffix.startsWith(' only once the driver')).toBe(true);

    const changed = article([
      'Update: we re-ran every test with the latest BIOS and a new cooler, the result is cached here too.',
      ...ORIGINAL,
    ]);
    const { result, map: after } = resolveIn(changed, anchor);
    expect(result.status).toBe('resolved');
    expect(after.text.slice(result.end, result.end + 25)).toBe(' only once the driver fin');
  });

  it('never attaches a highlight to another occurrence once its paragraph is gone', () => {
    const anchor = anchorAt(load(article(ORIGINAL)), 'Intel', 0); // the one in the conclusion
    expect(anchor.prefix).toContain('but only');
    const withoutConclusion = article([P.intro, P.bench, P.warmup, P.outro]);
    const { result } = resolveIn(withoutConclusion, anchor);
    expect(result.status).toBe('unresolved');
  });

  it('recovers a lightly edited quote as a fuzzy match', () => {
    const anchor = anchorAt(load(article(ORIGINAL)), 'so later runs complete almost instantly and the chart flattens');
    const edited = ORIGINAL.map((text) => text.replace('almost instantly', 'nearly instantly'));
    const { result, text } = resolveIn(article(edited), anchor);
    expect(result.status).toBe('fuzzy');
    expect(text).toBe('so later runs complete nearly instantly and the chart flattens');
  });

  it('leaves a substantially rewritten quote unresolved', () => {
    const anchor = anchorAt(load(article(ORIGINAL)), 'so later runs complete almost instantly and the chart flattens');
    const rewritten = ORIGINAL.map((text) =>
      text.replace('so later runs complete almost instantly and the chart flattens', 'which makes every following pass trivially quick to render'),
    );
    expect(resolveIn(article(rewritten), anchor).result.status).toBe('unresolved');
  });

  it('accepts a long quote whose neighbours changed when position and DOM hint agree', () => {
    const anchor = anchorAt(load(article(ORIGINAL)), P.warmup);
    expect(P.warmup.length).toBeGreaterThanOrEqual(120);
    const neighboursChanged = article([
      P.intro,
      'X'.repeat(P.bench.length),
      P.warmup,
      'Y'.repeat(P.conclusion.length),
      P.outro,
    ]);
    const { result, text } = resolveIn(neighboursChanged, anchor);
    expect(result).toMatchObject({ status: 'resolved', method: 'dom' });
    expect(text).toBe(P.warmup);
  });

  it('rejects a short quote whose only remaining evidence is position', () => {
    const map = load(article(ORIGINAL));
    const start = map.text.indexOf('the warm-up phase');
    const anchor = createAnchor(map, start, start + 'the warm-up'.length);
    const paragraphs = [...ORIGINAL];
    paragraphs[2] = 'Totally different words here, then the warm-up and other unrelated content follows it.';
    paragraphs[1] = 'Q'.repeat(P.bench.length);
    const { result } = resolveIn(article(paragraphs), anchor);
    expect(result.status).toBe('unresolved');
  });

  describe('identical passages', () => {
    // A long repeated block: context and the local fingerprint window are identical for both copies.
    const block =
      'Sponsored block starts. ' +
      'This filler sentence is repeated verbatim. '.repeat(8) +
      'The highlighted words sit in the middle. ' +
      'Another filler sentence is repeated too. '.repeat(8);
    const phrase = 'The highlighted words sit in the middle.';
    // Copies far apart (> 3000 characters), so position differences exceed the plain score margin.
    const base = [P.intro, block, ...Array<string>(25).fill(P.bench), block, P.outro];

    function secondCopy() {
      const map = load(article(base));
      const first = map.text.indexOf(phrase);
      const second = map.text.indexOf(phrase, first + 1);
      return { map, first, second, anchor: createAnchor(map, second, second + phrase.length) };
    }

    it('resolves the right copy while the DOM hint still agrees', () => {
      const { second, anchor } = secondCopy();
      const { result } = resolveIn(article(base) + '<p>12 comments</p>', anchor);
      expect(result).toMatchObject({ status: 'resolved', start: second });
    });

    it('stays unresolved when only position could tell the copies apart', () => {
      const { first, second, anchor } = secondCopy();
      // Insert exactly the distance between the copies (minus the block separator) and wrap the
      // article so the DOM path breaks: the *wrong* copy now sits at the original offset.
      const shifted = `<p>${'x'.repeat(second - first - 1)}</p><div>${article(base)}</div>`;
      const { result, map: after } = resolveIn(shifted, anchor);
      expect(after.text.indexOf(phrase)).toBe(second);
      expect(result).toMatchObject({ status: 'unresolved', reason: 'ambiguous' });
    });
  });

  it('keeps resolving when only unrelated parts of the page changed', () => {
    const anchor = anchorAt(load(article(ORIGINAL)), 'finishes compiling every shader');
    const withComments = article(ORIGINAL) + '<section><p>42 comments</p><p>Great article!</p></section>';
    const { result, text } = resolveIn(withComments, anchor);
    expect(result.status).toBe('resolved');
    expect(result.method).not.toBe('fingerprint');
    expect(text).toBe('finishes compiling every shader');
  });
});

describe('anchors without surrounding context', () => {
  const whole = 'Exactly this sentence is the whole text of a tiny page.';

  function wholePageAnchor() {
    const map = load(`<p>${whole}</p>`);
    const anchor = createAnchor(map, 0, map.text.length);
    expect(anchor.prefix).toBe('');
    expect(anchor.suffix).toBe('');
    return anchor;
  }

  it('does not count missing context as evidence', () => {
    const anchor = wholePageAnchor();
    // Same sentence, far away and in the middle of other text: only the quote matches.
    const elsewhere = `<div>${'Unrelated filler text for the page. '.repeat(150)}</div><p>${whole}</p><p>Footer.</p>`;
    expect(resolveIn(elsewhere, anchor).result.status).toBe('unresolved');
  });

  it('treats a quote that still starts the page as corroborated', () => {
    const anchor = wholePageAnchor();
    const { result, text } = resolveIn(`<p>${whole}</p><p>A comment was added below.</p>`, anchor);
    expect(result.status).toBe('resolved');
    expect(text).toBe(whole);
  });

  it('never compares more stored context than the limit, even for hostile data', () => {
    const map = load(article(ORIGINAL));
    const anchor = anchorAt(map, 'the chart flattens out');
    const hostile = { ...anchor, prefix: 'x'.repeat(50_000) + anchor.prefix, textFingerprint: undefined };
    const started = performance.now();
    const { result, text } = resolveIn(article(['Changed intro.', ...ORIGINAL]), hostile);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.status).toBe('resolved');
    expect(text).toBe('the chart flattens out');
  });
});
