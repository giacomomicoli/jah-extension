export const COLORS = [
  { id: 'yellow', label: 'Yellow', swatch: '#ffd43b', fill: 'rgb(255 212 59 / 0.5)' },
  { id: 'green', label: 'Green', swatch: '#69db7c', fill: 'rgb(105 219 124 / 0.42)' },
  { id: 'blue', label: 'Blue', swatch: '#4dabf7', fill: 'rgb(77 171 247 / 0.38)' },
  { id: 'pink', label: 'Pink', swatch: '#f783ac', fill: 'rgb(247 131 172 / 0.42)' },
  { id: 'purple', label: 'Purple', swatch: '#b197fc', fill: 'rgb(177 151 252 / 0.45)' },
] as const;

export type ColorId = (typeof COLORS)[number]['id'];

export const DEFAULT_COLOR: ColorId = 'yellow';

const COLOR_IDS = new Set<string>(COLORS.map((color) => color.id));

export function isColorId(value: unknown): value is ColorId {
  return typeof value === 'string' && COLOR_IDS.has(value);
}

export function colorInfo(id: ColorId) {
  return COLORS.find((color) => color.id === id) ?? COLORS[0];
}

/** Name of the CSS Highlight bucket that renders every range of one color. */
export function highlightName(id: ColorId): string {
  return `jah-${id}`;
}

/** Temporary bucket used to flash a highlight after jumping to it. */
export const FOCUS_HIGHLIGHT = 'jah-focus';
/** Bucket marking the highlight whose editor is open. */
export const ACTIVE_HIGHLIGHT = 'jah-active';

/** `::highlight()` rules, injected into a page only once it actually renders highlights. */
export function highlightStylesheet(): string {
  const rules = COLORS.map(
    (color) => `::highlight(${highlightName(color.id)}) { background-color: ${color.fill}; }`,
  );
  rules.push(`::highlight(${FOCUS_HIGHLIGHT}) { background-color: rgb(255 146 43 / 0.8); }`);
  // Firefox ignores text decorations in `::highlight()` before 146: darken the fill as well.
  const firefoxFill = __BROWSER__ === 'firefox' ? ' background-color: rgb(0 0 0 / 0.12);' : '';
  rules.push(
    `::highlight(${ACTIVE_HIGHLIGHT}) { text-decoration-line: underline; text-decoration-thickness: 2px;${firefoxFill} }`,
  );
  return rules.join('\n');
}
