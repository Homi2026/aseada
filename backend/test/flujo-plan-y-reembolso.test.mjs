// El flujo completo de un plan y de un reembolso, contra el servidor real y
// PostgreSQL en memoria. Flow se simula: lo que se verifica es que Aseada le
// pida lo correcto y reaccione bien a lo que Flow responde. La prueba con
// dinero de verdad se hace aparte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';
process.env.CRON_SECRET ||= 'cron-de-prueba';
process.env.FLOW_API_KEY = 'api-prueba';
process.env.FLOW_SECRET_KEY = 'secreto-flow-prueba';
process.env.PUBLIC_URL = 'https://api.prueba';
process.env.APP_URL = 'https://app.prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');
const axios = require('axios');

const silencio = () => {};
const pedidosAFlow = [];
const respuestasFlow = {
  '/payment/create': () => ({ url: 'https://www.flow.cl/app/web/pay.php', token: 'tok-plan-1' }),
  '/payment/getStatus': () => ({ status: 2, paymentData: { fee: 4272, taxes: 811, balance: 143528, transferDate: '2026-10-25' } }),
  '/refund/create': () => ({ token: 'ref-1', status: 'created', flowRefundOrder: 9001 }),
  '/refund/getStatus': () => ({ status: 'refunded' })
};
const rutaDeFlow = (url) => Object.keys(respuestasFlow).find((ruta) => url.endsWith(ruta));

axios.post = async (url, cuerpo) => {
  const ruta = rutaDeFlow(url);
  pedidosAFlow.push({ ruta, cuerpo: String(cuerpo) });
  return { data: respuestasFlow[ruta](new URLSearchParams(cuerpo)) };
};
axios.get = async (url, { params }) => {
  const ruta = rutaDeFlow(url);
  pedidosAFlow.push({ ruta, cuerpo: new URLSearchParams(params).toString() });
  return { data: respuestasFlow[ruta](params) };
};

async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  const nuevo = async (email, rol) => (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,'h',$2,true) RETURNING id", [email, rol])).rows[0].id;
  const cliente = await nuevo('cliente@t.cl', 'cliente');
  const worker = await nuevo('worker@t.cl', 'worker');
  const tokenCliente = jwt.sign({ id: cliente, email: 'cliente@t.cl', rol: 'cliente' }, process.env.JWT_SECRET);
  return { db, cliente, worker, tokenCliente };
}

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const post = (base, ruta, cuerpo, token) => fetch(base + ruta, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(cuerpo)
});

// La ruta rechaza una primera visita en el pasado, asi que la fecha se calcula
// desde hoy: una fecha fija deja de servir apenas pasa.
const diaEnChile = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const DIA_MS = 24 * 60 * 60 * 1000;
const INICIO = diaEnChile(Date.now() + 5 * DIA_MS);
const VISITAS_ESPERADAS = [0, 7, 14, 21].map((d) => diaEnChile(Date.parse(`${INICIO}T12:00:00Z`) + d * DIA_MS));

// Precio de una visita del plan mensual para 50 m2 sin materiales. Fija a mano
// el valor de la tabla de precios: si la tabla cambia, esta prueba tiene que
// cambiar con ella, que es justamente lo que queremos notar.
const VISITA_PLAN = 34190;
const TOTAL_PLAN = 4 * VISITA_PLAN;

test('un plan: cotiza, cobra en Flow, crea las 4 visitas programadas y no duplica al confirmar dos veces', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const cotizacion = await post(base, '/api/planes/cotizar', { tipo: 'mensual', metros: 50, con_materiales: false }, e.tokenCliente);
    assert.equal(cotizacion.status, 200);
    assert.equal((await cotizacion.json()).total, TOTAL_PLAN);

    const compra = await post(base, '/api/planes', {
      tipo: 'mensual', metros: 50, con_materiales: false, direccion: 'Calle 1', fecha_inicio: INICIO
    }, e.tokenCliente);
    assert.equal(compra.status, 200);
    const cobro = await compra.json();
    assert.match(cobro.url_pago, /token=tok-plan-1/);

    const pedido = pedidosAFlow.find((p) => p.ruta === '/payment/create');
    assert.match(pedido.cuerpo, new RegExp(`amount=${TOTAL_PLAN}`), 'Flow cobra el total del plan');
    assert.match(pedido.cuerpo, /pagos%2Fflow%2Fplan%2Fconfirmacion|pagos\/flow\/plan\/confirmacion/, 'Flow avisa al webhook del plan');

    const confirmacion = await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });
    assert.equal(confirmacion.status, 200);
    await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });

    const { rows: [plan] } = await e.db.query("SELECT estado, total FROM planes WHERE flow_token='tok-plan-1'");
    assert.equal(plan.estado, 'activo');
    assert.equal(plan.total, TOTAL_PLAN);

    const { rows: visitas } = await e.db.query(
      `SELECT estado, numero_visita, (fecha_servicio AT TIME ZONE 'America/Santiago')::date::text AS dia
       FROM servicios WHERE plan_id IS NOT NULL ORDER BY numero_visita`);
    assert.equal(visitas.length, 4, 'confirmar dos veces no crea visitas de mas');
    assert.deepEqual(visitas.map((v) => v.estado), ['programado', 'programado', 'programado', 'programado']);
    assert.deepEqual(visitas.map((v) => v.dia), VISITAS_ESPERADAS);

    const { rows: [pagos] } = await e.db.query(
      "SELECT COUNT(*)::int AS n, SUM(monto_total)::int AS monto, SUM(flow_comision)::int AS fee FROM pagos WHERE servicio_id IN (SELECT id FROM servicios WHERE plan_id IS NOT NULL)");
    assert.equal(pagos.n, 4);
    assert.equal(pagos.monto, TOTAL_PLAN);
    assert.equal(pagos.fee, 4272, 'la comision de Flow se reparte completa entre las visitas');
  });
});

test('una visita de plan que no llego se reembolsa por la API de Flow, y el aviso de Flow queda registrado', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await post(base, '/api/planes', { tipo: 'mensual', metros: 50, con_materiales: false, direccion: 'Calle 1', fecha_inicio: INICIO }, e.tokenCliente);
    await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });
    const { rows: [visita] } = await e.db.query(
      "SELECT id FROM servicios WHERE plan_id IS NOT NULL ORDER BY numero_visita LIMIT 1");
    await e.db.query(
      "UPDATE servicios SET estado='en_reclamo', worker_id=$2, reclamo_motivo='no_llego', reclamo_en=NOW(), aceptado_en=NOW() - INTERVAL '3 hours' WHERE id=$1",
      [visita.id, e.worker]);

    const reembolso = await post(base, `/api/servicios/${visita.id}/pedir-reembolso`, {}, e.tokenCliente);
    assert.equal(reembolso.status, 200);

    const pedido = pedidosAFlow.find((p) => p.ruta === '/refund/create');
    assert.match(pedido.cuerpo, new RegExp(`amount=${VISITA_PLAN}`), 'se devuelve lo que pago esa visita');
    assert.match(pedido.cuerpo, /receiverEmail=cliente%40t\.cl/, 'Flow manda la confirmacion al correo del cliente');
    assert.match(pedido.cuerpo, /commerceTrxId=ASEADA-PLAN-/, 'la devolucion apunta al cobro del plan');

    const { rows: [pago] } = await e.db.query(
      'SELECT estado, flow_refund_token FROM pagos WHERE servicio_id=$1', [visita.id]);
    assert.equal(pago.estado, 'reembolsado');
    assert.equal(pago.flow_refund_token, 'ref-1');

    const aviso = await post(base, '/pagos/flow/reembolso-confirmacion', { token: 'ref-1' });
    assert.equal(aviso.status, 200);
    const { rows: [despues] } = await e.db.query(
      'SELECT flow_refund_status FROM pagos WHERE servicio_id=$1', [visita.id]);
    assert.equal(despues.flow_refund_status, 'refunded');
  });
});

test('el admin cancela un plan: devuelve en un solo reembolso las visitas sin aseador y deja intactas las en curso', async () => {
  const e = await escenario();
  const admin = (await e.db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES('admin@t.cl','admin@t.cl','h','admin',true) RETURNING id")).rows[0].id;
  const tokenAdmin = jwt.sign({ id: admin, email: 'admin@t.cl', rol: 'admin' }, process.env.JWT_SECRET);
  await conServidor(async (base) => {
    await post(base, '/api/planes', { tipo: 'mensual', metros: 50, con_materiales: false, direccion: 'Calle 1', fecha_inicio: INICIO }, e.tokenCliente);
    await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });
    const { rows: [plan] } = await e.db.query("SELECT id FROM planes WHERE flow_token='tok-plan-1'");
    const { rows: [primera] } = await e.db.query('SELECT id FROM servicios WHERE plan_id=$1 ORDER BY numero_visita LIMIT 1', [plan.id]);
    await e.db.query("UPDATE servicios SET estado='en_proceso', worker_id=$2 WHERE id=$1", [primera.id, e.worker]);

    const listado = await (await fetch(`${base}/api/admin/planes`, { headers: { Authorization: `Bearer ${tokenAdmin}` } })).json();
    assert.equal(listado[0].visitas_pendientes, 3);
    assert.equal(listado[0].monto_pendiente, 3 * VISITA_PLAN);

    assert.equal((await post(base, `/api/admin/planes/${plan.id}/cancelar`, {}, e.tokenCliente)).status, 403, 'solo el admin');
    const pedidosAntes = pedidosAFlow.filter((p) => p.ruta === '/refund/create').length;
    const r = await post(base, `/api/admin/planes/${plan.id}/cancelar`, {}, tokenAdmin);
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.equal(cuerpo.monto, 3 * VISITA_PLAN);

    const reembolsos = pedidosAFlow.filter((p) => p.ruta === '/refund/create');
    assert.equal(reembolsos.length, pedidosAntes + 1, 'un solo reembolso para las 3 visitas');
    assert.match(reembolsos.at(-1).cuerpo, new RegExp(`amount=${3 * VISITA_PLAN}`));

    const { rows: estados } = await e.db.query('SELECT estado FROM servicios WHERE plan_id=$1 ORDER BY numero_visita', [plan.id]);
    assert.deepEqual(estados.map((s) => s.estado), ['en_proceso', 'reembolsado', 'reembolsado', 'reembolsado']);
    const { rows: [p2] } = await e.db.query('SELECT estado FROM planes WHERE id=$1', [plan.id]);
    assert.equal(p2.estado, 'cancelado');

    // Flow avisa dos veces la misma devolucion: el cliente recibe un solo aviso, por el total.
    await post(base, '/pagos/flow/reembolso-confirmacion', { token: 'ref-1' });
    await post(base, '/pagos/flow/reembolso-confirmacion', { token: 'ref-1' });
    const { rows: avisos } = await e.db.query(
      "SELECT mensaje FROM notificaciones WHERE usuario_id=$1 AND titulo='Tu devolución quedó completa'", [e.cliente]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0].mensaje, new RegExp((3 * VISITA_PLAN).toLocaleString('es-CL').replace('.', '\\.')));

    assert.equal((await post(base, `/api/admin/planes/${plan.id}/cancelar`, {}, tokenAdmin)).status, 400, 'no se cancela dos veces');
  });
});
