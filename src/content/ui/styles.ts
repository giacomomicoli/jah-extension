// Styles for the in-page UI, scoped to its closed shadow root.

/** Everything the selection toolbar needs (bundled into the always-loaded boot script). */
export const TOOLBAR_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(340px, calc(100vw - 16px));
  padding: 6px;
  border-radius: 10px;
  background: #1f1f23;
  color: #f1f1f3;
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.3), 0 0 0 1px rgb(255 255 255 / 0.07);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
  animation: jah-pop 0.12s ease-out;
}
.row { display: flex; align-items: center; gap: 4px; }
.swatch {
  width: 22px;
  height: 22px;
  margin: 0 1px;
  padding: 0;
  border: 2px solid rgb(255 255 255 / 0.15);
  border-radius: 50%;
  background: var(--swatch);
  cursor: pointer;
  transition: transform 0.08s ease;
}
.swatch:hover { transform: scale(1.14); }
.swatch[aria-pressed="true"] { border-color: #fff; }
.sep { width: 1px; height: 18px; margin: 0 3px; background: rgb(255 255 255 / 0.18); }
.icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.icon:hover { background: rgb(255 255 255 / 0.12); }
.icon[data-armed="true"] { background: #e03131; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #74c0fc; outline-offset: 1px; }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
@keyframes jah-pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
`;
