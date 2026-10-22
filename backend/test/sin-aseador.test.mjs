// Un servicio pagado que nadie acepta tiene que avisarse: antes quedaba en la
// bolsa para siempre, con el cliente esperando y nadie enterado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

const silencio = () => {};
const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-10-22T18:00:00Z'); // 15:00 en Santiago

async function enLaBolsa({ haceHoras, fechaServicio = null }) {
  const db = new PGlite();
  await migrar(db, silencio);
  const cliente = (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id")).rows[0].id;
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,buscando_desde,fecha_servicio)
     VALUES($1,'Calle 1',50,28000,28000,11756,2234,41990,28000,'buscando_worker',$2,$3) RETURNING id`,
    [cliente, new Date(AHORA.getTime() - haceHoras * HORA), fechaServicio]);
  return { db, servicio: s.id };
}

test('un servicio sin aseador pasado el plazo genera un aviso', async () => {
  const e = await enLaBolsa({ haceHoras: 5 });
  const avisos = await P.serviciosSinAseador(e.db, { ahora: AHORA });
  assert.equal(avisos.length, 1);
});

test('antes del plazo no hay aviso', async () => {
  const e = await enLaBolsa({ haceHoras: 2 });
  assert.equal((await P.serviciosSinAseador(e.db, { ahora: AHORA })).length, 0);
});

test('un servicio para un dia futuro no avisa aunque lleve dias en la bolsa', async () => {
  const e = await enLaBolsa({ haceHoras: 72, fechaServicio: new Date('2026-10-25T15:00:00Z') });
  assert.equal((await P.serviciosSinAseador(e.db, { ahora: AHORA })).length, 0);
});

test('el plazo corre desde el inicio del dia preferido', async () => {
  // Pagado hace 3 dias para hoy: el dia empezo a las 00:00 de Santiago,
  // hace 15 horas, asi que ya paso el plazo.
  const e = await enLaBolsa({ haceHoras: 72, fechaServicio: new Date('2026-10-22T15:00:00Z') });
  assert.equal((await P.serviciosSinAseador(e.db, { ahora: AHORA })).length, 1);
});

test('el aviso sale una sola vez', async () => {
  const e = await enLaBolsa({ haceHoras: 5 });
  await P.serviciosSinAseador(e.db, { ahora: AHORA });
  assert.equal((await P.serviciosSinAseador(e.db, { ahora: AHORA })).length, 0);
});

test('reagendar arranca una busqueda nueva con su propio aviso', async () => {
  const e = await enLaBolsa({ haceHoras: 5 });
  await P.serviciosSinAseador(e.db, { ahora: AHORA });
  const cliente = (await e.db.query('SELECT cliente_id FROM servicios WHERE id=$1', [e.servicio])).rows[0].cliente_id;
  await e.db.query("UPDATE servicios SET estado='en_reclamo', reclamo_motivo='no_llego' WHERE id=$1", [e.servicio]);
  const r = await P.reagendarPorNoLlegada(e.db, e.servicio, cliente, { cuando: 'hoy', ahora: AHORA });
  assert.equal(r.servicio.sin_aseador_alerta_en, null);
  assert.equal(new Date(r.servicio.buscando_desde).getTime(), AHORA.getTime());
  const despues = new Date(AHORA.getTime() + 5 * HORA);
  assert.equal((await P.serviciosSinAseador(e.db, { ahora: despues })).length, 1);
});
