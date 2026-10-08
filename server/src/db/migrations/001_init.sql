-- Salas. Se crean al guardar su primera nota; el id lo genera el cliente.
CREATE TABLE rooms (
  id         text        PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Notas de cada sala. Los valores llegan ya validados y normalizados por el
-- servidor (validation.ts); aquí solo se guardan.
CREATE TABLE notes (
  room_id    text             NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  id         uuid             NOT NULL,
  x          integer          NOT NULL,
  y          integer          NOT NULL,
  text       text             NOT NULL,
  color      text             NOT NULL,
  rotation   double precision NOT NULL,
  -- Orden de apilamiento (orden de creación dentro de la sala).
  sort_order integer          NOT NULL,
  created_at timestamptz      NOT NULL DEFAULT now(),
  updated_at timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, id)
);
