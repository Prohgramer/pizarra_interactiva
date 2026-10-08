/**
 * Piezas sueltas del cliente: rutas, identidad local, presencia y cursores.
 * Son funciones puras (o casi), así que se prueban sin montar nada.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import type { PeerPresence } from '@pizarra/shared';
import { peersReducer, type PeersState } from '../src/hooks/peersReducer';
import { createCursorStore } from '../src/lib/cursorStore';
import { initials, loadIdentity, saveIdentity } from '../src/lib/identity';
import { boardPath, loginPath, parseRoute } from '../src/lib/router';
import { formatRoomCode, forgetRoom, loadRecentRooms, rememberRoom } from '../src/lib/recentRooms';

function peer(id: string, overrides: Partial<PeerPresence> = {}): PeerPresence {
  return { id, name: `Persona ${id}`, color: 'indigo', cursor: null, focus: null, ...overrides };
}

describe('rutas', () => {
  test('reconoce las pantallas de la app', () => {
    expect(parseRoute('/')).toEqual({ page: 'home' });
    expect(parseRoute('/entrar')).toEqual({ page: 'login' });
    expect(parseRoute('/caso')).toEqual({ page: 'case' });
    expect(parseRoute('/tablero/abcdefghijkl')).toEqual({ page: 'board', roomId: 'abcdefghijkl' });
    expect(parseRoute('/tablero/abcdefghijkl/')).toEqual({ page: 'board', roomId: 'abcdefghijkl' });
  });

  test('un id de sala que no tiene la forma correcta no es un tablero', () => {
    for (const ruta of ['/tablero/corto', '/tablero/ABCDEFGHIJKL', '/tablero/abcdefghijk!', '/otra-cosa']) {
      expect(parseRoute(ruta)).toEqual({ page: 'not-found' });
    }
  });

  test('el enlace para entrar recuerda a dónde volver', () => {
    expect(loginPath('/tablero/abcdefghijkl')).toBe('/entrar?volver=%2Ftablero%2Fabcdefghijkl');
    expect(loginPath('/')).toBe('/entrar');
    expect(loginPath()).toBe('/entrar');
  });

  test('boardPath arma la ruta del tablero', () => {
    expect(boardPath('abcdefghijkl')).toBe('/tablero/abcdefghijkl');
  });
});

describe('identidad local', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('inventa una identidad la primera vez y la reconoce después', () => {
    const primera = loadIdentity();
    expect(primera.isNew).toBe(true);
    expect(primera.identity.name.length).toBeGreaterThan(0);

    saveIdentity(primera.identity);
    expect(loadIdentity()).toEqual({ identity: primera.identity, isNew: false });
  });

  test('una identidad guardada que no sirve se reemplaza', () => {
    window.localStorage.setItem('pizarra:identidad', '{"name":"  ","color":"fucsia"}');
    expect(loadIdentity().isNew).toBe(true);
  });

  test('las iniciales salen de las dos primeras palabras', () => {
    expect(initials('Nutria curiosa')).toBe('NC');
    expect(initials('ana')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials('Ana de los Ríos')).toBe('AD');
  });
});

describe('presencia', () => {
  const vacío: PeersState = new Map();

  test('entrar, renombrar, enfocar y salir', () => {
    let state = peersReducer(vacío, { type: 'join', peer: peer('a') });
    state = peersReducer(state, { type: 'join', peer: peer('b') });
    expect([...state.keys()]).toEqual(['a', 'b']);

    state = peersReducer(state, { type: 'rename', id: 'a', name: 'Ana' });
    expect(state.get('a')?.name).toBe('Ana');

    state = peersReducer(state, { type: 'focus', id: 'a', noteId: 'nota-1' });
    expect(state.get('a')?.focus).toBe('nota-1');

    state = peersReducer(state, { type: 'leave', id: 'a' });
    expect(state.has('a')).toBe(false);
    expect(state.has('b')).toBe(true);
  });

  test('lo que no cambia nada devuelve el mismo estado (para no renderizar de más)', () => {
    const state = peersReducer(vacío, { type: 'join', peer: peer('a') });
    expect(peersReducer(state, { type: 'leave', id: 'no-existe' })).toBe(state);
    expect(peersReducer(state, { type: 'rename', id: 'no-existe', name: 'X' })).toBe(state);
    expect(peersReducer(vacío, { type: 'reset', peers: [] })).toBe(vacío);
  });

  test('reset reemplaza a todas las personas', () => {
    const state = peersReducer(vacío, { type: 'join', peer: peer('a') });
    const next = peersReducer(state, { type: 'reset', peers: [peer('c', { focus: 'nota-2' })] });
    expect([...next.keys()]).toEqual(['c']);
    expect(next.get('c')?.focus).toBe('nota-2');
  });
});

describe('cursores', () => {
  test('avisa a quien escucha solo cuando algo cambia', () => {
    const store = createCursorStore();
    let avisos = 0;
    const stop = store.subscribe(() => {
      avisos += 1;
    });

    store.set('a', { x: 10, y: 20 });
    expect(store.getSnapshot().get('a')).toEqual({ x: 10, y: 20 });
    expect(avisos).toBe(1);

    // Quitar un cursor que no estaba no cambia nada.
    store.set('b', null);
    expect(avisos).toBe(1);

    store.set('a', null);
    expect(store.getSnapshot().size).toBe(0);
    expect(avisos).toBe(2);

    // Tras darse de baja ya no recibe avisos.
    stop();
    store.set('a', { x: 1, y: 1 });
    expect(avisos).toBe(2);
  });

  test('cada cambio deja una foto nueva (para useSyncExternalStore)', () => {
    const store = createCursorStore();
    const antes = store.getSnapshot();
    store.set('a', { x: 1, y: 1 });
    expect(store.getSnapshot()).not.toBe(antes);
  });
});

describe('tableros recientes', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('recuerda los visitados, sin repetir y con el último primero', () => {
    rememberRoom('abcdefghijkl');
    rememberRoom('mnopqrstuvwx');
    rememberRoom('abcdefghijkl');

    expect(loadRecentRooms().map((room) => room.id)).toEqual(['abcdefghijkl', 'mnopqrstuvwx']);
    expect(forgetRoom('abcdefghijkl').map((room) => room.id)).toEqual(['mnopqrstuvwx']);
  });

  test('descarta lo que haya guardado que no sea un tablero', () => {
    window.localStorage.setItem('pizarra:tableros-recientes', '[{"id":"malo","visitedAt":1},"otra cosa"]');
    expect(loadRecentRooms()).toEqual([]);
  });

  test('el código se muestra en grupos de cuatro', () => {
    expect(formatRoomCode('k3v9x2pq7m1z')).toBe('k3v9 x2pq 7m1z');
  });
});
