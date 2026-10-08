import { memo, useMemo, useRef, type CSSProperties, type MouseEvent, type RefObject } from 'react';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  type Note,
  type NoteColor,
  type Peer,
  type Point,
} from '@pizarra/shared';
import type { PeersState } from '../hooks/peersReducer';
import { useCursorTracking } from '../hooks/useCursorTracking';
import type { Caret, ConnectionStatus } from '../hooks/useBoard';
import type { CursorStore } from '../lib/cursorStore';
import { Cursors } from './Cursors';
import { StickyNote } from './StickyNote';

interface BoardProps {
  viewportRef: RefObject<HTMLElement | null>;
  notes: Note[];
  status: ConnectionStatus;
  editable: boolean;
  peers: PeersState;
  cursors: CursorStore;
  focusId: string | null;
  onAutoFocused: () => void;
  onCreateAt: (center: Point) => void;
  onMove: (id: string, x: number, y: number) => void;
  onCommitMove: (id: string, x: number, y: number) => void;
  onTextChange: (id: string, value: string, caret: Caret) => void;
  onColorChange: (id: string, color: NoteColor) => void;
  onDelete: (id: string) => void;
  onCursor: (cursor: Point | null) => void;
  onEditingChange: (id: string | null) => void;
  onCaretChange: (id: string, caret: Caret) => void;
  resolveCaret: (id: string) => Caret | null;
}

// Las medidas salen del paquete compartido; el CSS las lee como variables.
const boardStyle = {
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
  '--note-width': `${NOTE_WIDTH}px`,
  '--note-height': `${NOTE_HEIGHT}px`,
} as CSSProperties;

/** Array vacío compartido: una nota sin editores no cambia de props (y `memo` la salta). */
const NO_EDITORS: readonly Peer[] = [];

/**
 * El tablero. Está memorizado: los movimientos de cursores ajenos no lo
 * vuelven a renderizar (solo a la capa <Cursors>, que lee su propio store).
 */
export const Board = memo(function Board({
  viewportRef,
  notes,
  status,
  editable,
  peers,
  cursors,
  focusId,
  onAutoFocused,
  onCreateAt,
  onMove,
  onCommitMove,
  onTextChange,
  onColorChange,
  onDelete,
  onCursor,
  onEditingChange,
  onCaretChange,
  resolveCaret,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  useCursorTracking(viewportRef, boardRef, onCursor);

  // Quién edita cada nota; se recalcula solo cuando cambia la presencia, no con los cursores.
  const editorsByNote = useMemo(() => {
    const map = new Map<string, Peer[]>();
    for (const peer of peers.values()) {
      if (!peer.focus) continue;
      const list = map.get(peer.focus);
      if (list) list.push(peer);
      else map.set(peer.focus, [peer]);
    }
    return map;
  }, [peers]);

  // Doble clic sobre el fondo (no sobre una nota): nota nueva centrada en el cursor.
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !editable) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onCreateAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <main ref={viewportRef} className="viewport" data-status={status} aria-label="Tablero de notas">
      <div ref={boardRef} className="board" style={boardStyle} onDoubleClick={handleDoubleClick}>
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            editable={editable}
            editors={editorsByNote.get(note.id) ?? NO_EDITORS}
            autoFocus={note.id === focusId}
            onAutoFocused={onAutoFocused}
            onMove={onMove}
            onCommitMove={onCommitMove}
            onTextChange={onTextChange}
            onColorChange={onColorChange}
            onDelete={onDelete}
            onEditingChange={onEditingChange}
            onCaretChange={onCaretChange}
            resolveCaret={resolveCaret}
          />
        ))}
        {/* En el centro del tablero (donde arranca la vista) y por debajo de los cursores. */}
        {editable && notes.length === 0 && (
          <div className="empty-hint">
            <p className="empty-hint__title">El tablero está en blanco</p>
            <p>Haz doble clic en el fondo o usa «Nueva nota». Para editar en equipo, comparte el enlace.</p>
          </div>
        )}
        <Cursors store={cursors} peers={peers} />
      </div>
    </main>
  );
});
