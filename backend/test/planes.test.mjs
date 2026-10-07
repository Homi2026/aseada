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
const FLOW = 0.0289 * 1.19;
const CPA = 5000;
const DESCUENTO = { mensual: 0.12, trimestral: 0.15 };
const flow = (total) => Math.round(FLOW * total);

// Precio de lista de una visita de 50 m2 sin materiales (lo que calcularPrecio() devuelve).
const LISTA_50 = { precio_base: 28000, subtotal: 28000, comision: 11756, iva: 2234, total_cliente: 41990,
  worker_recibe: 28000, retencion_honorarios: 4270, horas_incluidas: 3 };
const precioPlan = (lista, tipo) => P.precioVisitaPlan(lista, { tasaIva: IVA, descuento: DESCUENTO[tipo] });

test('el plan mensual de 50 m2 cobra $36.950 por visita (12% bajo la lista)', () => {
  const v = precioPlan(LISTA_50, 'mensual');
  assert.equal(v.total_cliente, 36950);
  assert.equal(v.worker_recibe, 28000, 'el aseador cobra su precio completo');
  assert.equal(v.descuento_clp, 5040);
});

test('el plan de 3 meses de 50 m2 cobra $35.690 por visita (15% bajo la lista)', () => {
  const v = precioPlan(LISTA_50, 'trimestral');
  assert.equal(v.total_cliente, 35690);
  assert.equal(v.descuento_clp, 6300);
});

// Tramos con su lista y su descuento de plan (10% fuera del tramo de 50 m2).
const TRAMOS = [
  { nombre: '50 m2 mensual', subtotal: 28000, lista: 41990, tipo: 'mensual' },
  { nombre: '50 m2 3 meses', subtotal: 28000, lista: 41990, tipo: 'trimestral' },
  { nombre: '65 m2', subtotal: 35000, lista: 48990, tipo: 'mensual', descuento: 0.10 },
  { nombre: '120 m2', subtotal: 50000, lista: 69990, tipo: 'mensual', descuento: 0.10 },
  { nombre: '200 m2', subtotal: 68000, lista: 94990, tipo: 'mensual', descuento: 0.10 },
  { nombre: '250 m2', subtotal: 80000, lista: 110990, tipo: 'mensual', descuento: 0.10 }
];

test('cada plan deja al menos 12% de margen neto despues de Flow, en todos los tramos', () => {
  for (const t of TRAMOS) {
    const comision = P.comisionParaPrecio(t.lista, t.subtotal, IVA);
    const lista = { ...LISTA_50, subtotal: t.subtotal, comision, iva: Math.round(comision * IVA), total_cliente: t.lista };
    const d = t.descuento ?? DESCUENTO[t.tipo];
    const v = P.precioVisitaPlan(lista, { tasaIva: IVA, descuento: d });
    const neto = v.comision - flow(v.total_cliente);
    assert.ok(neto / v.total_cliente >= 0.12, `${t.nombre}: margen neto ${(neto / v.total_cliente * 100).toFixed(1)}% bajo el 12%`);
  }
});

test('el plan mensual recupera el CPA de $5.000 en el primer mes, en todos los tramos', () => {
  for (const t of TRAMOS.filter((x) => x.tipo === 'mensual')) {
    const comision = P.comisionParaPrecio(t.lista, t.subtotal, IVA);
    const lista = { ...LISTA_50, subtotal: t.subtotal, comision, iva: Math.round(comision * IVA), total_cliente: t.lista };
    const v = P.precioVisitaPlan(lista, { tasaIva: IVA, descuento: t.descuento ?? DESCUENTO.mensual });
    const neto = v.comision - flow(v.total_cliente);
    assert.ok(4 * neto - CPA > 0, `${t.nombre}: el primer mes no alcanza a pagar el CPA`);
  }
});

async function planPendiente({ tipo = 'mensual', fechaInicio = '2026-09-28' } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const cliente = (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id")).rows[0].id;
  const visitas = P.VISITAS_POR_PLAN[tipo];
  const precio = precioPlan(LISTA_50, tipo);
  const total = precio.total_cliente * visitas;
  const { rows: [plan] } = await db.query(
    `INSERT INTO planes(cliente_id,tipo,direccion,metros,con_materiales,visitas,fecha_inicio,precio_visita,total,estado,flow_token,flow_order)
     VALUES($1,$2,'Calle 1',50,false,$3,$4::date,$5,$6,'pendiente_pago','tok-plan','ASEADA-PLAN-1')
     RETURNING id`, [cliente, tipo, visitas, fechaInicio, precio.total_cliente, total]);
  return { db, cliente, plan: plan.id, total, precio, visitas };
}

const calcularVisita = (tipo) => () => precioPlan(LISTA_50, tipo);

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

test('la comision se ajusta para que el precio final sea exacto cuando es alcanzable', () => {
  const c = P.comisionParaPrecio(44990, 28000, IVA);
  assert.equal(c + Math.round(c * IVA) + 28000, 44990);
});
