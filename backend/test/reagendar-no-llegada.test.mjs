// Cuando nadie llego, el cliente elige: reagendar con otro aseador (hoy o
// manana) en vez de ir directo a esperar que un admin resuelva un reembolso.
// marcarNoLlegadas() deja el servicio en_reclamo con reclamo_motivo='no_llego'
// (ver llegada-del-trabajador.test.mjs); reagendarPorNoLlegada() es lo que el
// cliente dispara desde ahi.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

const silencio = () => {};
const AHORA = new Date('2026-09-22T15:00:00Z');

/** Un servicio ya en_reclamo por no_llego, con el worker que no llego asignado. */
async function escenario({ motivo = 'no_llego' } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$2,$3,$4) RETURNING id', [email, email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const otroCliente = await nuevo('c2@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,reclamo_en,reclamo_motivo)
     VALUES($1,$2,'Calle 1',50,28000,28000,10076,1914,39990,28000,'en_reclamo',$3,$4) RETURNING id`,
    [cliente, worker, AHORA, motivo]);
  return { db, cliente, otroCliente, worker, servicio: s.id };
}

test('el cliente reagenda para hoy: vuelve a buscando_worker y excluye al que no llego', async () => {
  const e = await escenario();
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'hoy', ahora: AHORA });
  assert.equal(r.servicio.estado, 'buscando_worker');
  assert.equal(r.servicio.worker_id, null);
  assert.equal(r.servicio.llegada_en, null);
  assert.equal(r.servicio.aceptado_en, null);
  assert.equal(r.servicio.reclamo_motivo, null);
  assert.deepEqual(r.servicio.workers_excluidos, [e.worker]);
});

test('reagendar para manana suma 24 horas a fecha_servicio', async () => {
  const e = await escenario();
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'manana', ahora: AHORA });
  const esperada = new Date(AHORA.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(new Date(r.servicio.fecha_servicio).getTime(), esperada.getTime());
});

test("'cuando' solo acepta 'hoy' o 'manana'", async () => {
  const e = await escenario();
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'pasado-manana', ahora: AHORA });
  assert.equal(r.status, 400);
});

test('solo el cliente del servicio puede reagendarlo', async () => {
  const e = await escenario();
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, e.otroCliente, { cuando: 'hoy', ahora: AHORA });
  assert.equal(r.status, 403);
});

test('no se puede reagendar un reclamo que no es por no_llego', async () => {
  const e = await escenario({ motivo: 'incompleto' });
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'hoy', ahora: AHORA });
  assert.equal(r.status, 400);
});

test('no se puede reagendar un servicio que no esta en_reclamo', async () => {
  const e = await escenario();
  await e.db.query("UPDATE servicios SET estado='en_proceso' WHERE id=$1", [e.servicio]);
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'hoy', ahora: AHORA });
  assert.equal(r.status, 400);
});

test('un servicio no encontrado da 404', async () => {
  const e = await escenario();
  const r = await P.reagendarPorNoLlegada(e.db, 999999, e.cliente, { cuando: 'hoy', ahora: AHORA });
  assert.equal(r.status, 404);
});

test('tras reagendar dos veces, workers_excluidos acumula a ambos aseadores', async () => {
  const e = await escenario();
  const r1 = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'hoy', ahora: AHORA });
  // Un segundo aseador toma el trabajo y tampoco llega: mismo camino que el
  // primero, levantado por marcarNoLlegadas() en producción.
  const otroWorker = (await e.db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$2,$3,$4) RETURNING id", ['w2@t.cl', 'w2@t.cl', 'h', 'worker'])).rows[0].id;
  await e.db.query(
    "UPDATE servicios SET estado='en_reclamo', worker_id=$2, reclamo_motivo='no_llego' WHERE id=$1",
    [e.servicio, otroWorker]);
  const r2 = await P.reagendarPorNoLlegada(e.db, e.servicio, e.cliente, { cuando: 'hoy', ahora: AHORA });
  assert.deepEqual(r2.servicio.workers_excluidos, [e.worker, otroWorker]);
});
