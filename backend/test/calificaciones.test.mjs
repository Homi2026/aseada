// El cliente califica al aseador de un servicio confirmado, una sola vez, y
// el promedio del aseador se recalcula.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

async function escenario() {
  const db = new PGlite();
  await migrar(db, () => {});
  const nuevo = async (email, rol) => (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$1,'h',$2) RETURNING id", [email, rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const otro = await nuevo('c2@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');
  const servicio = async (estado) => (await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,$2,'Calle 1',50,28000,28000,11756,2234,41990,28000,$3) RETURNING id`, [cliente, worker, estado])).rows[0].id;
  return { db, cliente, otro, worker, servicio };
}

const promedio = async (db, id) => Number((await db.query('SELECT calificacion_promedio FROM usuarios WHERE id=$1', [id])).rows[0].calificacion_promedio);

test('califica un servicio confirmado y el promedio refleja todas las calificaciones', async () => {
  const e = await escenario();
  assert.ok((await P.calificar(e.db, await e.servicio('pagado'), e.cliente, { puntaje: 5 })).calificacion);
  assert.ok((await P.calificar(e.db, await e.servicio('pagado'), e.cliente, { puntaje: 4, comentario: 'Bien' })).calificacion);
  assert.equal(await promedio(e.db, e.worker), 4.5);
});

test('no se califica dos veces el mismo servicio', async () => {
  const e = await escenario();
  const id = await e.servicio('pagado');
  await P.calificar(e.db, id, e.cliente, { puntaje: 5 });
  assert.equal((await P.calificar(e.db, id, e.cliente, { puntaje: 1 })).status, 409);
  assert.equal(await promedio(e.db, e.worker), 5);
});

test('solo el cliente del servicio, solo confirmado, y de 1 a 5', async () => {
  const e = await escenario();
  const id = await e.servicio('pagado');
  assert.equal((await P.calificar(e.db, id, e.otro, { puntaje: 5 })).status, 403);
  assert.equal((await P.calificar(e.db, await e.servicio('completado'), e.cliente, { puntaje: 5 })).status, 400);
  assert.equal((await P.calificar(e.db, id, e.cliente, { puntaje: 6 })).status, 400);
  assert.equal((await P.calificar(e.db, id, e.cliente, { puntaje: 0 })).status, 400);
  assert.equal((await P.calificar(e.db, id, e.cliente, { puntaje: 'abc' })).status, 400);
});
