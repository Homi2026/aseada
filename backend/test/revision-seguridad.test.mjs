// Hallazgos de la revision de seguridad de octubre de 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';
process.env.FLOW_API_KEY ||= 'api-prueba';
process.env.FLOW_SECRET_KEY ||= 'secreto-flow-prueba';
process.env.PUBLIC_URL ||= 'https://api.prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');

async function escenario() {
  const db = new PGlite();
  await migrar(db, () => {});
  usarPool(db);
  const nuevo = async (email, rol) => (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,'h',$2,true) RETURNING id", [email, rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');
  const firmar = (id, email, rol) => jwt.sign({ id, email, rol }, process.env.JWT_SECRET);
  return { db, cliente, worker, tokenCliente: firmar(cliente, 'c@t.cl', 'cliente'), tokenWorker: firmar(worker, 'w@t.cl', 'worker') };
}

const servicio = (db, cliente, campos) => db.query(
  `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,workers_excluidos)
   VALUES($1,$2,'Calle 1',50,28000,28000,11756,2234,41990,28000,$3,$4) RETURNING id`,
  [cliente, campos.worker ?? null, campos.estado, campos.excluidos ?? []]).then((r) => r.rows[0].id);

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

test('el aseador no puede marcar terminado un servicio sin haber marcado que llegó', async () => {
  const e = await escenario();
  const id = await servicio(e.db, e.cliente, { worker: e.worker, estado: 'en_proceso' });
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/servicios/${id}/completar`, { method: 'PUT', headers: { Authorization: `Bearer ${e.tokenWorker}` } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /llegaste/);
  });
  const { rows: [s] } = await e.db.query('SELECT estado FROM servicios WHERE id=$1', [id]);
  assert.equal(s.estado, 'en_proceso');
});

test('el listado general tampoco le muestra al aseador excluido el servicio del que lo sacaron', async () => {
  const e = await escenario();
  const excluido = await servicio(e.db, e.cliente, { estado: 'buscando_worker', excluidos: [e.worker] });
  const visible = await servicio(e.db, e.cliente, { estado: 'buscando_worker' });
  await conServidor(async (base) => {
    const lista = await (await fetch(`${base}/api/servicios`, { headers: { Authorization: `Bearer ${e.tokenWorker}` } })).json();
    const ids = lista.map((s) => s.id);
    assert.ok(ids.includes(visible));
    assert.ok(!ids.includes(excluido));
  });
});

test('un plan no puede empezar a mas de 60 dias', async () => {
  const e = await escenario();
  const lejos = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/planes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.tokenCliente}` },
      body: JSON.stringify({ tipo: 'mensual', metros: 50, direccion: 'Calle 1', fecha_inicio: lejos })
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /60 días/);
  });
});

test('un reclamo "no llegó" sobre un servicio que el aseador ya hizo no se devuelve solo', async () => {
  const e = await escenario();
  const id = await servicio(e.db, e.cliente, { worker: e.worker, estado: 'completado' });
  await e.db.query("UPDATE servicios SET llegada_en=NOW() - INTERVAL '4 hours', completado_en=NOW(), aceptado_en=NOW() - INTERVAL '5 hours' WHERE id=$1", [id]);
  await e.db.query("INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado) VALUES($1,$2,41990,11756,28000,'pagado')", [id, e.cliente]);
  await conServidor(async (base) => {
    const post = (ruta, cuerpo) => fetch(base + ruta, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.tokenCliente}` }, body: JSON.stringify(cuerpo)
    });
    assert.equal((await post(`/api/servicios/${id}/reclamo`, { motivo: 'no_llego' })).status, 200, 'reclamar si puede');
    const r = await post(`/api/servicios/${id}/pedir-reembolso`, {});
    assert.equal(r.status, 400, 'pero la devolucion la decide un admin');
  });
  const { rows: [p] } = await e.db.query('SELECT estado FROM pagos WHERE servicio_id=$1', [id]);
  assert.equal(p.estado, 'pagado', 'la plata sigue retenida');
});
