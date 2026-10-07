// El reembolso que Flow no confirma en 72 horas tiene que avisarse a un
// administrador, una sola vez. Un reembolso ya devuelto no genera aviso.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

const silencio = () => {};
const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-10-06T15:00:00Z');

async function reembolso({ haceHoras, estado = null }) {
  const db = new PGlite();
  await migrar(db, silencio);
  const cliente = (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id")).rows[0].id;
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,'Calle 1',50,28000,28000,10076,1914,39990,28000,'reembolsado') RETURNING id`, [cliente]);
  await db.query(
    `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_order,reembolsado_en,flow_refund_token,flow_refund_status)
     VALUES($1,$2,39990,10076,28000,'reembolsado','ORD-1',$3,'tok-ref',$4)`,
    [s.id, cliente, new Date(AHORA.getTime() - haceHoras * HORA), estado]);
  return db;
}

test('un reembolso sin confirmar a las 72 horas genera un aviso', async () => {
  const db = await reembolso({ haceHoras: 80 });
  const avisos = await P.reembolsosSinConfirmar(db, { ahora: AHORA });
  assert.equal(avisos.length, 1);
});

test('el aviso sale una sola vez', async () => {
  const db = await reembolso({ haceHoras: 80 });
  await P.reembolsosSinConfirmar(db, { ahora: AHORA });
  const segunda = await P.reembolsosSinConfirmar(db, { ahora: AHORA });
  assert.equal(segunda.length, 0);
});

test('antes de las 72 horas no hay aviso', async () => {
  const db = await reembolso({ haceHoras: 48 });
  assert.equal((await P.reembolsosSinConfirmar(db, { ahora: AHORA })).length, 0);
});

test('un reembolso ya devuelto por Flow no genera aviso', async () => {
  const db = await reembolso({ haceHoras: 80, estado: 'refunded' });
  assert.equal((await P.reembolsosSinConfirmar(db, { ahora: AHORA })).length, 0);
});
