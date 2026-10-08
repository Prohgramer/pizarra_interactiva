import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BOARD_HEIGHT, BOARD_WIDTH, type Identity, type Peer, type Point } from '@pizarra/shared';
import { Board } from '../components/Board';
import { EyeIcon, LockIcon } from '../components/Icons';
import { Link } from '../components/Link';
import { SharePanel } from '../components/SharePanel';
import { Toast } from '../components/Toast';
import { Toolbar } from '../components/Toolbar';
import { useBoard } from '../hooks/useBoard';
import { useNotice } from '../hooks/useNotice';
import { useRoomAccess } from '../hooks/useRoomAccess';
import { useSession } from '../hooks/useSession';
import { useUndoShortcuts } from '../hooks/useUndoShortcuts';
import { copyText } from '../lib/clipboard';
import { loadIdentity, saveIdentity } from '../lib/identity';
import { rememberRoom } from '../lib/recentRooms';
import { loginPath } from '../lib/router';

interface BoardPageProps {
  roomId: string;
}

export function BoardPage({ roomId }: BoardPageProps) {
  const { notice, showNotice, dismissNotice } = useNotice();
  const [initial] = useState(loadIdentity);
  const [local, setLocal] = useState<Identity>(initial.identity);
  const session = useSession();
  const { user, token } = session;
  const room = useRoomAccess(roomId, token);

  // Con cuenta, el nombre que ven las demás personas es el de la cuenta.
  const identity = useMemo<Identity>(() => (user ? { ...local, name: user.name } : local), [local, user]);

  const {
    ready,
    notes,
    status,
    pendingChanges,
    access: liveAccess,
    forbidden,
    self,
    peers,
    cursors,
    createNote,
    moveNote,
    commitMove,
    editText,
    setColor,
    deleteNote,
    canUndo,
    canRedo,
    undo,
    redo,
    rememberCaret,
    resolveCaret,
    updateCursor,
    setFocus,
    rename,
  } = useBoard(roomId, { identity, token, onSessionExpired: session.forget, onNotice: showNotice });

  const viewportRef = useRef<HTMLElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const claimedRef = useRef(false);

  // El permiso que vale es el del socket (lo dice el servidor al conectar y
  // cuando cambia); hasta entonces, el que respondió la API.
  const access = liveAccess ?? room.access;
  const readOnly = !access.canWrite;
  // Local-first: se edita con o sin conexión, en cuanto cargó la copia local.
  const editable = ready && !readOnly && !forbidden && room.status !== 'loading';

  useEffect(() => {
    rememberRoom(roomId);
    document.title = 'Tablero · Pizarra';
  }, [roomId]);

  // La primera vez se guarda la identidad inventada y se cuenta cómo cambiarla.
  useEffect(() => {
    if (!initial.isNew || user) return;
    saveIdentity(initial.identity);
    showNotice(`Entraste como «${initial.identity.name}». Puedes cambiar tu nombre desde tu avatar, arriba.`);
  }, [initial, showNotice, user]);

  // Con cuenta, el nombre guardado es el de la cuenta: así la próxima visita ya
  // se conecta con el nombre correcto y no hay que reconectar al comprobarlo.
  useEffect(() => {
    if (user) saveIdentity({ ...local, name: user.name });
  }, [local, user]);

  // El tablero acaba de estrenar dueño (la primera nota fue tuya): hay que
  // volver a preguntar quién es y, si eres tú, con quién está compartido.
  useEffect(() => {
    if (claimedRef.current || !liveAccess || liveAccess.ownerless || room.owner) return;
    claimedRef.current = true;
    room.refresh();
  }, [liveAccess, room]);

  // Se empieza en el centro del tablero, con espacio libre en todas las direcciones.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: (BOARD_WIDTH - viewport.clientWidth) / 2,
      top: (BOARD_HEIGHT - viewport.clientHeight) / 2,
    });
  }, []);

  const createAt = useCallback(
    (center: Point) => {
      const note = createNote(center);
      if (note) setFocusId(note.id);
    },
    [createNote],
  );

  const createInView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    createAt({
      x: viewport.scrollLeft + viewport.clientWidth / 2,
      y: viewport.scrollTop + viewport.clientHeight / 2,
    });
  }, [createAt]);

  const shareLink = useCallback(async () => {
    const url = window.location.href;
    const copied = await copyText(url);
    showNotice(copied ? 'Enlace copiado: compártelo para editar en equipo.' : `No se pudo copiar. El enlace es ${url}`);
  }, [showNotice]);

  const handleRename = useCallback(
    (name: string) => {
      if (user) {
        session.rename(name).catch(() => showNotice('No se pudo cambiar el nombre de tu cuenta.'));
        return;
      }
      const next = { ...local, name };
      saveIdentity(next);
      setLocal(next);
      rename(name);
    },
    [local, rename, session, showNotice, user],
  );

  const handleLogout = useCallback(() => {
    void session.logout();
    showNotice('Saliste de tu cuenta. Sigues en el tablero como invitada o invitado.');
  }, [session, showNotice]);

  // Si lo que se deshizo era texto, la nota recupera el foco y el cursor.
  const handleUndo = useCallback(() => setFocusId(undo()), [undo]);
  const handleRedo = useCallback(() => setFocusId(redo()), [redo]);
  useUndoShortcuts({ enabled: editable, onUndo: handleUndo, onRedo: handleRedo });

  const clearFocusRequest = useCallback(() => setFocusId(null), []);

  // Antes del primer `init` se muestra la identidad local; después, la que confirmó el servidor.
  const me: Peer = self ?? { id: 'local', ...identity };
  const peerList = useMemo(() => Array.from(peers.values()), [peers]);

  if (room.status === 'forbidden' || forbidden) {
    return <NoAccess signedIn={user !== null} />;
  }

  return (
    <>
      <Toolbar
        status={status}
        self={me}
        peers={peerList}
        user={user}
        sessionLoading={session.status === 'loading'}
        canCreate={editable}
        canUndo={canUndo && editable}
        canRedo={canRedo && editable}
        onCreate={createInView}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onShare={() => setSharing(true)}
        onRename={handleRename}
        onLogout={handleLogout}
      />

      {readOnly && (
        <p className="banner banner--info" role="status">
          <EyeIcon width={16} height={16} />
          <span>
            <strong>Solo lectura.</strong>{' '}
            {access.role === 'guest'
              ? 'Quien creó este tablero comparte el enlace para mirarlo.'
              : 'Te invitaron a mirar este tablero.'}
          </span>
        </p>
      )}

      {!readOnly && status === 'offline' && (
        <p className="banner" role="status">
          <strong>Sin conexión.</strong> Puedes seguir editando: los cambios se guardan en este dispositivo
          {pendingChanges ? ' y se enviarán' : ' y se sincronizarán'} al volver la conexión.
        </p>
      )}

      <Board
        viewportRef={viewportRef}
        notes={notes}
        status={status}
        editable={editable}
        peers={peers}
        cursors={cursors}
        focusId={focusId}
        onAutoFocused={clearFocusRequest}
        onCreateAt={createAt}
        onMove={moveNote}
        onCommitMove={commitMove}
        onTextChange={editText}
        onColorChange={setColor}
        onDelete={deleteNote}
        onCursor={updateCursor}
        onEditingChange={setFocus}
        onCaretChange={rememberCaret}
        resolveCaret={resolveCaret}
      />

      {sharing && (
        <SharePanel
          roomId={roomId}
          token={token}
          signedIn={user !== null}
          room={room}
          access={access}
          onClose={() => setSharing(false)}
          onCopyLink={() => void shareLink()}
          onNotice={showNotice}
        />
      )}

      <Toast notice={notice} onDismiss={dismissNotice} />
    </>
  );
}

/** El tablero existe, pero esta persona no puede entrar. */
function NoAccess({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    document.title = 'Tablero privado · Pizarra';
  }, []);

  return (
    <main className="home home--centered">
      <section className="home__hero">
        <p className="lost-note note--blue" aria-hidden="true">
          <LockIcon width={28} height={28} />
        </p>
        <h1 className="home__title">Este tablero es privado</h1>
        <p className="home__lead">
          {signedIn
            ? 'Tu cuenta no está en la lista de personas invitadas. Pide a quien lo creó que te invite con el correo de tu cuenta.'
            : 'Quien lo creó eligió quién puede entrar. Si te invitaron, entra con tu cuenta para verlo.'}
        </p>
        <div className="home__actions">
          {!signedIn && (
            <Link to={loginPath(window.location.pathname)} className="button button--primary button--large">
              Entrar a mi cuenta
            </Link>
          )}
          <Link to="/" className="button button--ghost button--large">
            Ir al inicio
          </Link>
        </div>
      </section>
    </main>
  );
}
