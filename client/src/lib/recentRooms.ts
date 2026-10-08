import { isRoomId } from '@pizarra/shared';

/**
 * Tableros visitados, solo en este navegador (localStorage). Es una comodidad:
 * si el almacenamiento no está disponible (modo privado, bloqueado), la lista
 * queda vacía y nada más falla.
 */
export interface RecentRoom {
  id: string;
  visitedAt: number;
}

const STORAGE_KEY = 'pizarra:tableros-recientes';
const MAX_RECENT = 8;

function isRecentRoom(value: unknown): value is RecentRoom {
  if (typeof value !== 'object' || value === null) return false;
  const { id, visitedAt } = value as Record<string, unknown>;
  return isRoomId(id) && typeof visitedAt === 'number' && Number.isFinite(visitedAt);
}

export function loadRecentRooms(): RecentRoom[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentRoom).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecentRooms(rooms: RecentRoom[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  } catch {
    // Sin almacenamiento disponible: no hay recientes y no pasa nada más.
  }
}

export function rememberRoom(id: string): void {
  const others = loadRecentRooms().filter((room) => room.id !== id);
  saveRecentRooms([{ id, visitedAt: Date.now() }, ...others].slice(0, MAX_RECENT));
}

export function forgetRoom(id: string): RecentRoom[] {
  const rooms = loadRecentRooms().filter((room) => room.id !== id);
  saveRecentRooms(rooms);
  return rooms;
}

/** `k3v9x2pq7m1z` → `k3v9 x2pq 7m1z`, más fácil de leer y de dictar. */
export function formatRoomCode(id: string): string {
  return id.match(/.{1,4}/g)?.join(' ') ?? id;
}

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

export function formatVisitedAt(timestamp: number, now = Date.now()): string {
  const seconds = (timestamp - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'hace un momento';
  if (abs < 3600) return relativeTime.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeTime.format(Math.round(seconds / 3600), 'hour');
  return relativeTime.format(Math.round(seconds / 86_400), 'day');
}
