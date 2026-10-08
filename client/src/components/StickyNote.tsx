import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { MAX_TEXT_LENGTH, NOTE_COLORS, type Note, type NoteColor, type Peer } from '@pizarra/shared';
import type { Caret } from '../hooks/useBoard';
import { useDrag } from '../hooks/useDrag';
import { COLOR_LABELS, PRESENCE_COLOR_HEX } from '../lib/colors';
import { GripIcon, PaletteIcon, PencilIcon, TrashIcon } from './Icons';

interface StickyNoteProps {
  note: Note;
  editable: boolean;
  /** Otras personas que están editando el texto de esta nota. */
  editors: readonly Peer[];
  /** Si es true, la nota toma el foco al montarse (recién creada). */
  autoFocus: boolean;
  onAutoFocused: () => void;
  onMove: (id: string, x: number, y: number) => void;
  onCommitMove: (id: string, x: number, y: number) => void;
  onTextChange: (id: string, value: string, caret: Caret) => void;
  onColorChange: (id: string, color: NoteColor) => void;
  onDelete: (id: string) => void;
  /** Avisa qué nota se está editando aquí (null al salir del texto). */
  onEditingChange: (id: string | null) => void;
  /** Recuerda la selección del texto, anclada al contenido. */
  onCaretChange: (id: string, caret: Caret) => void;
  /** Dónde debería estar la selección tras un cambio remoto. */
  resolveCaret: (id: string) => Caret | null;
}

function caretOf(textarea: HTMLTextAreaElement): Caret {
  return { start: textarea.selectionStart, end: textarea.selectionEnd };
}

function editorsLabel(editors: readonly Peer[]): string {
  const names = editors.map((peer) => peer.name);
  if (names.length === 1) return `${names[0]} está escribiendo`;
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)} están escribiendo`;
}

const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;
const ARROW_DIRECTIONS: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export const StickyNote = memo(function StickyNote({
  note,
  editable,
  editors,
  autoFocus,
  onAutoFocused,
  onMove,
  onCommitMove,
  onTextChange,
  onColorChange,
  onDelete,
  onEditingChange,
  onCaretChange,
  resolveCaret,
}: StickyNoteProps) {
  const { id } = note;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cuando el texto cambia por otra persona, React reemplaza el valor del
  // textarea y el navegador manda el cursor al final. Se lo devuelve a donde
  // estaba, ajustado a lo que se insertó o borró antes de él.
  useLayoutEffect(() => {
    const textarea = textRef.current;
    if (!textarea || document.activeElement !== textarea) return;
    const caret = resolveCaret(id);
    if (caret && (textarea.selectionStart !== caret.start || textarea.selectionEnd !== caret.end)) {
      textarea.setSelectionRange(caret.start, caret.end);
    }
  }, [id, note.text, resolveCaret]);

  const drag = useDrag({
    x: note.x,
    y: note.y,
    disabled: !editable,
    onMove: (x, y) => onMove(id, x, y),
    onEnd: (x, y) => onCommitMove(id, x, y),
  });

  // La nota toma el foco al crearse y al volver a ella tras deshacer; en ese
  // caso el cursor de texto vuelve a donde estaba cuando se hizo el cambio.
  useEffect(() => {
    if (!autoFocus) return;
    const textarea = textRef.current;
    // Se consulta antes de enfocar: al enfocar, el propio textarea recuerda
    // como cursor el final del texto y pisaría lo que hay que restaurar.
    const caret = resolveCaret(id);
    textarea?.focus();
    if (textarea && caret) textarea.setSelectionRange(caret.start, caret.end);
    onAutoFocused();
  }, [autoFocus, id, onAutoFocused, resolveCaret]);

  // Alternativa de teclado al arrastre: flechas (10 px) o Mayús + flechas (50 px).
  const handleHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = ARROW_DIRECTIONS[event.key];
    if (!direction || !editable) return;
    event.preventDefault();
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    onCommitMove(id, note.x + direction[0] * step, note.y + direction[1] * step);
  };

  const closePalette = (restoreFocus: boolean) => {
    setPaletteOpen(false);
    if (restoreFocus) paletteButtonRef.current?.focus();
  };

  const handlePaletteKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePalette(true);
    }
  };

  const pickColor = (color: NoteColor) => {
    onColorChange(id, color);
    closePalette(true);
  };

  const rememberCaret = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    onCaretChange(id, caretOf(event.currentTarget));
  };

  // La paleta se cierra cuando el foco sale de la nota.
  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setPaletteOpen(false);
  };

  const editor = editors[0];
  const style = {
    translate: `${note.x}px ${note.y}px`,
    '--note-rotation': `${note.rotation}deg`,
    ...(editor && { '--editor': PRESENCE_COLOR_HEX[editor.color] }),
  } as CSSProperties;

  const paletteId = `palette-${id}`;
  const label = `Nota ${COLOR_LABELS[note.color].toLowerCase()}${editor ? `. ${editorsLabel(editors)}` : ''}`;

  return (
    <article
      className={`note note--${note.color}${drag.isDragging ? ' is-dragging' : ''}${editor ? ' is-remote-editing' : ''}`}
      style={style}
      aria-label={label}
      onBlur={handleBlur}
    >
      {editor && (
        <span className="note__editor" title={editorsLabel(editors)} aria-hidden="true">
          <PencilIcon width={12} height={12} />
          {editor.name}
          {editors.length > 1 && <span className="note__editor-more">+{editors.length - 1}</span>}
        </span>
      )}

      <div className="note__bar" {...drag.handlers}>
        <button
          type="button"
          className="note__handle"
          aria-label="Mover nota (también con las flechas del teclado)"
          title="Arrastra para mover"
          onKeyDown={handleHandleKeyDown}
          disabled={!editable}
        >
          <GripIcon />
        </button>

        <div className="note__actions" data-no-drag>
          <button
            ref={paletteButtonRef}
            type="button"
            className="note__action"
            aria-label="Cambiar color"
            aria-expanded={paletteOpen}
            aria-controls={paletteOpen ? paletteId : undefined}
            onClick={() => setPaletteOpen((open) => !open)}
            disabled={!editable}
          >
            <PaletteIcon />
          </button>
          <button
            type="button"
            className="note__action note__action--danger"
            aria-label="Eliminar nota"
            onClick={() => onDelete(id)}
            disabled={!editable}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {paletteOpen && (
        <div
          id={paletteId}
          className="note__palette"
          role="group"
          aria-label="Color de la nota"
          onKeyDown={handlePaletteKeyDown}
        >
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch swatch--${color}`}
              aria-label={COLOR_LABELS[color]}
              aria-pressed={color === note.color}
              onClick={() => pickColor(color)}
            />
          ))}
        </div>
      )}

      <textarea
        ref={textRef}
        className="note__text"
        value={note.text}
        onChange={(event) => onTextChange(id, event.target.value, caretOf(event.target))}
        onSelect={rememberCaret}
        onFocus={(event) => {
          onEditingChange(id);
          rememberCaret(event);
        }}
        onBlur={() => onEditingChange(null)}
        data-board-text=""
        maxLength={MAX_TEXT_LENGTH}
        readOnly={!editable}
        placeholder="Escribe algo…"
        aria-label="Texto de la nota"
        spellCheck
      />
    </article>
  );
});
