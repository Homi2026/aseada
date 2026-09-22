// Garantia al cliente y pago a los trabajadores, contra PostgreSQL real.
//
// Lo que estas pruebas protegen, en orden de gravedad:
//   1. nunca se deja lista para transferir una plata que Flow no deposito;
//   2. nunca se paga dos veces el mismo servicio;
//   3. un reclamo del cliente frena la liberacion, incluida la automatica.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

const HORA = 60 * 60 * 1000;
const silencio = () => {};

/** Cliente, aseador y un servicio pagado en Flow, listo para completarse. */
async function escenario({ deposito = null, estado = 'completado', completadoHace = 0, ahora = new Date('2026-09-22T15:00:00Z') } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$2,$3,$4) RETURNING id', [email, email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const otroCliente = await nuevo('c2@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');

  const completadoEn = new Date(ahora.getTime() - completadoHace * HORA);
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,completado_en)
     VALUES($1,$2,'Calle 1',50,28000,28000,10076,1914,39990,28000,$3,$4) RETURNING id`,
    [cliente, worker, estado, completadoEn]);
  await db.query(
    `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_fecha_deposito)
     VALUES($1,$2,39990,10076,28000,'pagado','tok',$3)`, [s.id, cliente, deposito]);
  return { db, cliente, otroCliente, worker, servicio: s.id, ahora };
}

const transferencias = async (db) => (await db.query('SELECT * FROM transferencias_trabajador')).rows;

// ─── 1. No adelantar dinero ─────────────────────────────────────────────────

test('si Flow aun no deposita, la transferencia espera los fondos', async () => {
  const ahora = new Date('2026-09-22T15:00:00Z');
  const deposito = new Date('2026-09-23T03:00:00Z');
  const e = await escenario({ deposito, ahora });

  const r = await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora });
  assert.equal(r.transferencia.estado, 'esperando_fondos');
  assert.equal(new Date(r.transferencia.disponible_desde).getTime(), deposito.getTime(),
    'debe quedar disponible justo cuando Flow deposita');
});

test('cuando llega la fecha de deposito, pasa a por transferir', async () => {
  const ahora = new Date('2026-09-22T15:00:00Z');
  const e = await escenario({ deposito: new Date('2026-09-23T03:00:00Z'), ahora });
  await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora });

  assert.equal((await P.marcarFondosDisponibles(e.db, { ahora: new Date('2026-09-23T02:59:00Z') })).length, 0,
    'un minuto antes del deposito no debe estar disponible');
  assert.equal((await P.marcarFondosDisponibles(e.db, { ahora: new Date('2026-09-23T03:00:00Z') })).length, 1);
  assert.equal((await transferencias(e.db))[0].estado, 'por_transferir');
});

test('si el deposito ya ocurrio, queda por transferir de inmediato', async () => {
  const ahora = new Date('2026-09-25T15:00:00Z');
  const e = await escenario({ deposito: new Date('2026-09-23T03:00:00Z'), ahora });
  const r = await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora });
  assert.equal(r.transferencia.estado, 'por_transferir');
});

test('sin fecha de deposito informada, se espera un dia en vez de adelantar', async () => {
  const ahora = new Date('2026-09-22T15:00:00Z');
  const e = await escenario({ deposito: null, ahora });
  const r = await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora });
  assert.equal(r.transferencia.estado, 'esperando_fondos');
  assert.equal(new Date(r.transferencia.disponible_desde).getTime(), ahora.getTime() + 24 * HORA);
});

test('la fecha de Flow se interpreta en hora de Chile', async () => {
  const e = await escenario();
  // Flow informa "2026-09-22 00:00:00" (hora chilena, UTC-3 en septiembre).
  await P.registrarDatosFlow(e.db, 'tok', { fee: '32.00', taxes: 6, balance: 962, transferDate: '2026-09-22 00:00:00' });
  const { rows: [p] } = await e.db.query('SELECT * FROM pagos');
  assert.equal(new Date(p.flow_fecha_deposito).toISOString(), '2026-09-22T03:00:00.000Z');
  assert.equal(p.flow_comision, 32);
  assert.equal(p.flow_impuestos, 6);
  assert.equal(p.flow_deposito, 962);
});

// ─── 2. No pagar doble ──────────────────────────────────────────────────────

test('liberar dos veces genera una sola transferencia', async () => {
  const e = await escenario({ deposito: new Date('2026-09-20T00:00:00Z') });
  const primera = await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora: e.ahora });
  const segunda = await P.liberarServicio(e.db, e.servicio, { origen: 'automatica', ahora: e.ahora });

  assert.ok(primera, 'la primera libera');
  assert.equal(segunda, null, 'la segunda no debe hacer nada');
  assert.equal((await transferencias(e.db)).length, 1);
  const { rows: [w] } = await e.db.query('SELECT total_servicios FROM usuarios WHERE id=$1', [e.worker]);
  assert.equal(w.total_servicios, 1, 'el servicio se cuenta una sola vez');
});

test('una transferencia solo se marca transferida una vez, y desde por_transferir', async () => {
  const e = await escenario({ deposito: new Date('2026-09-20T00:00:00Z') });
  const { transferencia } = await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora: e.ahora });
  assert.ok(await P.marcarTransferida(e.db, transferencia.id, { referencia: 'MP-123' }));
  assert.equal(await P.marcarTransferida(e.db, transferencia.id, { referencia: 'MP-456' }), null);
});

test('no se marca transferida una que todavia espera los fondos', async () => {
  const e = await escenario({ deposito: new Date('2026-09-30T00:00:00Z') });
  const { transferencia } = await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora: e.ahora });
  assert.equal(await P.marcarTransferida(e.db, transferencia.id), null);
});

test('no se libera un servicio que el trabajador no ha terminado', async () => {
  const e = await escenario({ estado: 'en_proceso' });
  assert.equal(await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora: e.ahora }), null);
  assert.equal((await transferencias(e.db)).length, 0);
});

// ─── 3. El reclamo frena la liberacion ──────────────────────────────────────

test('la liberacion automatica respeta las 24 h de revision', async () => {
  const hace23 = await escenario({ completadoHace: 23 });
  assert.equal((await P.liberarVencidos(hace23.db, { ahora: hace23.ahora })).length, 0);

  const hace25 = await escenario({ completadoHace: 25, deposito: new Date('2026-09-20T00:00:00Z') });
  const liberados = await P.liberarVencidos(hace25.db, { ahora: hace25.ahora });
  assert.equal(liberados.length, 1);
  assert.equal(liberados[0].servicio.confirmacion_origen, 'automatica');
});

test('un reclamo impide la liberacion automatica', async () => {
  const e = await escenario({ completadoHace: 30 });
  const r = await P.reclamar(e.db, e.servicio, e.cliente, { motivo: 'incompleto', detalle: 'Faltó el baño', ahora: e.ahora });
  assert.equal(r.servicio.estado, 'en_reclamo');
  assert.equal((await P.liberarVencidos(e.db, { ahora: e.ahora })).length, 0);
  assert.equal((await transferencias(e.db)).length, 0);
});

test('solo el cliente del servicio puede reclamar, y con un motivo valido', async () => {
  const e = await escenario();
  assert.equal((await P.reclamar(e.db, e.servicio, e.otroCliente, { motivo: 'otro' })).status, 403);
  assert.equal((await P.reclamar(e.db, e.servicio, e.cliente, { motivo: 'me aburri' })).status, 400);
});

test('"no llegó nadie" se puede reportar antes de que el servicio se complete', async () => {
  const e = await escenario({ estado: 'en_proceso' });
  const r = await P.reclamar(e.db, e.servicio, e.cliente, { motivo: 'no_llego' });
  assert.equal(r.servicio.estado, 'en_reclamo');
});

test('resolver un reclamo liberando paga al trabajador', async () => {
  const e = await escenario({ deposito: new Date('2026-09-20T00:00:00Z') });
  await P.reclamar(e.db, e.servicio, e.cliente, { motivo: 'otro' });
  const { resultado } = await P.resolverReclamo(e.db, e.servicio, 'liberar', { ahora: e.ahora });
  assert.equal(resultado.servicio.confirmacion_origen, 'admin');
  assert.equal((await transferencias(e.db)).length, 1);
});

test('resolver un reclamo reembolsando no le paga al trabajador', async () => {
  const e = await escenario();
  await P.reclamar(e.db, e.servicio, e.cliente, { motivo: 'no_llego' });
  const { resultado } = await P.resolverReclamo(e.db, e.servicio, 'reembolsar', { ahora: e.ahora });
  assert.equal(resultado.pago.estado, 'reembolsado');
  assert.equal(resultado.servicio.estado, 'reembolsado');
  assert.equal((await transferencias(e.db)).length, 0);
  // Y ya no se puede liberar despues de reembolsar.
  assert.ok((await P.resolverReclamo(e.db, e.servicio, 'liberar', { ahora: e.ahora })).error);
});

// ─── Retencion ──────────────────────────────────────────────────────────────

test('la tasa de retencion sigue el calendario de la ley', async () => {
  const { db } = await escenario();
  assert.equal(await P.tasaRetencion(db, new Date('2026-06-01')), 0.1525);
  assert.equal(await P.tasaRetencion(db, new Date('2027-06-01')), 0.16);
  assert.equal(await P.tasaRetencion(db, new Date('2028-06-01')), 0.17);
  // Despues de 2028 la ley no sube mas: rige la ultima.
  assert.equal(await P.tasaRetencion(db, new Date('2031-06-01')), 0.17);
});

test('si Aseada retiene se transfiere el liquido; si no, el bruto', async () => {
  const deposito = new Date('2026-09-20T00:00:00Z');
  const sinRetener = await escenario({ deposito });
  const a = (await P.liberarServicio(sinRetener.db, sinRetener.servicio, { origen: 'cliente', ahora: sinRetener.ahora })).transferencia;
  assert.equal(a.monto_a_transferir, 28000);

  const reteniendo = await escenario({ deposito });
  const b = (await P.liberarServicio(reteniendo.db, reteniendo.servicio, { origen: 'cliente', aseadaRetiene: true, ahora: reteniendo.ahora })).transferencia;
  assert.equal(b.retencion, 4270, '15,25% de 28.000');
  assert.equal(b.monto_a_transferir, 23730);
});

test('los pendientes avisan si faltan datos bancarios', async () => {
  const e = await escenario({ deposito: new Date('2026-09-20T00:00:00Z') });
  await P.liberarServicio(e.db, e.servicio, { origen: 'cliente', ahora: e.ahora });
  assert.equal((await P.listarPendientes(e.db))[0].datos_bancarios_completos, false);

  await e.db.query("UPDATE usuarios SET rut='11.111.111-1', banco='Mercado Pago', tipo_cuenta='vista', numero_cuenta='123' WHERE id=$1", [e.worker]);
  assert.equal((await P.listarPendientes(e.db))[0].datos_bancarios_completos, true);
});
