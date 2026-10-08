import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { clampNotePosition } from '@pizarra/shared';

interface DragOptions {
  /** Posición actual de la nota (punto de partida del arrastre). */
  x: number;
  y: number;
  disabled: boolean;
  /** Se llama como mucho una vez por frame mientras se arrastra. */
  onMove: (x: number, y: number) => void;
  /** Se llama al soltar, solo si la nota se movió. */
  onEnd: (x: number, y: number) => void;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  moved: boolean;
  frame: number | null;
}

/**
 * Arrastre con pointer events y pointer capture: el mismo código sirve para
 * mouse, lápiz y táctil, y el puntero sigue "enganchado" aunque salga de la nota.
 * El elemento que recibe los handlers debe tener `touch-action: none`.
 */
export function useDrag(options: DragOptions) {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const stateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    const { disabled, x, y } = optionsRef.current;
    if (disabled || stateRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Los botones de acción de la nota no inician un arrastre.
    if (event.target instanceof Element && event.target.closest('[data-no-drag]')) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: x,
      originY: y,
      x,
      y,
      moved: false,
      frame: null,
    };
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = stateRef.current;
    if (!state || event.pointerId !== state.pointerId) return;

    const next = clampNotePosition(
      state.originX + event.clientX - state.startClientX,
      state.originY + event.clientY - state.startClientY,
    );
    if (next.x === state.x && next.y === state.y) return;
    state.x = next.x;
    state.y = next.y;
    state.moved = true;

    // Varios pointermove por frame se agrupan en una sola actualización.
    if (state.frame === null) {
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        optionsRef.current.onMove(state.x, state.y);
      });
    }
  }, []);

  const finish = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = stateRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    stateRef.current = null;
    setIsDragging(false);
    if (state.moved) optionsRef.current.onEnd(state.x, state.y);
  }, []);

  return {
    isDragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  };
}
