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
const DESCUENTO = 0.10;
// Precio de lista de una visita de 50 m2 sin materiales: lo que calcularPrecio() devuelve.
const LISTA_50 = { precio_base: 28000, subtotal: 28000, comision: 14277, iva: 2713, total_cliente: 44990,
  worker_recibe: 28000, retencion_honorarios: 4270, horas_incluidas: 3 };
const precioPlan = (lista) => P.precioVisitaPlan(lista, { tasaIva: IVA, descuento: DESCUENTO });

test('el plan descuenta 10% del precio de lista, sin tocar lo que recibe el aseador', () => {
  const v = precioPlan(LISTA_50);
  assert.equal(v.total_cliente, 40490);
  assert.equal(v.descuento_clp, 4500);
  assert.equal(v.comision, 10496);
  assert.equal(v.worker_recibe, 28000);
});

test('el plan cobra al menos lo mismo que la visita de hoy en cada tramo (la rentabilidad no baja)', () => {
  // Visita de hoy: comision y total con la tabla anterior a este cambio.
  const hoy = [
    { lista: { ...LISTA_50 }, comisionHoy: 10076, totalHoy: 39990 },
    { lista: { ...LISTA_50, subtotal: 35000, comision: 11756, total_cliente: 48990, worker_recibe: 35000 }, comisionHoy: 7000, totalHoy: 43330 },
    { lista: { ...LISTA_50, subtotal: 50000, comision: 16798, total_cliente: 69990, worker_recibe: 50000 }, comisionHoy: 10916, totalHoy: 62990 },
    { lista: { ...LISTA_50, subtotal: 68000, comision: 22681, total_cliente: 94990, worker_recibe: 68000 }, comisionHoy: 14277, totalHoy: 84990 },
    { lista: { ...LISTA_50, subtotal: 80000, comision: 26042, total_cliente: 110990, worker_recibe: 80000 }, comisionHoy: 16000, totalHoy: 99040 }
  ];
  for (const { lista, comisionHoy, totalHoy } of hoy) {
    const v = precioPlan(lista);
    assert.ok(v.comision >= comisionHoy, `comision del plan ${v.comision} vs hoy ${comisionHoy} (subtotal ${lista.subtotal})`);
    assert.ok(v.total_cliente >= totalHoy - 10, `precio del plan ${v.total_cliente} vs hoy ${totalHoy}`);
  }
});

async function planPendiente({ tipo = 'mensual', fechaInicio = '2026-09-28' } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const cliente = (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id")).rows[0].id;
  const visitas = P.VISITAS_POR_PLAN[tipo];
  const precio = precioPlan(LISTA_50);
  const total = precio.total_cliente * visitas;
  const { rows: [plan] } = await db.query(
    `INSERT INTO planes(cliente_id,tipo,direccion,metros,con_materiales,visitas,fecha_inicio,precio_visita,total,estado,flow_token,flow_order)
     VALUES($1,$2,'Calle 1',50,false,$3,$4::date,$5,$6,'pendiente_pago','tok-plan','ASEADA-PLAN-1')
     RETURNING id`, [cliente, tipo, visitas, fechaInicio, precio.total_cliente, total]);
  return { db, cliente, plan: plan.id, total, precio, visitas };
}

const calcularVisita = () => precioPlan(LISTA_50);

test('al confirmar el cobro se crean las visitas, una cada 7 dias, todas programadas', async () => {
  const e = await planPendiente({ tipo: 'mensual', fechaInicio: '2026-09-28' });
  const r = await P.enTransaccion(e.db, (db) =>
    P.activarPlan(db, 'tok-plan', { fee: 0, taxes: 0, balance: e.total }, { calcularVisita }));
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
    P.activarPlan(db, 'tok-plan', { fee: 1000, taxes: 200, balance: e.total - 1200 }, { calcularVisita }));
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
  await P.enTransaccion(e.db, (db) => P.activarPlan(db, 'tok-plan', {}, { calcularVisita }));
  const segunda = await P.enTransaccion(e.db, (db) => P.activarPlan(db, 'tok-plan', {}, { calcularVisita }));
  assert.equal(segunda.yaActivado, true);
  const { rows: [c] } = await e.db.query('SELECT COUNT(*)::int AS n FROM servicios WHERE plan_id=$1', [e.plan]);
  assert.equal(c.n, 4);
});

test('una visita se publica solo el dia que le toca, no antes', async () => {
  const e = await planPendiente({ tipo: 'mensual', fechaInicio: '2026-09-28' });
  await P.enTransaccion(e.db, (db) => P.activarPlan(db, 'tok-plan', {}, { calcularVisita }));

  const antes = await P.promoverVisitasDelDia(e.db, { ahora: new Date('2026-09-27T15:00:00Z') });
  assert.equal(antes.length, 0, 'el dia antes no se publica nada');

  const primera = await P.promoverVisitasDelDia(e.db, { ahora: new Date('2026-09-28T15:00:00Z') });
  assert.equal(primera.length, 1, 'el dia de la primera visita se publica');
  assert.equal(primera[0].estado, 'buscando_worker');

  const segunda = await P.promoverVisitasDelDia(e.db, { ahora: new Date('2026-10-05T15:00:00Z') });
  assert.equal(segunda.length, 1, 'la segunda visita se publica la semana siguiente');
});

test('la comision se ajusta para que el precio final sea exacto cuando es alcanzable', () => {
  const c = P.comisionParaPrecio(44990, 28000, IVA);
  assert.equal(c + Math.round(c * IVA) + 28000, 44990);
});
