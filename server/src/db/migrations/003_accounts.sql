-- Etapa 6: cuentas, sesiones y permisos por tablero.

-- El correo se guarda normalizado (minúsculas, sin espacios): así «Ana@X.com»
-- y «ana@x.com» son la misma cuenta sin depender de la extensión citext.
CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE CHECK (email = lower(email)),
  name          text        NOT NULL,
  -- scrypt con sal por cuenta; el formato incluye los parámetros (ver accounts/passwords.ts).
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Del token de sesión se guarda solo su hash: quien lea la base no puede
-- usar las sesiones de nadie.
CREATE TABLE sessions (
  token_hash   bytea       PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Un tablero pasa a tener dueño cuando alguien con cuenta escribe en él por
-- primera vez. Los de antes de esta etapa se quedan sin dueño y públicos.
ALTER TABLE rooms
  ADD COLUMN owner_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'link-read', 'private'));

CREATE INDEX rooms_owner_id_idx ON rooms (owner_id);

-- Personas invitadas por el dueño. El tablero tiene que existir (tener dueño).
CREATE TABLE room_members (
  room_id    text        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX room_members_user_id_idx ON room_members (user_id);
