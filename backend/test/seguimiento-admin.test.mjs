// El admin ve en un solo lugar las devoluciones que Flow no ha completado y
// los servicios pagados que siguen sin aseador.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

test('agrupa las devoluciones por reembolso, oculta las completadas y lista la bolsa', async () => {
  const db = new PGlite();
  await migrar(db, () => {});
  usarPool(db);
  const nuevo = async (email, rol) => (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,'h',$2,true) RETURNING id", [email, rol])).rows[0].id;
  const admin = await nuevo('admin@t.cl', 'admin');
  const cliente = await nuevo('c@t.cl', 'cliente');
  const servicio = async (estado) => (await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,buscando_desde)
     VALUES($1,'Calle 1',50,28000,28000,11756,2234,41990,28000,$2,NOW()) RETURNING id`, [cliente, estado])).rows[0].id;
  const pago = (servicioId, token, status) => db.query(
    `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,reembolsado_en,flow_refund_token,flow_refund_status)
     VALUES($1,$2,41990,11756,28000,'reembolsado',NOW(),$3,$4)`, [servicioId, cliente, token, status]);
  // Un plan cancelado: dos visitas, un solo reembolso.
  await pago(await servicio('reembolsado'), 'ref-plan', 'created');
  await pago(await servicio('reembolsado'), 'ref-plan', 'created');
  await pago(await servicio('reembolsado'), 'ref-listo', 'refunded');
  await pago(await servicio('reembolsado'), null, null);
  await servicio('buscando_worker');

  const token = jwt.sign({ id: admin, email: 'admin@t.cl', rol: 'admin' }, process.env.JWT_SECRET);
  await conServidor(async (base) => {
    const cliTok = jwt.sign({ id: cliente, email: 'c@t.cl', rol: 'cliente' }, process.env.JWT_SECRET);
    assert.equal((await fetch(`${base}/api/admin/seguimiento`, { headers: { Authorization: `Bearer ${cliTok}` } })).status, 403);
    const s = await (await fetch(`${base}/api/admin/seguimiento`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(s.reembolsos.length, 2, 'el del plan (agrupado) y el manual; el completado no aparece');
    const plan = s.reembolsos.find((r) => r.id === 'ref-plan');
    assert.equal(plan.monto, 2 * 41990);
    assert.equal(s.reembolsos.find((r) => r.manual).manual, true);
    assert.equal(s.sin_aseador.length, 1);
  });
});
