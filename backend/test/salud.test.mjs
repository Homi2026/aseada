// Que /health diga la verdad, sobre todo cuando algo esta mal.
//
// Esta ruta existe para una situacion concreta: el 24-09-2026 se desplegaron
// cuatro commits a produccion y no habia forma de saber si el deploy habia
// quedado completo sin conectarse a Neon con la contraseña a mano. La raiz
// devolvia "Aseada API funcionando" pasara lo que pasara.
//
// El caso peligroso que esto atrapa es codigo nuevo contra base vieja: nada
// falla al arrancar, y falla despues, cuando alguien paga y el INSERT choca
// con un CHECK que la migracion todavia no creo. Por eso las migraciones
// pendientes bajan el health a 503 y no a un aviso.
//
// Lo que estas pruebas cuidan, en orden de gravedad:
//   1. que un problema real nunca devuelva 200;
//   2. que el SHA que reporta sea el del commit vivo, que es lo unico que
//      permite saber si el deploy entro;
//   3. que lo que solo molesta (CORS abierto, Flow a medias) sea aviso y no
//      tumbe el servicio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const require = createRequire(import.meta.url);
const salud = require('../salud.js');
const servidor = (await import('../server.js')).default;
const { usarPool } = servidor;

const silencio = () => {};

/** Base con todas las migraciones aplicadas, como produccion sana. */
async function baseAlDia() {
  const db = new PGlite();
  await migrar(db, silencio);
  return db;
}

/** Base que responde todo menos lo que se le pida fallar. */
function baseQueFalla(mensaje) {
  return { query: async () => { throw new Error(mensaje); } };
}

const CONFIG_SANA = {
  faltaParaFlow: [],
  corsRestringido: true,
  cronProtegido: true,
  appUrlDefinida: true
};

// ─── 1. Un problema real nunca devuelve 200 ─────────────────────────────────

test('con la base al dia y todo configurado, el servicio esta ok', async () => {
  const db = await baseAlDia();
  const { ok, cuerpo } = await salud.estado({ db, config: CONFIG_SANA, entorno: {} });

  assert.equal(ok, true);
  assert.equal(cuerpo.base_de_datos.responde, true);
  assert.equal(cuerpo.migraciones.al_dia, true);
  assert.deepEqual(cuerpo.migraciones.pendientes, []);
  assert.equal(cuerpo.migraciones.aplicadas, cuerpo.migraciones.esperadas);
});

test('una migracion sin aplicar deja el servicio NO ok y la nombra', async () => {
  const db = await baseAlDia();
  // El escenario exacto del riesgo: el codigo nuevo ya esta arriba y alguien
  // olvido correr `npm run migrate`.
  const ultima = salud.migracionesDelRepo().at(-1);
  await db.query('DELETE FROM _migraciones WHERE archivo=$1', [ultima]);

  const { ok, cuerpo } = await salud.estado({ db, config: CONFIG_SANA, entorno: {} });

  assert.equal(ok, false, 'codigo nuevo contra base vieja no puede devolver 200');
  assert.equal(cuerpo.migraciones.al_dia, false);
  assert.deepEqual(cuerpo.migraciones.pendientes, [ultima]);
});

test('si la base no responde, el servicio esta NO ok y se ve el motivo', async () => {
  const { ok, cuerpo } = await salud.estado({
    db: baseQueFalla('connection refused'),
    config: CONFIG_SANA,
    entorno: {}
  });

  assert.equal(ok, false);
  assert.equal(cuerpo.base_de_datos.responde, false);
  assert.match(cuerpo.base_de_datos.error, /connection refused/);
  // Sin base no se puede saber nada del esquema: decirlo, no adivinar.
  assert.equal(cuerpo.migraciones.al_dia, null);
  assert.match(cuerpo.migraciones.motivo, /no responde/);
});

test('una migracion en la base que el codigo no conoce se avisa como rollback', async () => {
  const db = await baseAlDia();
  await db.query("INSERT INTO _migraciones(archivo) VALUES('999_del_futuro.sql')");

  const { ok, cuerpo } = await salud.estado({ db, config: CONFIG_SANA, entorno: {} });

  // Produccion va adelante del codigo: no impide operar, pero hay que saberlo.
  assert.equal(ok, true);
  assert.deepEqual(cuerpo.migraciones.desconocidas, ['999_del_futuro.sql']);
  assert.ok(cuerpo.avisos.some((a) => /rollback/i.test(a)));
});

// ─── 2. El SHA es lo que permite saber si el deploy entro ───────────────────

test('reporta el commit que Vercel inyecta, cortado y completo', async () => {
  const db = await baseAlDia();
  const sha = '4f183156a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const { cuerpo } = await salud.estado({
    db,
    config: CONFIG_SANA,
    entorno: { VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_COMMIT_REF: 'main', VERCEL_ENV: 'production' }
  });

  assert.equal(cuerpo.commit.sha, '4f183156', 'los 8 primeros, que es como se compara a ojo');
  assert.equal(cuerpo.commit.sha_completo, sha);
  assert.equal(cuerpo.commit.rama, 'main');
  assert.equal(cuerpo.commit.ambiente, 'production');
});

test('sin variables de Vercel lo dice, en vez de inventar un commit', async () => {
  const db = await baseAlDia();
  const { cuerpo } = await salud.estado({ db, config: CONFIG_SANA, entorno: {} });

  assert.equal(cuerpo.commit.sha, null);
  assert.equal(cuerpo.commit.ambiente, 'local');
  assert.ok(cuerpo.avisos.some((a) => /SHA/.test(a)));
});

// ─── 3. Lo que solo molesta es aviso, no caida ──────────────────────────────

test('CORS abierto, Flow a medias y sin cron avisan pero no tumban el servicio', async () => {
  const db = await baseAlDia();
  const { ok, cuerpo } = await salud.estado({
    db,
    config: { faltaParaFlow: ['FLOW_API_KEY'], corsRestringido: false, cronProtegido: false, appUrlDefinida: false },
    entorno: {}
  });

  assert.equal(ok, true, 'se puede operar: son avisos, no una caida');
  assert.equal(cuerpo.pagos_flow.configurado, false);
  assert.deepEqual(cuerpo.pagos_flow.faltan, ['FLOW_API_KEY']);
  assert.equal(cuerpo.configuracion.cors_restringido, false);
  assert.ok(cuerpo.avisos.some((a) => /CORS_ORIGINS/.test(a)));
  assert.ok(cuerpo.avisos.some((a) => /CRON_SECRET/.test(a)));
  assert.ok(cuerpo.avisos.some((a) => /APP_URL/.test(a)));
});

test('no filtra secretos: nombra las variables que faltan, nunca sus valores', async () => {
  const db = await baseAlDia();
  process.env.FLOW_SECRET_KEY = 'no-debe-aparecer-jamas';
  try {
    const { cuerpo } = await salud.estado({ db, config: { faltaParaFlow: ['FLOW_API_KEY'] }, entorno: process.env });
    const texto = JSON.stringify(cuerpo);
    assert.doesNotMatch(texto, /no-debe-aparecer-jamas/);
    assert.doesNotMatch(texto, /postgresql:\/\//, 'la cadena de conexion no puede salir en la respuesta');
    assert.doesNotMatch(texto, /secreto-solo-para-pruebas/, 'el JWT_SECRET tampoco');
  } finally {
    delete process.env.FLOW_SECRET_KEY;
  }
});

// ─── La ruta, de punta a punta ──────────────────────────────────────────────

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

test('GET /health devuelve 200 cuando el servicio esta sano', async () => {
  usarPool(await baseAlDia());
  await conServidor(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.servicio, 'aseada-backend');
    assert.equal(cuerpo.migraciones.al_dia, true);
  });
});

test('GET /health devuelve 503 con una migracion pendiente', async () => {
  const db = await baseAlDia();
  await db.query('DELETE FROM _migraciones WHERE archivo=$1', [salud.migracionesDelRepo().at(-1)]);
  usarPool(db);
  await conServidor(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 503, 'un monitor tiene que poder distinguir esto de un servicio sano');
    assert.equal((await res.json()).ok, false);
  });
});

test('GET /health devuelve 503 y no revienta si la base esta caida', async () => {
  usarPool(baseQueFalla('ECONNREFUSED'));
  await conServidor(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).ok, false);
  });
});

test('la raiz ya no afirma que todo funciona: apunta a /health', async () => {
  usarPool(await baseAlDia());
  await conServidor(async (base) => {
    const cuerpo = await (await fetch(`${base}/`)).json();
    assert.equal(cuerpo.salud, '/health');
    assert.ok(!('mensaje' in cuerpo), 'el texto fijo "Aseada API funcionando" era justamente el problema');
  });
});

// ─── El listado de migraciones del repositorio ──────────────────────────────

test('migracionesDelRepo lee los .sql reales, en orden', () => {
  const archivos = salud.migracionesDelRepo();
  assert.ok(Array.isArray(archivos) && archivos.length > 0);
  assert.ok(archivos.includes('000_schema.sql'));
  assert.deepEqual(archivos, [...archivos].sort(), 'el orden importa: es el de aplicacion');
  assert.ok(archivos.every((a) => a.endsWith('.sql')));
});
