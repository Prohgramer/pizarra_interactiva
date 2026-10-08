-- Etapa 4: cada sala se guarda como el estado de su documento Yjs.
ALTER TABLE rooms ADD COLUMN doc bytea;

-- Las filas de `notes` son de la Etapa 2. No se convierten aquí (armar un
-- documento Yjs necesita la librería, no SQL): cada sala se migra sola la
-- primera vez que se abre, y al guardarse su documento se borran sus filas.
COMMENT ON TABLE notes IS 'Legado de la Etapa 2: se migra a rooms.doc al abrir cada sala.';
