/** Levenshtein edit distance over UTF-16 code units, O(min(a, b)) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length > b.length) [a, b] = [b, a];
  if (a.length === 0) return b.length;

  const row = new Uint32Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) row[i] = i;

  for (let j = 1; j <= b.length; j++) {
    const code = b.charCodeAt(j - 1);
    let diagonal = row[0];
    row[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const above = row[i];
      const cost = a.charCodeAt(i - 1) === code ? 0 : 1;
      row[i] = Math.min(above + 1, row[i - 1] + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[a.length];
}

/** 1 for identical strings, 0 for completely different ones. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}
