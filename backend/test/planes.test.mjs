// Planes mensuales y de 3 meses: un cobro por adelantado que crea varias
// visitas semanales. Cada visita se paga y se libera como un servicio normal.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

const silencio = () => {};
const IVA = 0.19;
// Visita suelta de 50 m2 sin materiales: la misma que calcularPrecio() devuelve hoy.
const BASE_50 = { precio_base: 28000, subtotal: 28000, comision: 10076, iva: 1914, total_cliente: 39990,
  worker_recibe: 28000, retencion_honorarios: 4270, horas_incluidas: 3 };

test('el plan mensual descuenta 10% de la comision, sin tocar lo que recibe el aseador', () => {
  const v = P.precioVisitaPlan(BASE_50, IVA, 'mensual');
  assert.equal(v.descuento, 1008);
  assert.equal(v.comision, 9068);
  assert.equal(v.iva, 1723);
  assert.equal(v.total_cliente, 38791);
  assert.equal(v.worker_recibe, 28000);
});

test('el plan de 3 meses descuenta 15% de la comision', () => {
  const v = P.precioVisitaPlan(BASE_50, IVA, 'trimestral');
  assert.equal(v.descuento, 1511);
  assert.equal(v.comision, 8565);
  assert.equal(v.total_cliente, 38192);
  assert.equal(v.worker_recibe, 28000);
});

test('el descuento nunca deja la comision por debajo de lo que queda despues del porcentaje', () => {
  const grande = { ...BASE_50, subtotal: 80000, comision: 16000, iva: 3040, total_cliente: 99040, worker_recibe: 80000 };
  const v = P.precioVisitaPlan(grande, IVA, 'trimestral');
  assert.equal(v.comision, 16000 - 2400);
  assert.ok(v.comision > 0);
});

async function planPendiente({ tipo = 'mensual', fechaInicio = '2026-09-28' } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const cliente = (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id")).rows[0].id;
  const visitas = P.VISITAS_POR_PLAN[tipo];
  const precio = P.precioVisitaPlan(BASE_50, IVA, tipo);
  const total = precio.total_cliente * visitas;
  const { rows: [plan] } = await db.query(
    `INSERT INTO planes(cliente_id,tipo,direccion,metros,con_materiales,visitas,fecha_inicio,precio_visita,total,estado,flow_token,flow_order)
     VALUES($1,$2,'Calle 1',50,false,$3,$4::date,$5,$6,'pendiente_pago','tok-plan','ASEADA-PLAN-1')
     RETURNING id`, [cliente, tipo, visitas, fechaInicio, precio.total_cliente, total]);
  return { db, cliente, plan: plan.id, total, precio, visitas };
}

const calcularVisita = (tipo) => () => P.precioVisitaPlan(BASE_50, IVA, tipo);

test('al confirmar el cobro se crean las visitas, una cada 7 dias, todas programadas', async () => {
  const e = await planPendiente({ tipo: 'mensual', fechaInicio: '2026-09-28' });
  const r = await P.enTransaccion(e.db, (db) =>
    P.activarPlan(db, 'tok-plan', { fee: 0, taxes: 0, balance: e.total }, { calcularVisita: calcularVisita('mensual') }));
  assert.equal(r.visitas.length, 4);
  const { rows } = await e.db.query(
    "SELECT numero_visita, estado, plan_id, fecha_servicio::text AS f FROM servicios WHERE plan_id=$1 ORDER BY numero_visita", [e.plan]);
  assert.deepEqual(rows.map((x) => x.estado), ['programado', 'programado', 'programado', 'programado']);
  assert.deepEqual(rows.map((x) => x.numero_visita), [1, 2, 3, 4]);
  const dias = rows.map((x) => new Date(x.f).toISOString().slice(0, 10));
  assert.deepEqual(dias, ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
});

test('cada visita tiene su pago pagado, y la suma de los pagos es el total del plan', async () => {
  const e = await planPendiente({ tipo: 'trimestral' });
  await P.enTransaccion(e.db, (db) =>
    P.activarPlan(db, 'tok-plan', { fee: 1000, taxes: 200, balance: e.total - 1200 }, { calcularVisita: calcularVisita('trimestral') }));
  const { rows: [suma] } = await e.db.query(
    "SELECT COUNT(*)::int AS n, SUM(monto_total)::int AS monto, SUM(flow_comision)::int AS fee, SUM(flow_deposito)::int AS dep, BOOL_AND(estado='pagado') AS todos_pagados FROM pagos WHERE servicio_id IN (SELECT id FROM servicios WHERE plan_id=$1)", [e.plan]);
  assert.equal(suma.n, 12);
  assert.equal(suma.monto, e.total);
  assert.equal(suma.fee, 1000, 'lo que Flow cobro se reparte completo entre las visitas');
  assert.equal(suma.dep, e.total - 1200);
  assert.equal(suma.todos_pagados, true);
});

test('confirmar dos veces el mismo cobro no duplica las visitas', async () => {
  const e = await planPendiente({ tipo: 'mensual' });
  await P.enTransaccion(e.db, (db) => P.activarPlan(db, 'tok-plan', {}, { calcularVisita: calcularVisita('mensual') }));
  const segunda = await P.enTransaccion(e.db, (db) => P.activarPlan(db, 'tok-plan', {}, { calcularVisita: calcularVisita('mensual') }));
  assert.equal(segunda.yaActivado, true);
  const { rows: [c] } = await e.db.query('SELECT COUNT(*)::int AS n FROM servicios WHERE plan_id=$1', [e.plan]);
  assert.equal(c.n, 4);
});

test('una visita se publica solo el dia que le toca, no antes', async () => {
  const e = await planPendiente({ tipo: 'mensual', fechaInicio: '2026-09-28' });
  await P.enTransaccion(e.db, (db) => P.activarPlan(db, 'tok-plan', {}, { calcularVisita: calcularVisita('mensual') }));

  const antes = await P.promoverVisitasDelDia(e.db, { ahora: new Date('2026-09-27T15:00:00Z') });
  assert.equal(antes.length, 0, 'el dia antes no se publica nada');

  const primera = await P.promoverVisitasDelDia(e.db, { ahora: new Date('2026-09-28T15:00:00Z') });
  assert.equal(primera.length, 1, 'el dia de la primera visita se publica');
  assert.equal(primera[0].estado, 'buscando_worker');

  const segunda = await P.promoverVisitasDelDia(e.db, { ahora: new Date('2026-10-05T15:00:00Z') });
  assert.equal(segunda.length, 1, 'la segunda visita se publica la semana siguiente');
});
