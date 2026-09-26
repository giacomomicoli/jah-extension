const COMBINING_MARKS = /\p{M}/gu;

/** Case- and accent-insensitive form used for searching ("Perché" → "perche"). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/**
 * Folds `text` one code point at a time, remembering for every folded code unit
 * the index of the source code unit it came from, so matches can be mapped back.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const piece = fold(char);
    for (let k = 0; k < piece.length; k++) map.push(i);
    folded += piece;
    i += char.length;
  }
  map.push(text.length);
  return { folded, map };
}

/** Splits a query into folded terms; `"quoted phrases"` stay together. */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = fold((match[1] ?? match[2] ?? '').replace(/\s+/g, ' ').trim());
    if (term) terms.push(term);
  }
  return terms;
}

/** Source ranges of every occurrence of `terms` in `text`, merged and sorted. */
export function findMatches(text: string, terms: string[]): Array<[number, number]> {
  if (!terms.length || !text) return [];
  const { folded, map } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      ranges.push([map[at], map[at + term.length]]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
