export { el, svgIcon } from '../../shared/dom';

/** Places a fixed-position panel near an anchor rect, preferring above it, clamped to the viewport. */
export function placeNear(panel: HTMLElement, anchor: DOMRect, pointer?: { x: number; y: number }): void {
  const margin = 8;
  const { width, height } = panel.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = anchor.left + anchor.width / 2 - width / 2;
  let y = anchor.top - height - margin;
  if (y < margin) y = anchor.bottom + margin;
  if (y + height > viewportHeight - margin && pointer) y = pointer.y + 16;
  if (pointer && (anchor.width > viewportWidth * 0.8 || anchor.height > viewportHeight * 0.6)) {
    x = pointer.x - width / 2;
    y = pointer.y - height - 16;
    if (y < margin) y = pointer.y + 16;
  }
  x = Math.min(Math.max(margin, x), viewportWidth - width - margin);
  y = Math.min(Math.max(margin, y), viewportHeight - height - margin);
  panel.style.left = `${Math.round(x)}px`;
  panel.style.top = `${Math.round(y)}px`;
}
