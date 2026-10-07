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

test('un plan: cotiza, cobra en Flow, crea las 4 visitas programadas y no duplica al confirmar dos veces', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const cotizacion = await post(base, '/api/planes/cotizar', { tipo: 'mensual', metros: 50, con_materiales: false }, e.tokenCliente);
    assert.equal(cotizacion.status, 200);
    assert.equal((await cotizacion.json()).total, 147800);

    const compra = await post(base, '/api/planes', {
      tipo: 'mensual', metros: 50, con_materiales: false, direccion: 'Calle 1', fecha_inicio: '2026-10-20'
    }, e.tokenCliente);
    assert.equal(compra.status, 200);
    const cobro = await compra.json();
    assert.match(cobro.url_pago, /token=tok-plan-1/);

    const pedido = pedidosAFlow.find((p) => p.ruta === '/payment/create');
    assert.match(pedido.cuerpo, /amount=147800/, 'Flow cobra el total del plan');
    assert.match(pedido.cuerpo, /pagos%2Fflow%2Fplan%2Fconfirmacion|pagos\/flow\/plan\/confirmacion/, 'Flow avisa al webhook del plan');

    const confirmacion = await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });
    assert.equal(confirmacion.status, 200);
    await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });

    const { rows: [plan] } = await e.db.query("SELECT estado, total FROM planes WHERE flow_token='tok-plan-1'");
    assert.equal(plan.estado, 'activo');
    assert.equal(plan.total, 147800);

    const { rows: visitas } = await e.db.query(
      `SELECT estado, numero_visita, (fecha_servicio AT TIME ZONE 'America/Santiago')::date::text AS dia
       FROM servicios WHERE plan_id IS NOT NULL ORDER BY numero_visita`);
    assert.equal(visitas.length, 4, 'confirmar dos veces no crea visitas de mas');
    assert.deepEqual(visitas.map((v) => v.estado), ['programado', 'programado', 'programado', 'programado']);
    assert.deepEqual(visitas.map((v) => v.dia), ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10']);

    const { rows: [pagos] } = await e.db.query(
      "SELECT COUNT(*)::int AS n, SUM(monto_total)::int AS monto, SUM(flow_comision)::int AS fee FROM pagos WHERE servicio_id IN (SELECT id FROM servicios WHERE plan_id IS NOT NULL)");
    assert.equal(pagos.n, 4);
    assert.equal(pagos.monto, 147800);
    assert.equal(pagos.fee, 4272, 'la comision de Flow se reparte completa entre las visitas');
  });
});

test('una visita de plan que no llego se reembolsa por la API de Flow, y el aviso de Flow queda registrado', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await post(base, '/api/planes', { tipo: 'mensual', metros: 50, con_materiales: false, direccion: 'Calle 1', fecha_inicio: '2026-10-20' }, e.tokenCliente);
    await post(base, '/pagos/flow/plan/confirmacion', { token: 'tok-plan-1' });
    const { rows: [visita] } = await e.db.query(
      "SELECT id FROM servicios WHERE plan_id IS NOT NULL ORDER BY numero_visita LIMIT 1");
    await e.db.query(
      "UPDATE servicios SET estado='en_reclamo', worker_id=$2, reclamo_motivo='no_llego', reclamo_en=NOW() WHERE id=$1",
      [visita.id, e.worker]);

    const reembolso = await post(base, `/api/servicios/${visita.id}/pedir-reembolso`, {}, e.tokenCliente);
    assert.equal(reembolso.status, 200);

    const pedido = pedidosAFlow.find((p) => p.ruta === '/refund/create');
    assert.match(pedido.cuerpo, /amount=36950/, 'se devuelve lo que pago esa visita');
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
