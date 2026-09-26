import { describe, expect, it } from 'vitest';
import { findMatches, fold, parseQuery } from '../../src/shared/fold';
import { levenshtein, similarity } from '../../src/shared/similarity';

describe('search folding', () => {
  it('is case and accent insensitive', () => {
    expect(fold('Perché È così')).toBe('perche e cosi');
  });

  it('parses quoted phrases as single terms', () => {
    expect(parseQuery('  "Hello   World" Foo  ')).toEqual(['hello world', 'foo']);
    expect(parseQuery('   ')).toEqual([]);
  });

  it('maps matches back to the original text, accents included', () => {
    const text = 'La velocità è più alta';
    const [match] = findMatches(text, parseQuery('piu'));
    expect(text.slice(match[0], match[1])).toBe('più');
  });

  it('merges overlapping matches', () => {
    expect(findMatches('abcdef', ['abc', 'cde'])).toEqual([[0, 5]]);
  });
});

describe('similarity', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(similarity('same', 'same')).toBe(1);
    expect(similarity('', '')).toBe(1);
  });
});
