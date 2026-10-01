// La llegada del aseador y el reclamo automatico si nadie se presenta.
//
// Antes, si el cliente no se daba cuenta de que nadie habia llegado y no
// reclamaba a mano, el servicio quedaba 'en_proceso' para siempre: el
// trabajador no cobraba (nunca pasaba a 'completado') y el cliente tampoco
// recuperaba su plata (nadie la reclamaba). Esto cierra ese hueco solo, sin
// que nadie tenga que darse cuenta.
//
// Deliberadamente NO es un reembolso automatico: marcarNoLlegadas() levanta
// el reclamo (el pago queda retenido), pero quien decide pagarle al
// trabajador o devolver sigue siendo un administrador. Un aseador que si
// llego pero se olvido de tocar el boton no deberia perder su pago sin que
// nadie lo revise primero.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

const HORA = 60 * 60 * 1000;
const silencio = () => {};

/** Cliente y aseador, con un servicio en_proceso cuya aceptacion es configurable. */
async function escenario({ aceptadoHace = 0, llegadaMarcada = false, ahora = new Date('2026-09-22T15:00:00Z') } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$2,$3,$4) RETURNING id', [email, email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const otroCliente = await nuevo('c2@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');
  const otroWorker = await nuevo('w2@t.cl', 'worker');

  const aceptadoEn = new Date(ahora.getTime() - aceptadoHace * HORA);
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,aceptado_en,llegada_en)
     VALUES($1,$2,'Calle 1',50,28000,28000,10076,1914,39990,28000,'en_proceso',$3,$4) RETURNING id`,
    [cliente, worker, aceptadoEn, llegadaMarcada ? aceptadoEn : null]);
  return { db, cliente, otroCliente, worker, otroWorker, servicio: s.id, ahora };
}

// ─── Marcar la llegada ───────────────────────────────────────────────────────

test('el aseador asignado marca que llego', async () => {
  const e = await escenario();
  const r = await P.marcarLlegada(e.db, e.servicio, e.worker, { ahora: e.ahora });
  assert.equal(r.servicio.llegada_en && new Date(r.servicio.llegada_en).getTime(), e.ahora.getTime());
});

test('otro aseador no puede marcar la llegada de un servicio ajeno', async () => {
  const e = await escenario();
  const r = await P.marcarLlegada(e.db, e.servicio, e.otroWorker, { ahora: e.ahora });
  assert.equal(r.status, 403);
});

test('no se puede marcar la llegada dos veces', async () => {
  const e = await escenario();
  await P.marcarLlegada(e.db, e.servicio, e.worker, { ahora: e.ahora });
  const r = await P.marcarLlegada(e.db, e.servicio, e.worker, { ahora: e.ahora });
  assert.equal(r.status, 409);
});

test('no se puede marcar la llegada de un servicio que no esta en_proceso', async () => {
  const e = await escenario();
  await e.db.query("UPDATE servicios SET estado='completado' WHERE id=$1", [e.servicio]);
  const r = await P.marcarLlegada(e.db, e.servicio, e.worker, { ahora: e.ahora });
  assert.equal(r.status, 400);
});

// ─── El reclamo automatico ───────────────────────────────────────────────────

test('si nadie marca la llegada dentro de la ventana, se levanta el reclamo solo', async () => {
  const e = await escenario({ aceptadoHace: 3 }); // ventana por defecto: 2 horas
  const reclamados = await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  assert.equal(reclamados.length, 1);
  assert.equal(reclamados[0].estado, 'en_reclamo');
  assert.equal(reclamados[0].reclamo_motivo, 'no_llego');
  assert.match(reclamados[0].reclamo_detalle, /autom[aá]ticamente/i);
});

test('dentro de la ventana, no se levanta nada', async () => {
  const e = await escenario({ aceptadoHace: 1 });
  const reclamados = await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  assert.equal(reclamados.length, 0);
  const { rows: [s] } = await e.db.query('SELECT estado FROM servicios WHERE id=$1', [e.servicio]);
  assert.equal(s.estado, 'en_proceso');
});

test('si el aseador ya marco que llego, no se levanta nada aunque haya pasado la ventana', async () => {
  const e = await escenario({ aceptadoHace: 5, llegadaMarcada: true });
  const reclamados = await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  assert.equal(reclamados.length, 0);
});

test('la ventana de tolerancia es configurable', async () => {
  const e = await escenario({ aceptadoHace: 1 });
  const reclamados = await P.marcarNoLlegadas(e.db, { ahora: e.ahora, horasTolerancia: 0.5 });
  assert.equal(reclamados.length, 1, 'con media hora de tolerancia, una hora de demora ya cuenta como no-llegada');
});

test('un servicio sin aceptado_en (datos viejos, de antes de esta migracion) no revienta ni se reclama', async () => {
  const e = await escenario({ aceptadoHace: 5 });
  await e.db.query('UPDATE servicios SET aceptado_en=NULL WHERE id=$1', [e.servicio]);
  const reclamados = await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  assert.equal(reclamados.length, 0);
});

// ─── La carrera entre marcar la llegada y que se levante el reclamo ────────

test('si el aseador marca la llegada justo antes de que corra el reclamo automatico, gana la llegada', async () => {
  const e = await escenario({ aceptadoHace: 3 });
  await P.marcarLlegada(e.db, e.servicio, e.worker, { ahora: e.ahora });
  const reclamados = await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  assert.equal(reclamados.length, 0);
});

test('tras el reclamo automatico, el aseador ya no puede marcar la llegada', async () => {
  const e = await escenario({ aceptadoHace: 3 });
  await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  const r = await P.marcarLlegada(e.db, e.servicio, e.worker, { ahora: e.ahora });
  assert.equal(r.status, 400, 'el servicio ya no esta en_proceso, esta en_reclamo');
});

// ─── El reclamo automatico se resuelve igual que uno manual ────────────────

test('el reclamo automatico se puede resolver liberando el pago al trabajador', async () => {
  const e = await escenario({ aceptadoHace: 3 });
  await P.marcarNoLlegadas(e.db, { ahora: e.ahora });
  await e.db.query(
    "INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_fecha_deposito) VALUES($1,$2,39990,10076,28000,'pagado','tok',$3)",
    [e.servicio, e.cliente, new Date('2026-09-20T00:00:00Z')]);
  const { resultado } = await P.resolverReclamo(e.db, e.servicio, 'liberar', { ahora: e.ahora });
  assert.equal(resultado.servicio.estado, 'pagado');
  assert.equal(resultado.servicio.confirmacion_origen, 'admin');
});
