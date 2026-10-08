import { useEffect } from 'react';
import { createRoomId } from '@pizarra/shared';
import { Link } from '../components/Link';
import { ArrowRightIcon } from '../components/Icons';
import { boardPath, navigate } from '../lib/router';

/** Cifras del proyecto, en notas de papel. */
const NUMBERS = [
  { value: '7', label: 'etapas, cada una usable', color: 'yellow', rotation: -3 },
  { value: '146', label: 'pruebas automáticas', color: 'green', rotation: 2 },
  { value: '10', label: 'dependencias de producción', color: 'blue', rotation: -2 },
  { value: '0', label: 'frameworks en el servidor', color: 'pink', rotation: 3 },
] as const;

const PROBLEMS = [
  {
    title: 'Tiempo real de verdad',
    text: 'Arrastrar una nota genera veinte mensajes por segundo. En las demás pantallas eso tiene que verse fluido, no a saltos.',
  },
  {
    title: 'Conflictos',
    text: 'Dos personas escriben en la misma nota a la vez: el texto se fusiona carácter a carácter y el cursor de cada una se queda donde estaba.',
  },
  {
    title: 'Sin conexión',
    text: 'Si se corta el wifi se sigue editando: los cambios quedan en el dispositivo, sobreviven a recargar y se sincronizan al volver.',
  },
  {
    title: 'Quién puede qué',
    text: 'El enlace es lo que hace útil una pizarra, pero no siempre quieres que cualquiera escriba. Las cuentas son opcionales; los permisos, del servidor.',
  },
];

const DECISIONS = [
  {
    title: 'Protocolo propio, no y-websocket',
    text: 'Cuando llegaron los CRDTs ya existían las salas, la presencia y la validación: faltaba el modelo de datos, no el transporte. Los updates de Yjs viajan en base64 dentro del mismo JSON que el resto.',
    cost: 'Un 33 % más de tamaño, a cambio de un solo camino de entrada que pasa por la misma validación y las mismas pruebas.',
  },
  {
    title: 'Validar en una copia y rechazar',
    text: 'Un update de CRDT no se puede deshacer. Cada cambio se aplica primero a una copia de prueba del documento; si el resultado no es válido, se descarta la copia y se le pide al cliente que se resincronice.',
    cost: 'Se valida el documento entero en cada update. A cambio, el documento aceptado nunca pasa por un estado inválido.',
  },
  {
    title: 'Local-first',
    text: 'El documento vive en IndexedDB y la conexión se abre recién cuando la copia local terminó de cargar, para que el primer intercambio ya lleve lo editado sin conexión.',
    cost: 'Los límites del servidor tienen que ser más holgados que los de la interfaz, porque al fusionar lo de varias personas se suma.',
  },
  {
    title: 'Un ticket para abrir el socket',
    text: 'El navegador no deja poner cabeceras al abrir un WebSocket, así que la identidad va en la URL: un ticket de un solo uso que dura treinta segundos, no el token de sesión.',
    cost: 'Una petición más antes de conectar. A cambio, el token no sale nunca de la cabecera Authorization.',
  },
];

const BUGS = [
  {
    title: 'El socket zombi',
    text: 'Maté el servidor para ver la reconexión y una pestaña se quedó mostrando «En vivo» sin recibir nada. El ping del protocolo lo responde el navegador solo y desde JavaScript no se ve: un socket mudo es indistinguible de uno sano en silencio. Ahora el servidor manda una señal de vida y el cliente reconecta si deja de llegar.',
  },
  {
    title: 'Deshacer que borraba la nota',
    text: 'Mover una nota, que otra persona la moviera después y pulsar Ctrl+Z hacía desaparecer la nota entera: Yjs descarta en silencio el paso que ya no puede aplicar y deshace el anterior, que era la creación.',
  },
  {
    title: 'El cursor que saltaba al final',
    text: 'Al deshacer desde el botón, el texto volvía pero el cursor se iba al final. Enfocar el textarea dispara onFocus, que recordaba como posición el final del texto, antes de que se restaurara la buena.',
  },
];

export function CaseStudyPage() {
  useEffect(() => {
    document.title = 'Cómo está hecha · Pizarra';
  }, []);

  const createBoard = () => {
    navigate(boardPath(createRoomId((bytes) => crypto.getRandomValues(bytes))));
  };

  return (
    <main className="case">
      <header className="case__hero">
        <Link to="/" className="home__brand" aria-label="Pizarra: ir al inicio">
          <span className="brand__mark" aria-hidden="true" />
          Pizarra
        </Link>
        <h1 className="case__title">Cómo está hecha esta pizarra</h1>
        <p className="case__lead">
          Un proyecto para tener a mano las decisiones difíciles de una app colaborativa: cómo se sincroniza, qué pasa
          cuando dos personas tocan lo mismo, qué pasa sin conexión y qué se rompe cuando algo falla de verdad.
        </p>
        <div className="home__actions">
          <button type="button" className="button button--primary button--large" onClick={createBoard}>
            Probar la pizarra
            <ArrowRightIcon />
          </button>
        </div>
      </header>

      <figure className="case__figure case__figure--hero">
        <img
          src="/caso/tablero.svg"
          alt="Un tablero con tres notas inclinadas, los cursores de dos personas con su nombre y la barra flotante con el estado En vivo."
          width={800}
          height={450}
        />
      </figure>

      <ul className="case__numbers" aria-label="El proyecto en números">
        {NUMBERS.map((item) => (
          <li
            key={item.label}
            className={`case__number note--${item.color}`}
            style={{ rotate: `${item.rotation}deg` }}
          >
            <strong className="case__number-value">{item.value}</strong>
            <span className="case__number-label">{item.label}</span>
          </li>
        ))}
      </ul>

      <section className="case__section" aria-labelledby="que-resuelve">
        <h2 id="que-resuelve" className="case__heading">
          Qué resuelve
        </h2>
        <p className="case__text">
          Una pizarra compartida obliga a responder preguntas que un CRUD no hace. Estas cuatro marcaron todo el
          diseño:
        </p>
        <ul className="case__grid">
          {PROBLEMS.map((item) => (
            <li key={item.title} className="case__card">
              <h3 className="case__card-title">{item.title}</h3>
              <p className="case__card-text">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="case__section" aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="case__heading">
          Cómo funciona
        </h2>
        <p className="case__text">
          Cada sala es un documento <strong>Yjs</strong>: un mapa de notas donde el texto se fusiona carácter a
          carácter y el resto de los campos se resuelven con la última escritura, que es lo que se espera al mover una
          nota. El cliente guarda su copia en IndexedDB y manda los cambios agrupados, como mucho cada 50 ms.
        </p>
        <p className="case__text">
          El servidor no confía en nada: valida la forma de cada mensaje a mano y el contenido de cada update en una
          copia de prueba del documento. Mientras una sala está abierta, la memoria es la fuente de verdad y el estado
          completo se guarda en lote, como mucho un segundo después del último cambio: un arrastre entero termina
          siendo una o dos escrituras en PostgreSQL.
        </p>
        <figure className="case__figure">
          <img
            src="/caso/arquitectura.svg"
            alt="El navegador guarda una copia del documento en IndexedDB y habla con el servidor por HTTP y WebSocket; el servidor valida, reenvía y guarda en PostgreSQL."
            width={800}
            height={380}
            loading="lazy"
          />
          <figcaption>
            El paquete compartido define el documento, el protocolo y los límites: cliente y servidor compilan con lo
            mismo, así que cambiar un mensaje rompe los dos lados a la vez.
          </figcaption>
        </figure>
      </section>

      <section className="case__section" aria-labelledby="decisiones">
        <h2 id="decisiones" className="case__heading">
          Cuatro decisiones y lo que costaron
        </h2>
        <ul className="case__list">
          {DECISIONS.map((item) => (
            <li key={item.title} className="case__item">
              <h3 className="case__item-title">{item.title}</h3>
              <p className="case__card-text">{item.text}</p>
              <p className="case__cost">
                <strong>El precio:</strong> {item.cost}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="case__section" aria-labelledby="se-rompio">
        <h2 id="se-rompio" className="case__heading">
          Lo que se rompió
        </h2>
        <p className="case__text">
          Ninguno de estos lo habría encontrado el compilador. Casi todos aparecieron probando a mano, con dos
          pestañas y el servidor a medio morir.
        </p>
        <ul className="case__list">
          {BUGS.map((item) => (
            <li key={item.title} className="case__item case__item--bug">
              <h3 className="case__item-title">{item.title}</h3>
              <p className="case__card-text">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="case__section" aria-labelledby="pruebas">
        <h2 id="pruebas" className="case__heading">
          Cómo lo probé
        </h2>
        <p className="case__text">
          Las pruebas del servidor lo levantan de verdad en un puerto libre y conectan clientes WebSocket reales, cada
          uno con su documento Yjs, que se desconectan, editan y vuelven. Corren contra PostgreSQL compilado a WASM
          (sin instalar nada) y también contra un PostgreSQL real, en un esquema temporal propio.
        </p>
        <p className="case__text">
          Para saber si las pruebas servían, rompí el código a propósito: quitar una opción de deshacer rompe su
          prueba, tratar lo que llega del servidor como propio rompe tres, y espaciar las escrituras de un arrastre
          convierte «dos escrituras» en veinte. Las del cliente, con Vitest y jsdom, prueban lo que se ve y se puede
          hacer; la primera que escribí encontró un error real.
        </p>
      </section>

      <section className="case__section" aria-labelledby="fuera">
        <h2 id="fuera" className="case__heading">
          Lo que dejé fuera, a propósito
        </h2>
        <p className="case__text">
          Un solo proceso de servidor (escalar pediría enrutar por sala o un bus compartido), sin compactación del
          documento, sin verificación de correo ni recuperación de contraseña, y sin cursores en pantallas táctiles,
          donde no hay puntero que mostrar. Están todas anotadas, con su motivo, en las limitaciones del README.
        </p>
      </section>

      <footer className="case__foot">
        <p className="case__text">
          El código, el protocolo y el detalle de cada decisión están en el repositorio. La pizarra se usa sin cuenta:
          crea un tablero y comparte el enlace.
        </p>
        <div className="home__actions">
          <button type="button" className="button button--primary button--large" onClick={createBoard}>
            Crear un tablero
          </button>
          <Link to="/" className="button button--ghost button--large">
            Ir al inicio
          </Link>
        </div>
      </footer>
    </main>
  );
}
