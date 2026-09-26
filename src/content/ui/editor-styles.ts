import { TOOLBAR_CSS } from './styles';

/** Toolbar styles plus the highlight editor, note/group panels and toasts (content-main only). */
export const EDITOR_CSS = `${TOOLBAR_CSS}
.note-preview {
  max-height: 7.2em;
  overflow: auto;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.06);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
}
.meta { padding: 0 6px 2px; color: #a7a7ad; font-size: 12px; }
textarea, input[type="text"] {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 6px;
  background: #2a2a30;
  color: inherit;
  font: inherit;
  outline: none;
}
textarea { min-width: 260px; min-height: 84px; resize: vertical; }
textarea:focus, input[type="text"]:focus { border-color: #74c0fc; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.btn {
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.1);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.btn:hover { background: rgb(255 255 255 / 0.18); }
.btn.primary { background: #1c7ed6; }
.btn.primary:hover { background: #1971c2; }
.hint { flex: 1; color: #a7a7ad; font-size: 11px; }
.options { display: flex; flex-direction: column; min-width: 220px; max-height: 220px; overflow: auto; }
.option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.option:hover { background: rgb(255 255 255 / 0.1); }
.option .tick { display: inline-grid; width: 16px; }
.option .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  padding: 8px 14px;
  border-radius: 8px;
  background: #1f1f23;
  color: #f1f1f3;
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.3);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  transform: translateX(-50%);
  animation: jah-toast 0.12s ease-out;
}
@keyframes jah-toast { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;
