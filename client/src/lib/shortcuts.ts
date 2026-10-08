/** Etiquetas de los atajos, según el teclado de quien mira. */

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export const UNDO_SHORTCUT = isApple ? '⌘Z' : 'Ctrl+Z';
export const REDO_SHORTCUT = isApple ? '⇧⌘Z' : 'Ctrl+Mayús+Z';
