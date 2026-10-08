# Pizarra · notas adhesivas en tiempo real

Pizarra colaborativa tipo Miro simplificado: varias personas crean, mueven y editan
notas adhesivas a la vez y ven los cambios de las demás al instante, con sus cursores
en vivo. Cada tablero tiene su propia URL, se puede editar sin conexión y queda
guardado en PostgreSQL.

**[Caso de estudio](CASO-DE-ESTUDIO.md):** por qué está hecha así, qué costó cada
decisión y qué se rompió por el camino. En la app, la versión corta está en `/caso`.

Proyecto de portafolio construido por etapas. Van completadas la **Etapa 1 (MVP en
tiempo real)**, la **Etapa 2 (salas con URL propia y persistencia en PostgreSQL)**, la
**Etapa 3 (presencia: cursores en vivo con nombre y color)**, la **Etapa 4 (CRDTs con
Yjs y edición sin conexión)**, la **Etapa 5 (deshacer y rehacer por usuario)** y la
**Etapa 6 (cuentas, permisos y pruebas)** (ver [hoja de ruta](#hoja-de-ruta)).

## Características

- **Sin conexión y sin conflictos (CRDTs con Yjs):**
  - Se puede seguir editando sin conexión: los cambios se guardan en el dispositivo
    (IndexedDB), sobreviven a recargar la página y se sincronizan al volver.
  - Dos personas pueden escribir en la misma nota a la vez: el texto se fusiona
    carácter a carácter, sin pisarse y sin que el cursor salte.
- **Cuentas opcionales y permisos por tablero:**
  - Sin cuenta se sigue entrando a cualquier tablero público con su enlace, como antes.
  - Con cuenta, el tablero que creas es tuyo: eliges si cualquiera con el enlace puede
    editar, solo mirar, o si es privado para las personas que invites.
  - Tus tableros (propios e invitados) aparecen juntos en la portada.
  - Con cuenta, el nombre que ven las demás personas es el de tu cuenta, no uno que se
    pueda escribir en la URL.
- **Deshacer y rehacer lo tuyo** (`Ctrl+Z` / `Ctrl+Mayús+Z`, o los botones de la
  barra): cada quien deshace solo sus propios cambios, sin tocar los de las demás.
  Funciona también sin conexión, y al deshacer un texto la nota recupera el foco con el
  cursor donde estaba.
- **Presencia en vivo:**
  - Ves el cursor de cada persona con su nombre y su color, y quién está escribiendo en
    cada nota.
  - Los avatares de la barra muestran quién está en el tablero; tocando el tuyo cambias
    tu nombre.
  - La primera vez recibes un nombre al azar ("Nutria curiosa"). Dentro de un mismo
    tablero, los colores no se repiten mientras haya libres.
- **Tableros con URL propia** (`/tablero/k3v9x2pq7m1z`): se crean desde la portada y
  se comparten copiando el enlace. La portada recuerda tus tableros recientes (en este
  navegador).
- **Persistencia en PostgreSQL:** todo queda guardado; al volver, el tablero está como
  lo dejaron.
- Tablero grande (4000 × 3000 px) con scroll y fondo de cuadrícula de puntos.
- Crear notas con doble clic sobre el fondo (centrada en el cursor) o con **Nueva nota**
  (en el centro de la vista). La nota nueva recibe el foco para escribir.
- Cada nota tiene posición, texto, uno de 5 colores y una inclinación aleatoria entre
  -3° y 3° que se fija al crearla. Al tomarla se endereza y se despega con una sombra
  más profunda.
- Mover arrastrando la franja superior (mouse, lápiz o táctil) o con las flechas del
  teclado sobre el asa. Editar texto, cambiar color y eliminar.
- Indicador de conexión (Conectando / En vivo / Sin conexión) y reconexión automática,
  incluso si la conexión queda «zombi» (abierta pero muda).
- Accesible: foco visible, botones con `aria-label`, respeta `prefers-reduced-motion`
  y en pantallas táctiles los botones de la nota están siempre visibles.

## Cómo correrlo

Requisitos: Node.js 20.12 o superior (probado con Node 24) y npm 7 o superior (workspaces).

```bash
npm install
npm run dev
```

Esto levanta el servidor en `http://localhost:8080` y el cliente en
`http://localhost:5173`. Crea un tablero y abre su enlace en otra pestaña (o en otro
navegador) para ver la sincronización.

### Base de datos

Sin configurar nada, el servidor guarda los tableros **en memoria** (y lo avisa al
arrancar): sirve para probar, pero se pierden al reiniciarlo. Para persistir de verdad,
define `DATABASE_URL` en `server/.env` (copia `server/.env.example`) con cualquiera
de estas opciones:

- **Docker:** `docker compose up -d` levanta PostgreSQL 17 en el puerto **5434** (para
  no chocar con otros Postgres en el 5432 o el 5433). La URL ya está en `.env.example`.
  Si ese puerto también está ocupado: `PIZARRA_DB_PORT=5440 docker compose up -d` y
  ajusta `DATABASE_URL`. Los datos persisten en un volumen de Docker
  (`docker compose down -v` los borra).
- **PostgreSQL instalado:** crea una base (`createdb pizarra`) y usa su URL, p. ej.
  `postgres://usuario:clave@localhost:5432/pizarra`.

Las migraciones se aplican solas al arrancar el servidor.

### Scripts

| Script              | Qué hace                                                        |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Servidor (`tsx watch`) y cliente (Vite) juntos con concurrently |
| `npm run typecheck` | `tsc` en `shared`, `server` y `client`                          |
| `npm run build`     | Typecheck completo y build de producción del cliente            |
| `npm test`          | Todas las pruebas: servidor (node:test) y cliente (Vitest)      |
| `npm test -w server` | Solo las del servidor; `-w client`, solo las del cliente        |
| `npm start`         | Servidor en modo producción (lo que ejecuta Render)             |

### Variables de entorno

| Variable            | Dónde    | Por defecto                                   | Descripción                                                        |
| ------------------- | -------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `PORT`              | servidor | `8080`                                        | Puerto HTTP y WebSocket                                            |
| `ALLOWED_ORIGINS`   | servidor | `http://localhost:5173,http://127.0.0.1:5173` | Orígenes que pueden abrir el WebSocket, separados por comas, o `*` |
| `DATABASE_URL`      | servidor | _(vacía: memoria)_                            | Conexión a PostgreSQL                                              |
| `TEST_DATABASE_URL` | pruebas  | _(vacía: PGlite)_                             | PostgreSQL real para `npm test` (usa un esquema temporal propio)   |
| `VITE_WS_URL`       | cliente  | `ws://<host actual>:8080`                     | URL base del servidor WebSocket; en producción `wss://…`           |

Hay ejemplos en [`server/.env.example`](server/.env.example) y
[`client/.env.example`](client/.env.example). El servidor carga `server/.env` si existe
(las variables ya definidas en el entorno tienen prioridad). El cliente usa
`client/.env.local`, como cualquier proyecto de Vite.

**Probar desde el móvil:** en la misma red, ejecuta `npm run dev -w client -- --host`
(y el servidor aparte con `npm run dev -w server`), agrega el origen de la red local a
`ALLOWED_ORIGINS` (p. ej. `http://192.168.1.20:5173`) y abre esa URL en el teléfono.
Sin `VITE_WS_URL`, el cliente se conecta al puerto 8080 del mismo host.

## Arquitectura

```
┌─────────────── navegador ───────────────┐         ┌───────────────────── servidor (Node) ─────────────────────┐
│ /            portada + tus tableros     │  HTTP   │ http.Server ── /health y API de cuentas y permisos        │
│ /entrar      entrar o crear cuenta ◄────┼─────────┼─► Accounts: contraseñas, sesiones, tickets y permisos     │
│ /tablero/:id BoardPage                  │  JSON   │                                                           │
│  └─ useBoard ── Y.Doc + WebSocket ◄─────┼─────────┼─► upgrade /rooms/:id: ¿origen? ¿sala? ¿ticket? ¿permiso?  │
│      copia local en IndexedDB,          │ updates │    └─ RoomManager: abre la sala (carga desde la base)     │
│      throttle, presencia, reconexión    │ base64  │        └─ Room: Y.Doc + copia de prueba + presencia       │
└─────────────────────────────────────────┘         │             ├─ valida el update → lo aplica → reenvía     │
                     ▲                              │             └─ guardado en lote (≤ 1 s) ──► RoomStore     │
                     │                              └───────────────────────────────────────────────┬───────────┘
                     │                                                                              ▼
                     └─── @pizarra/shared: documento, protocolo, límites, cuentas ───   PostgreSQL (o memoria)
```

```
shared/src/     doc.ts (esquema Yjs, validación y operaciones), undo.ts (deshacer),
                protocol.ts (mensajes), accounts.ts (cuentas, permisos y API),
                constants.ts (límites), geometry.ts, rooms.ts (ids de sala), presence.ts
server/src/     index.ts (arranque), server.ts (HTTP + WebSocket), rooms.ts (salas y documentos),
                presence.ts (colores), validation.ts (todo lo que llega del cliente),
                rate-limit.ts (cubo de fichas), config.ts
server/src/accounts/  service.ts (registro, sesiones, permisos), passwords.ts (scrypt),
                      tokens.ts (sesiones y tickets), postgres.ts, types.ts
server/src/http/      api.ts (rutas de cuentas y permisos), respond.ts (JSON, CORS, límites)
server/src/db/        database.ts (pool pg), migrate.ts, migrations/*.sql
server/src/store/     types.ts (RoomStore), postgres.ts, memory.ts
server/test/    realtime (sincronización, conflictos y validación), undo, auth (cuentas),
                permissions (quién puede qué), presence, rooms (salas, persistencia y
                migración), store (SQL), validation
client/src/     pages/ (Home, Board, Login, NotFound), hooks/ (useBoard, useSession,
                useRoomAccess, useDrag, useCursorTracking, useUndoShortcuts),
                components/ (Board, StickyNote, Cursors, People, SharePanel…),
                lib/ (api, session, router, identity, cursorStore…)
client/test/    api (errores y cabeceras), session (sesión guardada), pantallas
                (entrar y barra), estado (rutas, presencia, cursores, recientes)
```

### El documento de una sala

```
notes: Y.Map<id de nota, Y.Map>        (único tipo raíz del documento)
  x, y     number     esquina superior izquierda
  color    NoteColor
  rotation number      inclinación fija
  z        number      orden de apilamiento (empates: por id)
  text     Y.Text      texto colaborativo
```

Posición, color e inclinación se resuelven con la última escritura; el texto, con el
CRDT de Y.Text, que fusiona las ediciones carácter a carácter.

### Presencia

- **Identidad:** nombre y color preferido se guardan en el navegador y viajan en la URL
  del WebSocket (`/rooms/<id>?name=…&color=…`). En el handshake el servidor normaliza el
  nombre, asigna un id de conexión y elige el color: el preferido si nadie lo usa en la
  sala, si no el menos usado. El `init` trae `self` (quién soy) y `peers` (los demás,
  con su cursor y la nota que editan).
- **Cursores:** se envían en **coordenadas del tablero**, no de la pantalla, así
  coinciden aunque cada quien tenga otro scroll o tamaño de ventana. Como mucho cada
  50 ms; ocultarlo (salir del tablero o de la pestaña) se envía al instante.
- **Nota en edición:** al enfocar el texto de una nota se anuncia `presence:focus`; los
  demás la ven con un contorno y una etiqueta en tu color.
- **Nada de esto se guarda:** vive en la memoria del servidor mientras dura la conexión.

### Ciclo de vida de una sala

1. Alguien abre `/tablero/<id>`. El cliente se conecta a `wss://servidor/rooms/<id>`.
2. En el `upgrade`, el servidor valida el origen y el id y **abre la sala**: si no está
   en memoria, la carga desde PostgreSQL. Si llegan varias personas a la vez, se hace
   una sola carga. Si la base no responde, rechaza con 503 y el cliente reintenta.
3. El servidor manda en el `init` el estado completo del documento. El cliente lo
   fusiona con su copia local (IndexedDB) y le devuelve, en un solo `doc:update`, lo que
   el servidor no tenía: sus cambios sin conexión.
4. Mientras la sala está abierta, **la memoria es la fuente de verdad**. Cada update se
   valida (ver abajo), se aplica y se reenvía a los demás clientes de esa sala.
5. Tras un cambio, como mucho 1 s después se escribe el estado completo del documento
   en la base (_write-behind_).
6. Cuando la sala queda vacía, espera 30 s (por si alguien recarga), guarda lo pendiente
   y se descarga de memoria. Al apagar el servidor (SIGTERM) se guardan todas las salas.

### Validación de un update

Un update de CRDT es binario y no se puede deshacer, así que el servidor no lo aplica
hasta saber que el resultado es válido:

1. Lo aplica a una **copia de prueba** del documento, idéntica a la aceptada.
2. Comprueba el documento entero: un solo tipo raíz, ids de nota con formato UUID,
   campos conocidos, posiciones dentro del tablero, colores de la paleta, inclinación
   en rango, texto plano sin caracteres de control y dentro de los límites, y que no
   queden dependencias faltantes.
3. Si algo falla, reconstruye la copia desde el documento aceptado (que no se tocó),
   responde con `error` y cierra con el código 4000. El cliente entonces descarta su
   copia local y se resincroniza desde la del servidor.

### Protocolo

El WebSocket de cada sala vive en `/rooms/<id>?name=…&color=…&ticket=…`. Los mensajes
son JSON:

| Cliente → servidor | Servidor → otros clientes de la sala | Contenido                          |
| ------------------ | ------------------------------------ | ---------------------------------- |
| `doc:update`       | `doc:updated`                        | update de Yjs en base64            |
| `presence:cursor`  | `peer:cursor`                        | `cursor: { x, y } \| null`         |
| `presence:focus`   | `peer:focus`                         | `noteId \| null`                   |
| `presence:rename`  | `peer:renamed`                       | `name`                             |

Además, el servidor envía:

- `init`, al conectar: documento completo, `self`, `peers` y `access` (qué puede hacer
  quien acaba de entrar);
- `access`, cuando cambia lo que esa persona puede hacer (el dueño cambió quién entra,
  o el tablero acaba de tener dueño);
- `peer:joined` y `peer:left`, cuando alguien entra o sale;
- `heartbeat`, cada 30 s, para que el cliente note una conexión muda;
- `error` (código y detalle), al emisor de un mensaje rechazado.

### API HTTP (cuentas y permisos)

El mismo servidor atiende una API JSON con CORS limitado a `ALLOWED_ORIGINS`. La sesión
viaja en `Authorization: Bearer …` (no en cookies: cliente y servidor están en dominios
distintos, y así tampoco hay CSRF). Sin base de datos, todas responden 503.

| Ruta                                     | Qué hace                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| `POST /auth/register`, `POST /auth/login` | Crear cuenta o entrar; devuelven la sesión            |
| `POST /auth/logout`                       | Cierra esa sesión                                     |
| `GET /auth/me`, `PATCH /auth/me`          | Quién soy; cambiar mi nombre                          |
| `POST /auth/ticket`                       | Permiso de un solo uso para abrir el WebSocket        |
| `GET /rooms`                              | Tus tableros (propios e invitados)                    |
| `GET /rooms/:id/access`                   | Qué puedes hacer ahí (y, si eres dueño, con quién está compartido) |
| `PATCH /rooms/:id`                        | Cambiar la visibilidad (solo el dueño)                |
| `POST /rooms/:id/members`, `DELETE /rooms/:id/members/:userId` | Invitar o quitar (solo el dueño)  |

### Esquema

```sql
-- doc: estado del documento Yjs. owner_id: quien escribió primero con su cuenta.
rooms (id text PK, doc bytea, owner_id uuid → users ON DELETE SET NULL,
       visibility text CHECK ('public' | 'link-read' | 'private'), created_at, updated_at)

users (id uuid PK, email text UNIQUE CHECK (email = lower(email)), name text,
       password_hash text, created_at, updated_at)

-- Del token solo se guarda su sha256: quien lea la base no puede usar sesiones ajenas.
sessions (token_hash bytea PK, user_id uuid → users ON DELETE CASCADE,
          created_at, last_seen_at, expires_at)

room_members (room_id text → rooms ON DELETE CASCADE, user_id uuid → users ON DELETE CASCADE,
              role text CHECK ('editor' | 'viewer'), created_at, PRIMARY KEY (room_id, user_id))

-- Legado de la Etapa 2: las salas que aún no se abrieron desde entonces. Al abrirse,
-- sus filas se convierten en documento y se borran.
notes (room_id → rooms ON DELETE CASCADE, id uuid, x, y, text, color, rotation,
       sort_order, created_at, updated_at, PRIMARY KEY (room_id, id))
```

## Decisiones técnicas

### Etapa 6: cuentas, permisos y pruebas

- **Las cuentas son opcionales.** El enlace sigue siendo la forma de compartir un
  tablero: obligar a registrarse para mirar una pizarra rompería lo que la hace útil.
  Una cuenta agrega propiedad (el tablero es de quien escribió primero en él),
  permisos y la lista de tus tableros.
- **Sin base de datos no hay cuentas.** Una cuenta que se pierde al reiniciar no sirve
  de nada, así que sin `DATABASE_URL` la API responde 503 y todo se comporta como en la
  Etapa 5. Es una rama menos que mantener y una promesa menos que romper.
- **Contraseñas con scrypt** (viene en Node, sin dependencias), con sal por cuenta y los
  parámetros guardados junto al hash, para poder subirlos sin invalidar lo ya guardado.
  Entrar con un correo que no existe compara contra un hash de mentira: así la respuesta
  tarda lo mismo y no se puede averiguar qué correos están registrados.
- **De la sesión se guarda el hash, no el token.** Quien lea la base no puede usar la
  sesión de nadie. El token vive en `localStorage` y viaja en una cabecera, no en una
  cookie: cliente y servidor están en dominios distintos (Vercel y Render), las cookies
  de terceros están en retirada y con una cabecera no hay CSRF. A cambio, hay que cuidar
  que la app no tenga XSS.
- **El WebSocket no se abre con el token, sino con un ticket** de un solo uso y 30 s de
  vida (`POST /auth/ticket`). La URL de una conexión puede quedar en registros y proxys,
  y ahí no puede ir algo que sirva por 30 días. El navegador no deja poner cabeceras al
  abrir un WebSocket, así que el ticket es la manera limpia de identificarse.
- **El permiso lo resuelve el servidor en el handshake** y lo manda en `init`; la
  interfaz solo se adapta. Escribir en un tablero donde solo se mira se rechaza con
  `FORBIDDEN` sin cerrar la conexión (se sigue viendo lo que hacen las demás), y quien
  pierde el acceso mientras está dentro se va con el código 4003 y ve por qué.
- **El nombre de quien tiene cuenta lo pone el servidor**, no la URL: `presence:rename`
  se rechaza para esas conexiones. Es el sentido de tener cuentas: que el nombre que se
  ve junto al cursor signifique algo.
- **Límites de ritmo con cubo de fichas**, en dos lugares: los intentos de entrar por
  dirección IP (pocos y que se reponen despacio) y los mensajes por conexión (100 por
  segundo, con ráfagas de 300; lo normal son ~45). Quien se pasa se desconecta, y al
  reconectar se sincroniza: no se pierde nada.
- **El cliente tiene pruebas propias, con Vitest y jsdom** (las del servidor siguen con
  `node:test`, que no necesita DOM). Prueban lo que se ve y se puede hacer —entrar,
  errores del servidor, botones apagados, la sesión guardada—, no los detalles de
  implementación. La primera de ellas encontró un error real: una respuesta de error que
  no fuera JSON (el HTML de un proxy caído) reventaba con un `SyntaxError` en vez de
  avisar.

### Etapa 5: deshacer y rehacer

- **Deshacer por persona sale del propio CRDT.** El gestor (`Y.UndoManager`) solo sigue
  las transacciones con el origen local de esta pestaña: lo que llega del servidor y lo
  que carga IndexedDB quedan fuera. No hace falta un historial compartido ni coordinar
  nada: deshacer nunca revierte lo que hizo otra persona.
- **Deshacer un movimiento es un movimiento más** (`ignoreRemoteMapChanges`). Posición y
  color ya se resuelven con la última escritura, así que devolver una nota a su sitio es
  la misma operación que moverla. Con la opción por defecto, Yjs no puede aplicar un
  paso que otra persona ya pisó y **pasa en silencio al paso anterior**: quien movía una
  nota que otra persona movió después veía desaparecer la nota que había creado antes.
  El texto no entra en este trato: al ser un CRDT de secuencia, deshacer quita solo los
  caracteres propios y respeta los ajenos.
- **Un paso es una acción, no una escritura.** El cliente corta el paso al cambiar de
  acción o de nota (crear, color y borrar son siempre su propio paso) y deja que Yjs
  agrupe por tiempo lo que sigue. Un arrastre es un paso aunque escriba una posición
  cada 50 ms, y aunque quien arrastra se quede quieto un rato antes de soltar: mientras
  dura el gesto se mantiene abierta la ventana de agrupación.
- **Cada paso recuerda dónde estaba el cursor de texto** (como posición relativa de
  Yjs, igual que para los cambios remotos). Al deshacer, la nota recupera el foco y el
  cursor vuelve a donde estaba cuando se hizo el cambio, en vez de saltar al final.
- **El historial es de esta pestaña y de esta sesión:** no se guarda en IndexedDB ni
  viaja al servidor, que solo ve el update resultante y lo valida como cualquier otro.
  Sin conexión se deshace igual, y al reconectar se sincroniza el resultado, no el ida
  y vuelta.
- **`Ctrl+Z` dentro de una nota lo atiende la pizarra**, porque el deshacer del navegador
  devolvería el textarea a un valor que el documento pisaría enseguida. En cualquier
  otro campo (el nombre) se deja el del navegador.
- **El gestor vive en `shared/`,** junto al esquema del documento, porque define qué es
  un paso deshacible; así las pruebas del servidor comprueban el comportamiento real
  entre varias personas, con la misma configuración que usa el cliente.

### Etapa 4: CRDTs y edición sin conexión

- **Yjs con protocolo propio, no `y-websocket`.** Las salas, la presencia, la
  validación y la persistencia ya existían; lo que hacía falta era el modelo de datos.
  Los updates viajan en base64 dentro del mismo JSON que el resto de los mensajes, así
  que todo pasa por la misma validación y las mismas pruebas. El costo es un 33 % de
  tamaño extra por el base64, a cambio de un solo camino para todo lo que entra.
- **Un solo `Y.Doc` por sala y un único tipo raíz.** El texto es `Y.Text` (se fusiona
  carácter a carácter) y el resto de los campos son valores del `Y.Map` de cada nota
  (última escritura gana). El apilamiento es un número `z` con desempate por id, para
  que el orden sea el mismo en todas partes sin depender del orden de llegada.
- **Validar en una copia y rechazar, en vez de corregir.** Un update no se puede
  deshacer: si se aplicara antes de mirarlo, un cliente malicioso podría dejar el
  documento en un estado inválido para todos. Se prueba en una copia y, si no pasa, se
  reconstruye la copia y se le pide al cliente que se resincronice. Un cliente honesto
  nunca llega ahí, porque respeta los mismos límites.
- **Límites más holgados en el servidor que en la interfaz** (`DOC_LIMITS`): al fusionar
  ediciones sin conexión de varias personas, lo que cada una respetó puede sumarse. El
  margen evita descartar trabajo legítimo por una carrera.
- **El cliente es local-first.** El documento vive en IndexedDB y se puede editar sin
  conexión; la conexión se abre recién cuando la copia local terminó de cargar, para que
  el intercambio inicial ya incluya lo editado en visitas anteriores. Se acabó el modo
  de solo lectura de la Etapa 1.
- **El cursor de texto se ancla al contenido.** Se guarda como posición relativa de Yjs
  y se restaura después de cada cambio remoto: si alguien escribe antes de donde estás,
  tu cursor se corre con el texto en vez de saltar al final.
- **Dos throttles distintos:** las escrituras al documento durante un arrastre (cada
  50 ms, con la posición final al soltar) y el envío de updates al servidor (agrupados,
  como mucho cada 50 ms). Un arrastre entero sigue siendo una o dos escrituras en la base.
- **Persistencia como estado completo del documento** (`rooms.doc bytea`), no como
  registro de updates: una sola fila por sala, sin compactación que mantener. Las salas
  de la Etapa 2 se convierten solas la primera vez que se abren, y al guardarse se
  borran sus filas viejas.
- **Señal de vida en los dos sentidos.** El servidor ya cerraba clientes fantasma con
  ping/pong, pero desde JavaScript no se ven los pong: si el servidor caía de golpe, el
  cliente podía quedarse con un socket abierto y mudo mostrando «En vivo». Ahora el
  servidor manda además un mensaje `heartbeat` y el cliente reconecta si pasa 75 s sin
  recibir nada. (Apareció probando la caída del servidor a mano.)

### Etapa 3: presencia

- **Identidad en la URL del handshake, no en un primer mensaje.** El servidor conoce el
  nombre antes de aceptar la conexión, así el `init` ya trae el color asignado y no
  existe un estado intermedio "conectado pero sin nombre". Leerla nunca rechaza la
  conexión: un nombre inválido pasa a "Invitado" y un color desconocido se ignora.
- **El servidor asigna el color, el cliente lo propone.** Cada quien conserva su color
  entre tableros si está libre, y en una sala no se repiten mientras la paleta alcance
  (8 tonos, todos con contraste AA con texto blanco, porque los nombres van encima).
- **Coordenadas del tablero y throttle de 50 ms**, con una transición CSS de 90 ms que
  suaviza los saltos, como con las notas. Ocultar el cursor no espera al throttle, y el
  cliente no reenvía una posición idéntica a la anterior.
- **Los cursores no pasan por el estado de React.** Llegan hasta 20 veces por segundo
  por persona: viven en un pequeño store externo que solo lee la capa de cursores (con
  `useSyncExternalStore`). El tablero está memorizado y no se vuelve a renderizar por
  ellos. Quién edita cada nota sí es estado, porque cambia poco.
- **Mismas reglas que las notas:** los mensajes de presencia se validan en
  `validation.ts` (cursores ajustados al tablero, ids de nota con formato UUID, nombres
  normalizados con la misma función que el cliente) y nunca vuelven al emisor. El
  servidor recuerda el último valor de cada uno para quien entre después.
- **Nada de presencia en la base:** es efímera por naturaleza, y guardarla solo
  agregaría escrituras.

### Etapa 2: salas y persistencia

- **El id de la sala lo genera el cliente y la sala nace con su primera nota**, como en
  Excalidraw. No hace falta una API para crear tableros, y abrir un enlace mal escrito
  no llena la base de salas vacías. Los 12 caracteres `[a-z0-9]` dan ~62 bits de azar:
  el enlace funciona como un secreto imposible de adivinar; desde la Etapa 6, además,
  se puede restringir quién entra. Se generan con rechazo de bytes para no sesgar el
  alfabeto.
- **Memoria como fuente de verdad y guardado en lote (_write-behind_).** Un arrastre
  genera 20 mensajes por segundo; escribir cada uno sería desperdiciar la base. Cada
  nota modificada se marca y, como mucho 1 s después, se guarda su **estado actual** (no
  la historia) con un solo `INSERT … SELECT FROM unnest(…) ON CONFLICT DO UPDATE` y los
  borrados, todo en una transacción. Las pruebas comprueban que un arrastre entero
  termina en 1 o 2 escrituras. El costo: si el proceso muere de golpe se puede perder
  hasta ~1 s de cambios (un apagado ordenado no pierde nada).
- **Nada se descarta si la base falla.** Una escritura fallida devuelve sus notas a la
  lista de pendientes (sin pisar cambios más nuevos) y se reintenta cada 5 s. Una sala
  con cambios sin guardar nunca se descarga de memoria.
- **Carga en el `upgrade`, con conteo de referencias.** La sala se abre antes del
  handshake, así el `init` sale en cuanto conecta, y una base caída se traduce en un 503
  que el cliente ya sabe reintentar. Cada conexión (incluidas las que están a mitad del
  handshake) suma una referencia. La descarga vuelve a comprobarlas después de guardar,
  por si alguien entró mientras tanto.
- **Migraciones propias en SQL plano.** Son archivos numerados que se aplican al
  arrancar, cada uno en su transacción con `pg_advisory_xact_lock` (dos instancias no
  aplican la misma migración). Sin ORM: son dos tablas y cuatro consultas.
- **`RoomStore` como interfaz**, con dos implementaciones: PostgreSQL y memoria. La
  segunda deja que `npm run dev` funcione sin configurar nada y hace rápidas las
  pruebas que no son de persistencia.
- **Pruebas contra Postgres de verdad, sin instalar nada:** por defecto usan
  [PGlite](https://pglite.dev) (PostgreSQL compilado a WASM, en el mismo proceso).
  Con `TEST_DATABASE_URL` corren contra un servidor real por el driver `pg`, cada
  archivo en su propio esquema temporal. La suite pasa de las dos formas (probada con
  PostgreSQL 17).
- **La validación también protege a la base:** PostgreSQL no admite el carácter `\0`
  en `text`, y `validation.ts` ya eliminaba los caracteres de control. Lo que se lee de
  la base se vuelve a normalizar, por si fue escrito con otras reglas.
- **Router propio sobre la History API** (unas 50 líneas): tres pantallas no justifican una
  dependencia. `<Link>` es un `<a href>` real, así que abrir en otra pestaña funciona.
  Vercel reescribe toda ruta a `index.html` (`client/vercel.json`).

### Etapa 1: tiempo real

- **`ws` en vez de Socket.IO.** Da control total del protocolo y no agrega capas
  innecesarias: hoy todos los navegadores soportan WebSocket, así que el fallback de
  long-polling de Socket.IO no aporta. A cambio, la reconexión, el heartbeat y la
  presencia están implementados a mano, y eso es parte de lo que el proyecto muestra.
- **Paquete `shared` consumido como TypeScript fuente.** No tiene paso de build: tsx y
  Vite lo transpilan directamente. Si cambia un mensaje, `tsc` marca errores en ambos
  lados. Además, el servidor tiene un validador por tipo de mensaje (un tipo mapeado
  que obliga a cubrirlos todos) y el cliente un `switch` exhaustivo con `never`.
- **Optimista y sin eco.** El emisor ve su cambio con latencia cero, y no recibir su
  propio eco evita saltos al arrastrar. Para que el emisor y los demás no diverjan,
  cliente y servidor normalizan con las mismas funciones (`clampNotePosition`,
  `clampRotation`). Si el servidor rechaza un cambio por el estado (límite de notas o
  id repetido), responde `error` y un `init` para resincronizar al emisor.
- **El id de nota lo genera el cliente (UUID v4).** La nota optimista nace con su id
  definitivo, sin esperar al servidor. El servidor valida el formato y rechaza
  duplicados. Con `crypto.randomUUID` no disponible (HTTP por IP) se usa `getRandomValues`.
- **Validación escrita a mano, en `validation.ts`.** Es auditable y no suma
  dependencias. Cada campo se lee con `Object.hasOwn` y se copia a un objeto nuevo, así
  que los campos extra (o `__proto__`) nunca llegan al estado. Las coordenadas fuera
  del tablero se ajustan; el resto de los errores se rechaza.
- **Arrastre fluido y liviano.** Movimiento local agrupado por `requestAnimationFrame`,
  envío con throttle de 50 ms por nota y posición final al soltar. Mientras una pestaña
  arrastra una nota, ignora los movimientos remotos sobre ella (gana su posición final).
- **Pointer events con pointer capture.** Un solo código para mouse, lápiz y táctil.
  `touch-action: none` está solo en la franja superior, para que en táctil el resto del
  tablero siga haciendo scroll nativo.
- **Propiedades CSS individuales (`translate`, `rotate`, `scale`).** La posición, la
  inclinación y el efecto de "despegar" no se pisan entre sí y cada una tiene su propia
  transición.
- **Solo lectura sin conexión.** Como el `init` de la reconexión reemplaza el estado,
  cualquier edición sin conexión se perdería en silencio. Es más honesto bloquearla
  (la edición sin conexión llega con los CRDT en la Etapa 4).
- **Robustez de conexión.** Ping cada 30 s (se cierra quien no respondió al anterior),
  backoff exponencial con jitter de 0,5 s a 10 s, reintento inmediato al volver la red
  (`online`) y cierre de clientes con más de 1 MB pendiente de envío.
- **Orígenes verificados en el `upgrade`.** Se rechazan con 403 antes del handshake,
  lo que previene el secuestro de WebSocket entre sitios (CSWSH). Las conexiones sin
  cabecera `Origin` se rechazan salvo con `ALLOWED_ORIGINS=*`.
- **`tsx` también en producción.** Un solo camino de ejecución, sin carpeta `dist` del
  servidor. El costo es una transpilación rápida al arrancar.

## Pruebas

```bash
npm test                                                   # servidor (PGlite) y cliente
npm test -w server                                         # solo el servidor
npm test -w client                                         # solo el cliente (Vitest + jsdom)
TEST_DATABASE_URL=postgres://… npm test                    # contra un PostgreSQL real
```

### Servidor

Levantan el servidor real en un puerto libre y conectan varios clientes con su propio
documento Yjs, que sincronizan igual que el cliente real; las de cuentas hablan con la
API por HTTP, también como el cliente. Comprueban que:

- **tiempo real:** crear, mover, editar y borrar se propaga a los demás y **nunca vuelve
  al emisor**; quien entra tarde recibe el documento completo; un update repetido no se
  reenvía;
- **conflictos y sin conexión:**
  - dos personas escriben en la misma nota sin conexión y, al volver, el texto queda
    fusionado (y el servidor tiene lo mismo);
  - movimientos simultáneos convergen al mismo valor en todas partes;
  - lo creado sin conexión llega a los demás al reconectar;
  - borrar gana sobre una edición simultánea del texto de esa nota;
- **deshacer y rehacer** (con el mismo gestor que usa el cliente):
  - deshacer revierte lo propio y deja lo de las demás, y el resultado se propaga;
  - lo que llega del servidor no entra en la pila;
  - deshacer un movimiento devuelve la nota a su sitio aunque otra persona la haya
    movido después, y todas ven lo mismo;
  - deshacer el texto propio conserva lo que escribió otra persona en esa nota;
  - rehacer vuelve a aplicar lo deshecho; un paso deshecho no se deshace dos veces;
  - deshacer un borrado devuelve la nota entera (texto y color) y el servidor la guarda;
  - sin conexión también se deshace y al volver se sincroniza solo el resultado;
- **cuentas:**
  - el hash de la contraseña lleva sus parámetros, cambia de sal en cada cuenta y un
    hash corrupto no deja entrar en vez de romper;
  - el correo se normaliza, no se puede repetir y los datos inválidos se rechazan
    diciendo qué falta;
  - entrar con una contraseña mala y entrar con un correo que no existe dan **la misma
    respuesta**; demasiados intentos desde una dirección se cortan;
  - un token inventado, uno cerrado y uno vencido no sirven (y el vencido se borra solo);
  - en la base está el hash del token, no el token;
  - el ticket del WebSocket es de un solo uso, vence, y uno inválido no deja entrar como
    invitado;
  - sin base de datos, la API avisa (503) y el tablero sigue funcionando como siempre;
- **permisos:**
  - el tablero es de quien escribe primero con su cuenta, y no cambia de dueño porque
    escriba otra persona;
  - con «solo lectura por enlace» quien entra sin cuenta mira, su `doc:update` se
    rechaza con `FORBIDDEN` y no llega a nadie, pero sigue recibiendo lo que escriben;
  - un tablero privado responde 403 en el handshake a quien no está invitado;
  - el dueño invita por correo y esa persona entra y escribe; quien entra como «viewer»
    no puede escribir;
  - al quitar una invitación, quien estaba conectada se va con el código 4003, y al
    pasar a solo lectura se le avisa en el momento;
  - solo el dueño cambia la visibilidad o la lista de invitadas;
  - «Tus tableros» lista los propios y aquellos a los que te invitaron, con su rol;
  - con cuenta, el nombre sale de la cuenta y no se puede cambiar por el socket;
  - una inundación de mensajes corta la conexión;
- **presencia:**
  - la identidad de la URL llega en `init` y a los demás, normalizada;
  - los colores no se repiten en una sala y uno liberado vuelve a estar disponible;
  - cursores, nota en edición y cambios de nombre se reenvían solo a los demás de la
    sala, y quien entra tarde los ve;
  - `peer:joined` / `peer:left`, rechazo de mensajes de presencia inválidos, y casos
    borde de `normalizeName` (emojis, caracteres de control);
- **salas:** los cambios y la presencia de una sala no llegan a otra; las rutas que no
  son de una sala válida reciben 404;
- **persistencia:**
  - al volver a una sala descargada, todo sigue ahí y en el mismo orden;
  - el tablero sobrevive a reiniciar el servidor (el cierre guarda lo pendiente);
  - un arrastre entero se guarda en 1 o 2 escrituras;
  - si la base no responde, la conexión recibe 503 y `/health` informa `degraded`;
  - si falla una escritura, no se pierde nada: se reintenta y la sala no se descarga;
  - varias personas que entran a la vez comparten una sola carga;
  - una sala de la Etapa 2 se abre como documento y sus filas viejas se borran;
- **SQL** (`PostgresStore`):
  - guardar y cargar el documento byte a byte, y reemplazarlo al volver a guardar;
  - aislamiento entre salas;
  - conversión de filas de la Etapa 2, normalizándolas, y borrado de las filas al guardar;
  - migraciones idempotentes y en orden;
- **seguridad:**
  - mensajes mal formados (JSON roto, tipo desconocido, base64 inválido, binarios,
    mensajes de presencia gigantes) reciben un error y **no cortan la conexión**;
  - updates inválidos (color fuera de la paleta, posición fuera del tablero, id que no
    es UUID, campo desconocido, nota que no es un mapa, texto con formato o con
    caracteres de control, otro tipo raíz, bytes que no son un update, dependencias
    faltantes, límites de notas y de texto) se rechazan, piden resincronizar, no llegan
    a los demás y dejan el documento del servidor intacto;
  - tras un rechazo, el servidor sigue aceptando updates válidos;
  - `maxPayload` de 2 MiB, orígenes no permitidos, conexiones que no responden al ping
    y envío de `heartbeat`.

### Cliente

Con Vitest y jsdom, sobre lo que se ve y se puede hacer:

- **la API:** manda el cuerpo como JSON, lleva el token en la cabecera (nunca en la
  URL), y traduce cada error del servidor a un `ApiError` con su código; sin conexión
  avisa de eso, y una respuesta que no sea JSON tampoco rompe;
- **la sesión guardada:** sin token no se le pregunta nada al servidor; un token válido
  recupera la cuenta; uno que el servidor ya no reconoce se olvida, pero si el servidor
  no responde se conserva para reintentar; al salir se olvida enseguida aunque el
  servidor tarde;
- **la pantalla de entrar:** entra, muestra el motivo cuando el servidor rechaza, pide
  el nombre al crear una cuenta y descarta un «volver» que apunte a otro sitio;
- **la barra del tablero:** deshacer y rehacer apagados cuando no hay nada que hacer,
  «Nueva nota» apagada en solo lectura, y el menú de la cuenta;
- **las piezas sueltas:** rutas (incluidos los ids de sala inválidos), identidad local,
  presencia, cursores y tableros recientes.

## Limitaciones conocidas

- **Hasta ~1 s de cambios puede perderse si el proceso muere de golpe** (no en un
  reinicio ordenado, que guarda todo antes de salir).
- **Un solo proceso de servidor:** cada sala vive en la memoria de una instancia. Con
  varias instancias, dos personas en la misma sala podrían caer en procesos distintos
  y divergir; escalar requeriría enrutar por sala o un bus compartido (p. ej. Redis).
- **Conflictos:** el texto se fusiona, pero la posición, el color y la inclinación se
  resuelven con la última escritura (una pisa a la otra). Si alguien borra una nota
  mientras otra persona la edita, gana el borrado y esa edición se pierde.
- **Sin conexión:**
  - Los cambios viven en el navegador: en otro dispositivo o tras borrar los datos del
    sitio, no están.
  - Si el servidor rechaza la sincronización (documento inválido o límites superados),
    se descartan los cambios locales pendientes y se avisa. Solo debería ocurrir con un
    cliente modificado o en una carrera muy poco probable.
  - Las salas se identifican por su URL: si el servidor pierde una sala y alguien vuelve
    con su copia local, el tablero reaparece.
- **Presencia:**
  - Los cursores son solo de mouse y lápiz (en táctil no hay puntero que mostrar).
  - Un cursor fuera de tu área visible no se señala en el borde.
  - Al reconectar, el color puede cambiar si otra persona tomó el tuyo.
  - Dos pestañas del mismo navegador comparten nombre (con colores distintos).
  - Quien entra sin cuenta elige el nombre que quiera: solo los de las cuentas están
    respaldados por el servidor (y tampoco son únicos).
- **Deshacer:**
  - El historial es de la pestaña y de la sesión: al recargar se empieza de cero.
  - Deshacer un movimiento pisa el movimiento que otra persona hizo después (posición y
    color se resuelven siempre con la última escritura).
  - Si el paso a deshacer ya no tiene efecto (por ejemplo, la nota la borró otra
    persona), Yjs deshace el anterior: `Ctrl+Z` puede revertir algo más viejo de lo
    esperado.
  - Deshacer la creación de una nota la borra aunque otra persona haya escrito en ella.
  - No devuelve una nota que borró otra persona: para eso tendría que deshacer un cambio
    ajeno.
- **El documento crece despacio con el historial** (las ediciones dejan marcas de
  borrado). Con los límites actuales no es un problema, pero no hay compactación.
- **La validación revisa el documento completo en cada update.** Es simple y alcanza
  con estos límites; si el tablero creciera, convendría validar solo las notas tocadas.
- **Cuentas y permisos:**
  - No hay verificación del correo ni forma de recuperar la contraseña: hacen falta
    correos salientes, que este proyecto no tiene.
  - El dueño invita por correo y, si no existe esa cuenta, el servidor lo dice: es
    cómodo para invitar, pero permite averiguar si un correo está registrado. Con más
    tráfico convendrían invitaciones por enlace.
  - El token vive en `localStorage`: sobrevive a recargar y es inmune a CSRF, pero un
    XSS lo dejaría al alcance.
  - Los tickets del WebSocket y los límites de ritmo viven en la memoria del proceso:
    con varias instancias harían falta en un sitio compartido (Redis).
  - Un tablero no cambia de dueño ni se puede borrar desde la interfaz, y si la cuenta
    dueña desaparece el tablero se queda sin dueño (y público, si lo era).
  - Los tableros no tienen nombre; la lista de recientes de quien no tiene cuenta vive
    solo en el navegador.
- **Planes gratuitos de Render:** el servicio web se duerme tras un rato sin tráfico (la
  primera conexión puede tardar cerca de un minuto; el cliente reintenta solo) y la base
  PostgreSQL gratuita tiene fecha de vencimiento (revisa la política vigente de Render).
- **Detalles de interacción:** el arrastre no desplaza la vista al llegar al borde, el
  orden de apilamiento es el de creación y en algunos táctiles el doble toque no crea
  notas (para eso está el botón).
- **Cliente y servidor se despliegan juntos:** el protocolo cambió en la Etapa 4 y un
  cliente anterior a ella no funciona con el servidor nuevo. (La Etapa 5 no tocó el
  protocolo: deshacer es del cliente.)
- Si el entorno ya define `PORT`, el servidor usa ese puerto también en desarrollo.

## Despliegue

Orden: base de datos y servidor en Render, luego el cliente en Vercel, y por último
`ALLOWED_ORIGINS` con el dominio final del cliente.

### Base de datos en Render (PostgreSQL)

1. **New → Postgres.** Elige la misma región que usarás para el servidor.
2. Cuando esté lista, copia la **Internal Database URL** (la interna no sale a internet
   y no necesita configurar SSL).

### Servidor en Render (Web Service)

1. **New → Web Service** y conecta el repositorio.
2. **Root Directory:** vacío (la raíz del repo), porque el servidor necesita `shared/`.
3. **Runtime:** Node. **Build Command:** `npm ci`. **Start Command:** `npm start`.
4. **Health Check Path:** `/health`.
5. **Variables de entorno:**
   - `DATABASE_URL`: la Internal Database URL del paso anterior. Las migraciones se
     aplican solas al arrancar; si la base no responde, el servidor no arranca (mejor
     eso que funcionar sin guardar nada).
   - `ALLOWED_ORIGINS=https://tu-app.vercel.app` (sin barra final; separa varios
     orígenes con comas si quieres permitir también las previews). Vale para el
     WebSocket y para el CORS de la API de cuentas.
   - `PORT` lo define Render automáticamente. La versión de Node sale del campo
     `engines` de `package.json` (o fíjala con `NODE_VERSION`).
6. La URL pública será algo como `https://pizarra-server.onrender.com`. Comprueba
   `/health`: debe responder `"storage":"postgres"`.

### Cliente en Vercel

1. **Add New → Project** e importa el repositorio.
2. **Root Directory:** `client`. Vercel detecta Vite (build `npm run build`, salida
   `dist`). Deja activada la opción de incluir archivos fuera del directorio raíz: el
   cliente importa `shared/`. `npm install` desde `client/` detecta el workspace e
   instala desde la raíz.
3. **Variables de entorno:** `VITE_WS_URL=wss://pizarra-server.onrender.com` (la URL
   base, sin `/rooms`). Vite la incrusta al compilar: si cambia, hay que volver a desplegar.
4. `client/vercel.json` reescribe cualquier ruta a `index.html`, para que los enlaces
   `/tablero/…` funcionen al abrirlos directamente.
5. Copia el dominio final (p. ej. `https://tu-app.vercel.app`) en `ALLOWED_ORIGINS`
   de Render.

## Hoja de ruta

1. ✅ MVP en tiempo real
2. ✅ Salas con URL propia y persistencia en PostgreSQL
3. ✅ Presencia: cursores en vivo con nombre y color
4. ✅ Conflictos y robustez: migración a CRDTs (Yjs) y edición sin conexión
5. ✅ Deshacer y rehacer por usuario
6. ✅ Inicio de sesión, permisos y pruebas
7. ✅ Caso de estudio
