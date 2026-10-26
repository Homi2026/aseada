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
const DESCUENTO = { mensual: 0.05, trimestral: 0.08 };
const flow = (total) => Math.round(FLOW * total);

// Precio de lista de una visita de 50 m2 sin materiales (lo que calcularPrecio()
// devuelve): 3 horas a la tarifa pareja de $8.000 para el aseador.
const LISTA_50 = { precio_base: 24000, subtotal: 24000, comision: 10076, iva: 1914, total_cliente: 35990,
  worker_recibe: 24000, retencion_honorarios: 3660, horas_incluidas: 3 };
const precioPlan = (lista, tipo) => P.precioVisitaPlan(lista, { tasaIva: IVA, descuento: DESCUENTO[tipo] });

test('el plan mensual de 50 m2 cobra $34.190 por visita (5% bajo la lista)', () => {
  const v = precioPlan(LISTA_50, 'mensual');
  assert.equal(v.total_cliente, 34190);
  assert.equal(v.worker_recibe, 24000, 'el aseador cobra su precio completo');
  assert.equal(v.descuento_clp, 1800);
});

test('el plan de 3 meses de 50 m2 cobra 8% bajo la lista', () => {
  const v = precioPlan(LISTA_50, 'trimestral');
  assert.equal(v.total_cliente, 33109);
  assert.ok(v.descuento_clp >= 2880, 'descuenta cerca del 8% de los 35.990');
});

// Cada tramo con su lista y el pago al aseador que sale de sus horas.
const TRAMOS = [
  { nombre: '50 m2 mensual', subtotal: 24000, lista: 35990, tipo: 'mensual' },
  { nombre: '50 m2 3 meses', subtotal: 24000, lista: 35990, tipo: 'trimestral' },
  { nombre: '80 m2', subtotal: 32000, lista: 43990, tipo: 'mensual' },
  { nombre: '120 m2', subtotal: 40000, lista: 51990, tipo: 'mensual' },
  { nombre: '200 m2', subtotal: 52000, lista: 64990, tipo: 'mensual' },
  { nombre: '999 m2', subtotal: 64000, lista: 78990, tipo: 'mensual' }
];

const listaDe = (t) => {
  const comision = P.comisionParaPrecio(t.lista, t.subtotal, IVA);
  return { ...LISTA_50, subtotal: t.subtotal, comision, iva: Math.round(comision * IVA), total_cliente: t.lista };
};

// El piso se mide en pesos y no como porcentaje del precio: el precio incluye
// lo que recibe el aseador, que es dinero de paso, asi que en una casa grande
// ese porcentaje baja siempre (ahi el aseador se lleva el 80% del precio)
// aunque Aseada gane mas pesos que en un depto chico.
test('cada visita de plan deja al menos $5.000 para Aseada despues de Flow', () => {
  for (const t of TRAMOS) {
    const v = P.precioVisitaPlan(listaDe(t), { tasaIva: IVA, descuento: DESCUENTO[t.tipo] });
    const neto = v.comision - flow(v.total_cliente);
    assert.ok(neto >= 5000, `${t.nombre}: quedan ${Math.round(neto)} por visita, bajo el piso de 5.000`);
  }
});

// El plan existe porque reparte el CPA entre varias visitas, no porque regale
// precio: por eso tiene que rendir MAS por visita que una suelta.
test('una visita de plan rinde mas que una suelta, repartiendo el CPA', () => {
  for (const t of TRAMOS) {
    const lista = listaDe(t);
    const visitas = t.tipo === 'mensual' ? 4 : 12;
    const v = P.precioVisitaPlan(lista, { tasaIva: IVA, descuento: DESCUENTO[t.tipo] });
    const porVisitaEnPlan = (visitas * (v.comision - flow(v.total_cliente)) - CPA) / visitas;
    const suelta = lista.comision - flow(lista.total_cliente) - CPA;
    assert.ok(porVisitaEnPlan > suelta,
      `${t.nombre}: en plan rinde ${Math.round(porVisitaEnPlan)} por visita, menos que los ${Math.round(suelta)} de una suelta`);
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
