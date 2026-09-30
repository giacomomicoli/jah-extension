import { svgIcon } from './dom';

// Each icon is its own export so bundles only include the icons they use.
export const pencil = ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'] as const;
export const close = ['M18 6 6 18', 'M6 6l12 12'] as const;
export const trash = ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'] as const;
export const folder = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'] as const;
export const check = ['M20 6 9 17l-5-5'] as const;
export const plus = ['M12 5v14', 'M5 12h14'] as const;
export const chevronRight = ['M9 6l6 6-6 6'] as const;
export const chevronDown = ['M6 9l6 6 6-6'] as const;
export const back = ['M19 12H5', 'M12 19l-7-7 7-7'] as const;
export const external = ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] as const;
export const palette = [
  'M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 21Z',
  'M7.5 10.5h.01',
  'M12 7.5h.01',
  'M16.5 10.5h.01',
] as const;
export const globe = [
  'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20Z',
  'M2 12h20',
  'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
] as const;
export const alert = ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'] as const;

const ICONS = { pencil, close, trash, folder, check, plus, chevronRight, chevronDown, back, external, palette, globe, alert };

export type IconName = keyof typeof ICONS;

/** Named icon lookup for the side panel (pulls in the whole set). */
export function icon(name: IconName): SVGSVGElement {
  return svgIcon(ICONS[name]);
}
