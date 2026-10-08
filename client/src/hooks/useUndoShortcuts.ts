import { useEffect } from 'react';

interface UndoShortcuts {
  enabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Dentro de una nota, el deshacer del navegador no sirve: el textarea es un
 * reflejo del documento, así que el texto volvería a su valor anterior y el
 * documento lo pisaría enseguida. Ahí el atajo lo atiende la pizarra.
 *
 * En cualquier otro campo (el nombre, por ejemplo) se deja el del navegador.
 */
function keepsBrowserUndo(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return target.dataset.boardText === undefined;
  }
  return false;
}

/** Ctrl/⌘ + Z para deshacer; con Mayús (o Ctrl + Y) para rehacer. */
export function useUndoShortcuts({ enabled, onUndo, onRedo }: UndoShortcuts): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
      const undo = key === 'z' && !event.shiftKey;
      if (!undo && !redo) return;
      if (keepsBrowserUndo(event.target)) return;
      event.preventDefault();
      if (undo) onUndo();
      else onRedo();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onRedo, onUndo]);
}
