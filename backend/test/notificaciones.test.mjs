// En web no hay push: los avisos solo se ven si la app los lista. Cada usuario
// ve los suyos, y marcarlos como leidos no toca los de nadie mas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');

const silencio = () => {};

async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  const nuevo = async (email) => (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$1,'h','cliente') RETURNING id", [email])).rows[0].id;
  const yo = await nuevo('yo@t.cl');
  const otro = await nuevo('otro@t.cl');
  return { db, yo, otro, token: jwt.sign({ id: yo, email: 'yo@t.cl', rol: 'cliente' }, process.env.JWT_SECRET) };
}

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const aviso = (db, usuario, titulo) => db.query(
  "INSERT INTO notificaciones(usuario_id,tipo,titulo,mensaje) VALUES($1,'prueba',$2,'m')", [usuario, titulo]);

test('cada usuario ve solo sus avisos, los mas nuevos primero y como maximo 30', async () => {
  const e = await escenario();
  for (let i = 1; i <= 35; i++) await aviso(e.db, e.yo, `mio ${i}`);
  await aviso(e.db, e.otro, 'ajeno');
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/notificaciones`, { headers: { Authorization: `Bearer ${e.token}` } });
    const lista = await res.json();
    assert.equal(lista.length, 30);
    assert.equal(lista[0].titulo, 'mio 35');
    assert.ok(lista.every((a) => a.usuario_id === e.yo));
  });
});

test('marcar como leidos solo afecta los avisos propios', async () => {
  const e = await escenario();
  await aviso(e.db, e.yo, 'mio');
  await aviso(e.db, e.otro, 'ajeno');
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/notificaciones/leidas`, { method: 'POST', headers: { Authorization: `Bearer ${e.token}` } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).marcadas, 1);
  });
  const { rows } = await e.db.query('SELECT usuario_id, leida FROM notificaciones ORDER BY id');
  assert.deepEqual(rows.map((r) => [r.usuario_id === e.yo, r.leida]), [[true, true], [false, false]]);
});

test('los avisos exigen sesion', async () => {
  await escenario();
  await conServidor(async (base) => {
    assert.equal((await fetch(`${base}/api/notificaciones`)).status, 401);
    assert.equal((await fetch(`${base}/api/notificaciones/leidas`, { method: 'POST' })).status, 401);
  });
});
