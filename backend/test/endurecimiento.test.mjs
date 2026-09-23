// Lo basico que faltaba: no contar de mas en los errores, no dejar la API
// abierta a cualquier sitio, y no regalar intentos de contrasena.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';
// La lista blanca se lee al cargar el modulo, asi que va antes del import.
process.env.CORS_ORIGINS = 'https://app.aseada.cl, https://aseada.cl';

const servidor = (await import('../server.js')).default;
const { usarPool, reiniciarLimiteIntentos, INTENTOS_MAX } = servidor;
const { default: jwt } = await import('jsonwebtoken');

const silencio = () => {};

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

async function baseConCliente() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  reiniciarLimiteIntentos();
  const { rows: [u] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id");
  return { db, id: u.id, sesion: jwt.sign({ id: u.id, email: 'c@t.cl', rol: 'cliente' }, process.env.JWT_SECRET) };
}

/** Corre fn con console.error callado: hay pruebas que provocan errores a proposito. */
async function sinRuido(fn) {
  const original = console.error;
  console.error = silencio;
  try { return await fn(); } finally { console.error = original; }
}

// ─── M2: los 500 no cuentan como es la base por dentro ──────────────────────

test('un error de la base no le llega al cliente con el detalle de Postgres', async () => {
  const e = await baseConCliente();
  // Una base que falla como falla Postgres de verdad: con el nombre del
  // indice, el de la columna y el valor que iba en la consulta.
  const detalle = 'duplicate key value violates unique constraint "idx_usuarios_email_unico" DETAIL: Key (lower(email))=(c@t.cl) already exists.';
  usarPool({ query: async () => { throw Object.assign(new Error(detalle), { code: '23505' }); } });

  await sinRuido(() => conServidor(async (base) => {
    const res = await fetch(`${base}/api/notificaciones`, { headers: { Authorization: `Bearer ${e.sesion}` } });
    assert.equal(res.status, 500);
    const cuerpo = JSON.stringify(await res.json());
    assert.doesNotMatch(cuerpo, /constraint|idx_|lower\(email\)|DETAIL|duplicate key/i,
      `el 500 filtro detalle de la base: ${cuerpo}`);
    assert.match(cuerpo, /Intenta de nuevo/i, 'pero si deberia decirle que reintente');
  }));
});

test('los 400 y 403 deliberados siguen explicando que pasa', async () => {
  const e = await baseConCliente();
  await conServidor(async (base) => {
    // Un 400 con mensaje util para quien esta del otro lado: no se toca.
    const cotizacion = await fetch(`${base}/api/calcular-precio`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metros: 0 })
    });
    assert.equal(cotizacion.status, 400);
    assert.match((await cotizacion.json()).error, /metros/i);

    // Y un 403 de permisos tambien.
    const prohibido = await fetch(`${base}/api/admin/reclamos`, { headers: { Authorization: `Bearer ${e.sesion}` } });
    assert.equal(prohibido.status, 403);
    assert.match((await prohibido.json()).error, /permiso/i);
  });
});

// ─── M3: cabeceras, CORS, intentos y contrasenas ────────────────────────────

test('el servidor no anuncia con que framework esta hecho', async () => {
  await baseConCliente();
  await conServidor(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

test('CORS solo deja pasar a los origenes de la lista blanca', async () => {
  await baseConCliente();
  await conServidor(async (base) => {
    const permitido = await fetch(`${base}/`, { headers: { Origin: 'https://app.aseada.cl' } });
    assert.equal(permitido.headers.get('access-control-allow-origin'), 'https://app.aseada.cl');

    const ajeno = await fetch(`${base}/`, { headers: { Origin: 'https://sitio-cualquiera.cl' } });
    assert.equal(ajeno.headers.get('access-control-allow-origin'), null,
      'un sitio fuera de la lista no deberia recibir permiso');

    // Sin Origin no hay peticion cruzada de navegador: es la app movil, curl,
    // o el aviso de pago de Flow. Esa tiene que seguir funcionando.
    assert.equal((await fetch(`${base}/`)).status, 200);
  });
});

test('el login corta despues de demasiados intentos desde la misma IP', async () => {
  const e = await baseConCliente();
  await conServidor(async (base) => {
    const intentar = () => fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'c@t.cl', password: 'la-que-no-es' })
    });

    for (let i = 0; i < INTENTOS_MAX; i++) {
      assert.equal((await intentar()).status, 400, `el intento ${i + 1} todavia deberia contestar credenciales`);
    }
    const cortado = await intentar();
    assert.equal(cortado.status, 429, 'el que pasa del limite se corta');
    assert.match((await cortado.json()).error, /intentos/i);

    // El registro comparte el limitador: son la misma puerta.
    const registro = await fetch(`${base}/auth/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'X', email: 'x@t.cl', password: 'clave-larga-123', rol: 'cliente' })
    });
    assert.equal(registro.status, 429);
  });
});

test('una contrasena corta se rechaza diciendo cuanto falta', async () => {
  await baseConCliente();
  await conServidor(async (base) => {
    const registrar = (password) => fetch(`${base}/auth/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'X', email: `p${password.length}@t.cl`, password, rol: 'cliente' })
    });

    for (const password of ['1234', 'corta12']) {
      const res = await registrar(password);
      assert.equal(res.status, 400, `"${password}" deberia rechazarse`);
      assert.match((await res.json()).error, /8 caracteres/);
    }
    assert.equal((await registrar('ochoocho')).status, 200, 'con 8 ya pasa');
  });
});

test('el token dice si la cuenta esta activa, y se avisa que no hay revocacion', async () => {
  const e = await baseConCliente();
  await conServidor(async (base) => {
    const res = await fetch(`${base}/auth/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Aseador', email: 'w@t.cl', password: 'clave-larga-123', rol: 'worker' })
    });
    const { token } = await res.json();
    const payload = jwt.decode(token);
    assert.equal(payload.activo, false, 'el aseador nuevo viaja marcado como inactivo');
    assert.equal(payload.rol, 'worker');
    // 7 dias, tal como estaba: lo que cambia es que ahora esta documentado que
    // no hay forma de revocarlo antes de que expire.
    assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
  });
});

// ─── La conexion a la base ───────────────────────────────────────────────────
// Los scripts de migracion y de alta de admin corren contra produccion (asi lo
// dice el README) y llevaban `rejectUnauthorized: false` escrito a mano: iban
// SIN verificar el certificado siempre, justo al reves de lo que documenta
// .env.example y de lo que hace el servidor. Con la DATABASE_URL de Neon y el
// hash de la contrasena de un admin viajando ahi adentro.
test('el servidor y los scripts deciden el TLS de Postgres con la misma regla', async () => {
  const { sslPostgres } = await import('../ssl-postgres.js');
  assert.deepEqual(sslPostgres({}), { rejectUnauthorized: true },
    'por defecto se verifica el certificado del servidor');
  assert.deepEqual(sslPostgres({ DB_SSL_NO_VERIFY: 'true' }), { rejectUnauthorized: false },
    'la marcha atras documentada en .env.example tiene que seguir funcionando');

  const { readFileSync } = await import('node:fs');
  for (const archivo of ['server.js', 'scripts/migrar.mjs', 'scripts/hacer-admin.mjs']) {
    const fuente = readFileSync(new URL(`../${archivo}`, import.meta.url), 'utf8');
    assert.doesNotMatch(fuente, /rejectUnauthorized:\s*false/,
      `${archivo} no puede decidir el TLS por su cuenta: eso vive en ssl-postgres.js`);
    assert.match(fuente, /sslPostgres/, `${archivo} tiene que usar la regla compartida`);
  }
});
