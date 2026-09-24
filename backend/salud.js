// Estado real del servicio, para poder verificar un deploy sin conectarse a la
// base de produccion con la contraseña en la mano.
//
// Antes la raiz devolvia {"mensaje":"Aseada API funcionando","version":"3.0.0"}.
// Eso es texto fijo: responde exactamente igual con Neon caido, con las
// migraciones sin aplicar o con el codigo de hace cuatro meses. Un 200 ahi no
// prueba nada, y el 24-09-2026 hubo que entrar a la base a mano solo para
// saber si el deploy habia quedado completo.
//
// Esto responde las cuatro preguntas que importan despues de un push:
//   1. que commit esta vivo (para comparar contra el que acabas de pushear);
//   2. si la base contesta;
//   3. si el esquema esta al dia con el codigo que acaba de entrar —el caso
//      peligroso es codigo nuevo contra base vieja, que pasa desapercibido
//      hasta que alguien paga;
//   4. que quedo sin configurar en el ambiente.
//
// La funcion recibe la conexion (`db`, cualquier objeto con .query) para poder
// probarla contra PostgreSQL real sin levantar el servidor.

const { readdirSync } = require('node:fs');
const { join } = require('node:path');

const CARPETA_MIGRACIONES = join(__dirname, 'migrations');

// Si la base no contesta en este plazo, el deploy esta roto para cualquier
// efecto practico: mejor decirlo que dejar la peticion colgada.
const ESPERA_MAXIMA_MS = 5000;

/**
 * Los .sql que el repositorio espera tener aplicados, en orden.
 *
 * Devuelve null si no se pueden leer. En Vercel la carpeta migrations/ solo
 * llega al bundle si vercel.json la incluye con includeFiles: si alguien
 * cambia eso, esta funcion falla y el health lo dice en vez de reventar.
 */
function migracionesDelRepo() {
  try {
    return readdirSync(CARPETA_MIGRACIONES).filter((archivo) => archivo.endsWith('.sql')).sort();
  } catch {
    return null;
  }
}

/** Los .sql que la base dice tener aplicados. */
async function migracionesAplicadas(db) {
  const { rows } = await db.query('SELECT archivo FROM _migraciones ORDER BY archivo');
  return rows.map((fila) => fila.archivo);
}

/** Corre una promesa con tope de tiempo, para no colgar la respuesta. */
function conTope(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error(`sin respuesta en ${ms} ms`)), ms).unref?.())
  ]);
}

/**
 * Estado completo del servicio.
 *
 * @param db      conexion a Postgres (pool de pg en produccion, PGlite en las pruebas).
 * @param config  lo que el server ya calculo al arrancar: que falta para Flow,
 *                si CORS quedo restringido, si hay CRON_SECRET y APP_URL.
 * @param entorno process.env, inyectable para poder probarlo.
 * @returns {{ok: boolean, cuerpo: object}} cuerpo es lo que se serializa, ok decide 200 o 503.
 */
async function estado({ db, config = {}, entorno = process.env } = {}) {
  const avisos = [];

  // ── 1. Que codigo esta vivo ───────────────────────────────────────────────
  // Vercel inyecta estas solo en despliegues desde Git. En local no existen y
  // decirlo es mas util que inventar un "desconocido" silencioso.
  const sha = entorno.VERCEL_GIT_COMMIT_SHA || null;
  const commit = {
    sha: sha ? sha.slice(0, 8) : null,
    sha_completo: sha,
    rama: entorno.VERCEL_GIT_COMMIT_REF || null,
    ambiente: entorno.VERCEL_ENV || (entorno.VERCEL ? 'vercel' : 'local')
  };
  if (!sha) avisos.push('No hay SHA de commit: esto no es un despliegue desde Git, o las variables VERCEL_GIT_* no estan disponibles.');

  // ── 2. Si la base contesta ────────────────────────────────────────────────
  const partida = Date.now();
  let baseResponde = false;
  let errorBase = null;
  try {
    await conTope(db.query('SELECT 1'), ESPERA_MAXIMA_MS);
    baseResponde = true;
  } catch (error) {
    errorBase = error.message;
  }
  const base_de_datos = {
    responde: baseResponde,
    latencia_ms: Date.now() - partida,
    ...(errorBase && { error: errorBase })
  };

  // ── 3. Si el esquema esta al dia con el codigo ────────────────────────────
  // El caso que esto existe para atrapar: codigo nuevo desplegado contra una
  // base que todavia no corrio `npm run migrate`. Nada falla al arrancar; falla
  // despues, cuando alguien paga y el INSERT choca con un CHECK que no existe.
  const esperadas = migracionesDelRepo();
  let migraciones;
  if (!baseResponde) {
    migraciones = { al_dia: null, motivo: 'la base no responde' };
  } else if (esperadas === null) {
    migraciones = { al_dia: null, motivo: 'no se pudo leer la carpeta migrations/ del bundle' };
    avisos.push('No se pudo leer migrations/: revisa includeFiles en vercel.json. No se puede comparar el esquema contra el repositorio.');
  } else {
    try {
      const aplicadas = await conTope(migracionesAplicadas(db), ESPERA_MAXIMA_MS);
      const puestas = new Set(aplicadas);
      const pendientes = esperadas.filter((archivo) => !puestas.has(archivo));
      // Al reves tambien importa: una migracion en la base que el repositorio
      // no tiene significa que produccion va ADELANTE del codigo, o sea que
      // este deploy es un rollback y alguien lo va a notar tarde.
      const conjuntoEsperadas = new Set(esperadas);
      const desconocidas = aplicadas.filter((archivo) => !conjuntoEsperadas.has(archivo));
      migraciones = {
        al_dia: pendientes.length === 0,
        aplicadas: aplicadas.length,
        esperadas: esperadas.length,
        pendientes,
        ...(desconocidas.length > 0 && { desconocidas })
      };
      if (desconocidas.length > 0) {
        avisos.push(`La base tiene migraciones que este codigo no conoce (${desconocidas.join(', ')}): parece un rollback del backend.`);
      }
    } catch (error) {
      migraciones = { al_dia: null, motivo: `no se pudo leer _migraciones: ${error.message}` };
    }
  }

  // ── 4. Que falta configurar ───────────────────────────────────────────────
  const faltanFlow = config.faltaParaFlow || [];
  const pagos_flow = { configurado: faltanFlow.length === 0, faltan: faltanFlow };
  if (faltanFlow.length > 0) avisos.push(`Las rutas de pago responden 503: falta ${faltanFlow.join(', ')}.`);

  const configuracion = {
    cors_restringido: Boolean(config.corsRestringido),
    cron_protegido: Boolean(config.cronProtegido),
    app_url_definida: Boolean(config.appUrlDefinida)
  };
  if (!configuracion.cors_restringido) avisos.push('CORS_ORIGINS no esta definida: la API acepta peticiones de cualquier origen.');
  if (!configuracion.cron_protegido) avisos.push('CRON_SECRET no esta definida: el proceso diario que libera pagos no corre.');
  if (!configuracion.app_url_definida) avisos.push('APP_URL no esta definida: despues de pagar, Flow devuelve al cliente a un deep link que en un navegador no abre nada.');

  // `ok` es lo que decide 200 o 503, y solo lo bajan las dos cosas que dejan
  // el servicio roto de verdad. Lo demas son avisos: molesta, no impide operar.
  const ok = baseResponde && migraciones.al_dia !== false;

  return {
    ok,
    cuerpo: {
      ok,
      servicio: 'aseada-backend',
      commit,
      base_de_datos,
      migraciones,
      pagos_flow,
      configuracion,
      avisos
    }
  };
}

module.exports = { estado, migracionesDelRepo, migracionesAplicadas, ESPERA_MAXIMA_MS };
