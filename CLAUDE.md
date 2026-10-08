# CLAUDE.md

Contexto para trabajar en este repositorio.

## Proyecto

Pizarra colaborativa en tiempo real (tipo Miro simplificado) con notas adhesivas que
varias personas crean, mueven y editan a la vez, viendo los cursores de las demás con
nombre y color. Cada tablero (sala) tiene su URL (`/tablero/<id>`), se puede editar sin
conexión, cada quien puede deshacer sus propios cambios y todo se guarda en PostgreSQL.
Las cuentas son opcionales: sin cuenta se entra a un tablero público con su enlace; con
cuenta, el tablero es de quien lo creó y decide quién entra. Es un proyecto de portafolio
que se construye en 7 etapas; el README explica la arquitectura y las decisiones de cada una.

## Stack

- Monorepo con npm workspaces y TypeScript estricto (`tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, etc.). TypeScript 7.
- `shared/`: esquema del documento Yjs (`doc.ts`), deshacer (`undo.ts`), protocolo de
  mensajes, cuentas y permisos (`accounts.ts`), constantes, normalización, ids de sala y
  presencia. Se consume como TypeScript fuente (`exports` apunta a `src/index.ts`), sin build.
- **Datos: un `Y.Doc` (Yjs) por sala.** El texto de cada nota es `Y.Text` (se fusiona
  carácter a carácter); el resto de los campos son valores de su `Y.Map` (última
  escritura gana).
- `server/`: Node.js + `ws` (sin Socket.IO) sobre `http`, con `/health` y una API JSON
  propia para cuentas y permisos (`src/http/`, `src/accounts/`). PostgreSQL con `pg`
  (sin ORM) y migraciones SQL propias. Corre con `tsx` en desarrollo y en producción.
- `client/`: React 19 + Vite 8, local-first (copia del documento en IndexedDB con
  `y-indexeddb`), con un router propio sobre la History API. Fuentes con `@fontsource`
  (Instrument Sans en la interfaz, Patrick Hand en las notas).

## Comandos

```bash
npm run dev         # servidor :8080 + cliente :5173 (concurrently)
npm run typecheck   # tsc en los tres paquetes
npm run build       # typecheck + vite build
npm test            # todas: servidor (node:test vía tsx, con PGlite) y cliente (Vitest)
npm test -w server  # solo el servidor; -w client, solo el cliente
TEST_DATABASE_URL=postgres://… npm test   # las mismas pruebas contra un PostgreSQL real
docker compose up -d                      # PostgreSQL local en el puerto 5434
```

Antes de dar un cambio por terminado: `npm run typecheck`, `npm test` y `npm run build`.

## Convenciones

- **Idioma:** identificadores en inglés; interfaz, comentarios, mensajes de error,
  logs y documentación en español.
- **Protocolo:** todo cambio empieza en `shared/src/protocol.ts`. El servidor tiene un
  validador por tipo de mensaje (tipo mapeado en `validation.ts`) y el cliente un
  `switch` exhaustivo con `never` en `useBoard`: ambos dejan de compilar si falta un caso.
- **Cuentas y permisos (Etapa 6):**
  - Son opcionales y **necesitan PostgreSQL**: sin `DATABASE_URL`, `accounts` es null,
    la API responde 503 y todo funciona como en la Etapa 5.
  - `Accounts` (`accounts/service.ts`) es el único lugar que decide quién puede qué;
    `accessFor(roomId, user)` devuelve el `RoomAccess` o null (ni mirar).
  - Un tablero pasa a tener dueño cuando alguien con cuenta escribe en él: el servidor
    lo guarda en ese momento (`claimRoom` en `server.ts`) y avisa con `access`.
  - El WebSocket se abre con un **ticket** de un solo uso (`?ticket=`), no con el token.
    La sesión va en `Authorization: Bearer` en la API HTTP.
  - Los permisos se resuelven en el handshake y viajan en `init.access`; cambiarlos
    (visibilidad o invitaciones) vuelve a resolverlos para las conexiones abiertas
    (`refreshAccess`): `access` a quien cambia de rol, cierre 4003 a quien ya no entra.
  - Con cuenta, el nombre de presencia lo pone el servidor y `presence:rename` se rechaza.
- **El servidor no confía en el cliente, en dos capas:**
  - la forma de los mensajes, en `server/src/validation.ts` (escrita a mano, sin
    librerías), que lee cada campo con `Object.hasOwn` y construye objetos nuevos;
  - el contenido de un `doc:update`, en `validateBoardDoc` (`shared/src/doc.ts`): el
    update se aplica primero a la **copia de prueba** de `Room` y solo se acepta si el
    documento resultante es válido. Si no, se reconstruye la copia, se responde `error`
    y se cierra con `RESET_CLOSE_CODE` para que el cliente se resincronice.
- **Normalización compartida:** posiciones, inclinación, cursores, nombres y texto pasan
  por las funciones de `shared` (`clampNotePosition`, `clampRotation`, `clampCursor`,
  `normalizeName`, `sanitizeText`) en cliente y servidor.
- **Tiempo real:** el servidor reenvía cada update a los demás clientes **de la misma
  sala** y nunca al emisor. `init` trae el documento completo; el cliente lo fusiona y
  responde con lo que el servidor no tenía.
- **Salas y persistencia:**
  - `RoomManager` abre la sala en el `upgrade` (una sola carga aunque entren varias
    personas) y la descarga cuando queda vacía. Cada `acquire` necesita su `release`.
  - La memoria es la fuente de verdad. `Room.applyUpdate` valida y aplica; `Room.flush`
    guarda el estado completo del documento en lote (como mucho `flushDelayMs` después).
  - El almacén guarda bytes (`StoredRoom.state`). Las salas de la Etapa 2 (filas en
    `notes`) se convierten al cargarlas (`migrated: true`) y sus filas se borran al
    guardarse.
  - El almacén es la interfaz `RoomStore` (`store/postgres.ts`, `store/memory.ts`). Un
    fallo al guardar nunca descarta cambios: se reintenta.
- **Presencia (efímera, nunca se guarda):**
  - La identidad viaja en la URL del WebSocket (`?name=&color=`); la lee `parseIdentity`
    en `validation.ts`. El color lo asigna `server/src/presence.ts` (el preferido si está
    libre en la sala).
  - `Room.clients` es un `Map<WebSocket, PeerPresence>` que recuerda el último cursor y
    foco de cada persona para el `init` de quien entre después.
  - En el cliente, los cursores viven en `lib/cursorStore.ts` (fuera del estado de
    React) y solo los lee `<Cursors>`. `Board` está memorizado: no pasar props que
    cambien con cada movimiento de cursor.
  - Nombres y cursores se normalizan con `normalizeName` y `clampCursor` de `shared`.
- **Límites de ritmo:** `rate-limit.ts` (cubo de fichas) para los intentos de entrar
  por IP y para los mensajes por conexión. Cortar una conexión es seguro: al reconectar
  se sincroniza.
- **Migraciones:** archivos `server/src/db/migrations/NNN_nombre.sql`, que se aplican
  en orden al arrancar. Nunca editar una migración ya aplicada: agregar una nueva.
- **Cliente:** el documento, el socket y la copia local viven en
  `client/src/hooks/useBoard.ts`; los componentes no tocan ni el socket ni Yjs, solo sus
  callbacks. Las transacciones locales van con el origen `LOCAL` (son las únicas que se
  envían) y lo que llega del servidor, con `REMOTE`. El arrastre está en `useDrag`
  (pointer events + pointer capture) y se ve al instante con posiciones locales que
  ganan a las del documento. Los callbacks que reciben las notas deben ser estables (las
  notas usan `memo`). Las pantallas están en `client/src/pages/` y se navega con
  `navigate` o `<Link>` de `lib/router.ts`.
- **Caso de estudio:** la versión larga está en `CASO-DE-ESTUDIO.md` y la corta en la
  página `/caso` (`pages/CaseStudyPage.tsx`). Las ilustraciones son SVG escritos a mano
  en `client/public/caso/`, que usan los dos (el markdown por ruta relativa). Las cifras
  del proyecto (pruebas, dependencias) aparecen en ambos: si cambian, actualizar los dos.
- **Cursor de texto:** se guarda como posición relativa de Yjs (`rememberCaret`) y se
  restaura tras cada cambio remoto (`resolveCaret`), para que no salte al final. Al
  enfocar una nota por código, resolverlo **antes** de `focus()`: enfocar el textarea
  dispara `onFocus`, que recuerda como cursor el final del texto.
- **Deshacer y rehacer (`shared/src/undo.ts`, solo en el cliente):**
  - El gestor sigue únicamente las transacciones `LOCAL`; las suyas llevan su propio
    origen y `useBoard` también las trata como locales (si no, no se enviarían).
  - `beginStep(clave)` decide dónde empieza un paso: misma clave, mismo paso; `null`,
    paso suelto (crear, color, borrar). Con `gesture` el paso no se corta por tiempo,
    para que un arrastre entero sea uno solo.
  - Cada paso guarda en su `meta` dónde estaba el cursor de texto; al sacarlo, `undo()`
    devuelve la nota que hay que enfocar y `BoardPage` la pasa como `focusId`.
  - Los atajos viven en `useUndoShortcuts`; dentro de una nota se toma `Ctrl+Z` (el
    textarea es un reflejo del documento), en los demás campos se deja el del navegador
    (`data-board-text` distingue unos de otros).
- **Estilos:** CSS plano en `client/src/styles.css` con tokens en `:root`. Las medidas
  de la nota vienen de `shared` como variables CSS. Mantener foco visible,
  `aria-label` en botones de ícono, `prefers-reduced-motion` y `(hover: none)`.
- **Pruebas del cliente:** Vitest + jsdom + Testing Library, en `client/test/`
  (`npm test -w client`). Probar lo que se ve y se puede hacer, no los detalles; la API
  se sustituye con `vi.mock('../src/lib/api')`. Sin `globals`, la limpieza entre casos
  la hace `test/setup.ts`.
- **Pruebas del servidor:**
  - Las que necesitan cuentas usan `startServerWithAccounts({ db })` con una base
    compartida por archivo (`createTestDatabase()` + `migrate` en `before`, `resetData`
    en `afterEach`): levantar PGlite en cada prueba cuesta segundos. `signUp(api)` crea
    una cuenta y `roomUrlAs(roomId, token)` arma la URL del socket con su ticket.
  - Las de integración levantan el servidor con `createBoardServer({ port: 0 })` y usan
    `TestClient` (mensajes crudos) o `YClient` (documento Yjs que sincroniza como el
    cliente real, con `change`, `receive`, `disconnect` y `connect` para probar sin
    conexión) de `server/test/helpers.ts`. `roomUrl(roomId, { name, color })` arma la
    URL con identidad; `PEER_EVENTS` y `DOC_EVENTS` sirven para comprobar que algo no llegó.
  - Las de persistencia usan `createTestDatabase()` (PGlite, o `TEST_DATABASE_URL` en
    un esquema temporal propio), `FlakyStore` para simular caídas de la base y
    `FAST_TIMINGS`.
- **Caracteres de control en el código:** no escribir secuencias `\uXXXX` al crear o
  editar archivos, porque terminan como bytes crudos. Usar comparaciones numéricas
  (como `isControlChar` en `shared/src/presence.ts`) y, tras tocar esas regex, escanear
  los fuentes buscando códigos < 0x20 (salvo tab/LF/CR) y 0x7F–0x9F.
- **Git:** el usuario hace los commits. No crear commits por tu cuenta; al terminar una
  tarea puedes sugerir cómo dividir los cambios.

## Hoja de ruta

1. [x] MVP en tiempo real
2. [x] Salas con URL propia y persistencia en PostgreSQL
3. [x] Presencia: cursores en vivo con nombre y color
4. [x] Conflictos y robustez: migración a CRDTs (Yjs) y edición sin conexión
5. [x] Deshacer y rehacer por usuario
6. [x] Inicio de sesión, permisos y pruebas
7. [x] Caso de estudio

## Notas

- Sin `DATABASE_URL` el servidor usa `MemoryStore` y lo avisa al arrancar; `/health`
  informa `storage: "memory" | "postgres"` y `accounts: true | false`.
- Los tickets del WebSocket y los límites de ritmo viven en la memoria del proceso (un
  solo proceso por sala, como el resto del diseño).
- Los ids de sala (12 caracteres `[a-z0-9]`) los genera el cliente; la sala se guarda en
  la base recién con su primera nota. Un solo proceso de servidor por sala.
- Sin conexión se sigue editando: los cambios quedan en IndexedDB y se envían al
  reconectar. El tablero solo es de solo lectura hasta que carga la copia local (`ready`).
- El historial de deshacer es de la pestaña y de la sesión: no se guarda ni viaja al
  servidor, que solo ve el update resultante. La Etapa 5 no tocó el protocolo.
- `MAX_PAYLOAD_BYTES` (2 MiB) es alto por la sincronización tras editar sin conexión;
  el resto de los mensajes se limitan a `MAX_MESSAGE_BYTES` (16 KB) en `validation.ts`.
- El servidor manda `heartbeat` cada `HEARTBEAT_INTERVAL_MS` y el cliente reconecta si
  pasa `HEARTBEAT_TIMEOUT_MS` sin recibir nada (socket abierto pero mudo).
- Algunas herramientas definen `PORT` en el entorno. El servidor lo respeta (Render lo
  necesita), así que en desarrollo puede terminar escuchando en otro puerto.
- En la máquina de desarrollo hay otros Postgres que no son de este proyecto: un
  PostgreSQL 17 instalado como servicio en el 5432 y el contenedor `reservas-api-db-1`
  (otro proyecto) en el 5433. No tocarlos. Por eso el `docker-compose.yml` usa el 5434
  (configurable con `PIZARRA_DB_PORT`); `server/.env` apunta ahí.
- Despliegue: Postgres y servidor en Render (Web Service desde la raíz del repo,
  `npm ci` y `npm start`, `DATABASE_URL` interna) y cliente en Vercel (directorio raíz
  `client`, con `vercel.json` para las rutas). Detalles en el README.
