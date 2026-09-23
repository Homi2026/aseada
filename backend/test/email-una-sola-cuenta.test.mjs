// Una persona, una cuenta.
//
// /auth/registro y /auth/login comparaban `email=$1`, y Postgres distingue
// mayusculas en TEXT: c@t.cl y C@T.CL eran dos cuentas. La persona se
// registraba, al dia siguiente escribia su correo de otra forma y "no
// existia"; o se registraba de nuevo y quedaba con dos historiales de
// servicios y de pagos. El indice sobre LOWER(email) existia desde la 000,
// pero no era unico y ninguna consulta lo usaba.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool, reiniciarLimiteIntentos } = servidor;

const silencio = () => {};

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

async function baseLimpia() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  reiniciarLimiteIntentos();
  return db;
}

const post = (base, ruta, cuerpo) => fetch(base + ruta, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
});

const CLAVE = 'clave-larga-123';
const registrar = (base, email) => post(base, '/auth/registro', { nombre: 'Persona', email, password: CLAVE, rol: 'cliente' });
const entrar = (base, email) => post(base, '/auth/login', { email, password: CLAVE });

test('el correo se guarda en minusculas y sin espacios', async () => {
  const db = await baseLimpia();
  await conServidor(async (base) => {
    assert.equal((await registrar(base, '  Matias.Aramayo@Gmail.COM ')).status, 200);
    const { rows } = await db.query('SELECT email FROM usuarios');
    assert.deepEqual(rows.map((u) => u.email), ['matias.aramayo@gmail.com']);
  });
});

test('escribir el correo con otras mayusculas igual deja entrar', async () => {
  await baseLimpia();
  await conServidor(async (base) => {
    await registrar(base, 'clienta@t.cl');
    for (const email of ['clienta@t.cl', 'Clienta@T.cl', 'CLIENTA@T.CL', ' clienta@t.cl ']) {
      assert.equal((await entrar(base, email)).status, 200, `${email} deberia entrar`);
    }
  });
});

test('no se puede abrir una segunda cuenta cambiando las mayusculas', async () => {
  const db = await baseLimpia();
  await conServidor(async (base) => {
    assert.equal((await registrar(base, 'clienta@t.cl')).status, 200);
    const repetida = await registrar(base, 'CLIENTA@T.CL');
    assert.equal(repetida.status, 400);
    assert.match((await repetida.json()).error, /ya registrado/i);

    const { rows } = await db.query('SELECT id FROM usuarios');
    assert.equal(rows.length, 1, 'deberia haber una sola cuenta');
  });
});

// La red abajo: aunque el codigo se equivoque, la base no deja dos cuentas
// que solo se diferencian en mayusculas.
test('la base rechaza el duplicado aunque la ruta lo dejara pasar', async () => {
  const db = await baseLimpia();
  await db.query("INSERT INTO usuarios(nombre,email,password,rol) VALUES('A','a@t.cl','h','cliente')");
  await assert.rejects(
    () => db.query("INSERT INTO usuarios(nombre,email,password,rol) VALUES('B','A@T.CL','h','cliente')"),
    (error) => error.code === '23505');
});

test('un correo vacio no entra por la puerta del login', async () => {
  await baseLimpia();
  await conServidor(async (base) => {
    for (const email of [undefined, null, '', '   ', 42]) {
      const res = await entrar(base, email);
      assert.equal(res.status, 400, `email=${JSON.stringify(email)}`);
      assert.match((await res.json()).error, /credenciales/i);
    }
  });
});
