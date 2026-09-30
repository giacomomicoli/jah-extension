import type { ColorId } from '../shared/colors';
import { ext } from '../shared/ext';
import type { Highlight, Page, PageIdentity } from '../shared/types';

/** API of the lazily injected main script. */
export interface MainApi {
  alive(): boolean;
  dispose(): void;
  restore(page: Page, highlights: Highlight[], focusId?: string): Promise<void>;
  reset(): void;
  createFromRange(range: Range, color?: ColorId, options?: { openNote?: boolean }): Promise<void>;
  createFromSelection(color: ColorId): Promise<void>;
  focus(highlightId: string): Promise<void>;
  closeEditor(): void;
}

/** API of the always-present boot script. */
export interface BootApi {
  alive(): boolean;
  dispose(): void;
  identity(): PageIdentity | null;
  lookup(): Promise<void>;
  hideToolbar(): void;
}

/** Hooks for end-to-end tests (closed shadow roots are otherwise unreachable). */
export interface DebugApi {
  toolbarButtons?(): Record<string, DOMRect>;
  editorButtons?(): Record<string, DOMRect>;
}

export interface JahGlobal {
  boot?: BootApi;
  main?: MainApi;
  debug: DebugApi;
}

/** Namespace shared by the boot and main scripts inside the extension's isolated world. */
export function jah(): JahGlobal {
  const scope = globalThis as typeof globalThis & { __jah?: JahGlobal };
  return (scope.__jah ??= { debug: {} });
}

/** False once the extension was reloaded or removed and this script became orphaned. */
export function runtimeAlive(): boolean {
  try {
    return !!ext.runtime?.id;
  } catch {
    return false;
  }
}
