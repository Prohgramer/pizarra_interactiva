/**
 * Permisos del tablero según el servidor, por HTTP.
 *
 * Se consulta antes de conectar el socket para saber si hay que mostrar el
 * tablero como solo lectura (o directamente negar la entrada), y trae además
 * el dueño y, si eres el dueño, las personas invitadas.
 */
import { useCallback, useEffect, useState } from 'react';
import { OPEN_ACCESS, type RoomAccess, type RoomMember } from '@pizarra/shared';
import { ApiError, api } from '../lib/api';

export type AccessStatus = 'loading' | 'ready' | 'forbidden' | 'unavailable';

export interface RoomAccessState {
  status: AccessStatus;
  access: RoomAccess;
  owner: { id: string; name: string } | null;
  members: RoomMember[];
  setAccess: (access: RoomAccess) => void;
  setMembers: (members: RoomMember[]) => void;
  refresh: () => void;
}

export function useRoomAccess(roomId: string, token: string | null): RoomAccessState {
  const [status, setStatus] = useState<AccessStatus>('loading');
  // Hasta saber otra cosa se asume lo de siempre: tablero público y abierto.
  const [access, setAccess] = useState<RoomAccess>(OPEN_ACCESS);
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    api
      .roomAccess(roomId, token, controller.signal)
      .then((response) => {
        setAccess(response.access);
        setOwner(response.owner);
        setMembers(response.members ?? []);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === 'FORBIDDEN') {
          setStatus('forbidden');
          return;
        }
        // Servidor sin cuentas, o sin conexión: se sigue como siempre, y si el
        // servidor no está de acuerdo, rechazará los cambios.
        setAccess(OPEN_ACCESS);
        setOwner(null);
        setMembers([]);
        setStatus('unavailable');
      });
    return () => controller.abort();
  }, [roomId, token, attempt]);

  return { status, access, owner, members, setAccess, setMembers, refresh };
}
