import { useEffect, type RefObject } from 'react';
import type { Point } from '@pizarra/shared';

/**
 * Informa la posición del puntero en coordenadas del tablero (no de la
 * pantalla), así coincide para todos aunque cada quien tenga otro scroll o
 * tamaño de ventana. Informa null al salir del tablero o al ocultar la pestaña.
 *
 * Solo mouse y lápiz: en táctil no hay puntero flotante, y enviar cada toque
 * de scroll sería ruido. `onCursor` debe ser estable.
 */
export function useCursorTracking(
  viewportRef: RefObject<HTMLElement | null>,
  boardRef: RefObject<HTMLElement | null>,
  onCursor: (cursor: Point | null) => void,
): void {
  useEffect(() => {
    const viewport = viewportRef.current;
    const board = boardRef.current;
    if (!viewport || !board) return;

    let last: { clientX: number; clientY: number } | null = null;

    const report = () => {
      if (!last) return;
      const rect = board.getBoundingClientRect();
      onCursor({ x: last.clientX - rect.left, y: last.clientY - rect.top });
    };

    const hide = () => {
      last = null;
      onCursor(null);
    };

    const handleMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      last = { clientX: event.clientX, clientY: event.clientY };
      report();
    };

    const handleLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') hide();
    };

    const handleVisibility = () => {
      if (document.hidden) hide();
    };

    // Con la rueda el tablero se desplaza bajo un puntero quieto: su posición en el tablero cambia.
    viewport.addEventListener('pointermove', handleMove);
    viewport.addEventListener('pointerleave', handleLeave);
    viewport.addEventListener('scroll', report, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      viewport.removeEventListener('pointermove', handleMove);
      viewport.removeEventListener('pointerleave', handleLeave);
      viewport.removeEventListener('scroll', report);
      document.removeEventListener('visibilitychange', handleVisibility);
      onCursor(null);
    };
  }, [viewportRef, boardRef, onCursor]);
}
