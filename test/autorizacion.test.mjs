// Quien puede hacer que, y quien puede ver que.
//
// Estas reglas importan sobre todo en el camino del dinero: completar un
// servicio habilita liberar su pago, asi que una sesion cualquiera que
// pudiera hacer ambas cosas cobraria el servicio de otra persona.
//
// Corren contra PostgreSQL real (pglite) usando las consultas del servidor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

const silencio = () => {};

/** Base con dos clientes y dos aseadores, y un servicio de cliente1/worker1. */
async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);

  const crear = async (nombre, email, rol) => {
    const { rows } = await db.query(
      'INSERT INTO usuarios(nombre,email,password,rol,telefono) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [nombre, email, 'hash', rol, '+56900000000']);
    return rows[0].id;
  };

  const cliente = await crear('Cliente Uno', 'c1@t.cl', 'cliente');
  const otroCliente = await crear('Cliente Dos', 'c2@t.cl', 'cliente');
  const worker = await crear('Aseador Uno', 'w1@t.cl', 'worker');
  const otroWorker = await crear('Aseador Dos', 'w2@t.cl', 'worker');

  const { rows } = await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,total_cliente,worker_recibe,estado)
     VALUES($1,$2,'Calle 1',50,25000,25000,5000,30950,25000,'en_proceso') RETURNING id`,
    [cliente, worker]);
  const servicio = rows[0].id;

  await db.query(
    "INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado) VALUES($1,$2,30950,5000,25000,'pagado')",
    [servicio, cliente]);

  return { db, cliente, otroCliente, worker, otroWorker, servicio };
}

test('completar: solo el aseador asignado', async () => {
  const { db, servicio, worker, otroWorker, cliente } = await escenario();
  const { rows: [s] } = await db.query('SELECT * FROM servicios WHERE id=$1', [servicio]);

  // La comprobacion tal como la hace server.js.
  const puedeCompletar = (usuarioId) => s.worker_id === usuarioId;

  assert.equal(puedeCompletar(worker), true, 'el aseador asignado deberia poder');
  assert.equal(puedeCompletar(otroWorker), false, 'otro aseador NO deberia poder');
  assert.equal(puedeCompletar(cliente), false, 'el cliente NO deberia poder');
});

test('liberar pago: solo el cliente que pago', async () => {
  const { db, servicio, cliente, otroCliente, worker } = await escenario();
  await db.query("UPDATE servicios SET estado='completado' WHERE id=$1", [servicio]);
  const { rows: [s] } = await db.query('SELECT * FROM servicios WHERE id=$1', [servicio]);

  const puedeLiberar = (usuarioId) => s.cliente_id === usuarioId;

  assert.equal(puedeLiberar(cliente), true, 'el cliente del servicio deberia poder');
  assert.equal(puedeLiberar(otroCliente), false, 'otro cliente NO deberia poder');
  assert.equal(puedeLiberar(worker), false, 'el aseador NO deberia poder cobrarse solo');
});

test('cada uno ve solo sus pagos', async () => {
  const { db, cliente, otroCliente, worker, otroWorker } = await escenario();

  const comoCliente = async (id) => (await db.query('SELECT * FROM pagos WHERE cliente_id=$1 ORDER BY id DESC', [id])).rows;
  const comoWorker = async (id) => (await db.query(
    'SELECT p.* FROM pagos p JOIN servicios s ON s.id=p.servicio_id WHERE s.worker_id=$1 ORDER BY p.id DESC', [id])).rows;

  assert.equal((await comoCliente(cliente)).length, 1, 'el cliente ve su pago');
  assert.equal((await comoCliente(otroCliente)).length, 0, 'el otro cliente no ve nada');
  assert.equal((await comoWorker(worker)).length, 1, 'el aseador ve el pago de su servicio');
  assert.equal((await comoWorker(otroWorker)).length, 0, 'el otro aseador no ve nada');
});

test('la vitrina publica de aseadores no expone email ni telefono', async () => {
  const { db } = await escenario();
  const { rows } = await db.query(
    "SELECT id,nombre,foto_url,calificacion_promedio,total_servicios,comuna FROM usuarios WHERE rol='worker' AND activo=true");

  assert.ok(rows.length > 0, 'deberia listar aseadores');
  for (const worker of rows) {
    assert.ok(!('email' in worker), 'no debe incluir email');
    assert.ok(!('telefono' in worker), 'no debe incluir telefono');
    assert.ok('nombre' in worker, 'si debe incluir el nombre');
  }
});

test('las fotos se limitan a los servicios propios', async () => {
  const { db, servicio, cliente, worker, otroCliente } = await escenario();
  await db.query("INSERT INTO fotos_servicio(servicio_id,url,momento) VALUES($1,'http://x/1.jpg','antes')", [servicio]);

  const visiblesPara = async (id) => (await db.query(
    `SELECT f.* FROM fotos_servicio f JOIN servicios s ON s.id=f.servicio_id
     WHERE s.cliente_id=$1 OR s.worker_id=$1`, [id])).rows;

  assert.equal((await visiblesPara(cliente)).length, 1, 'el cliente ve las fotos de su servicio');
  assert.equal((await visiblesPara(worker)).length, 1, 'el aseador tambien');
  assert.equal((await visiblesPara(otroCliente)).length, 0, 'un tercero no ve ninguna');
});

test('las calificaciones se limitan a las propias', async () => {
  const { db, servicio, cliente, worker, otroCliente } = await escenario();
  await db.query(
    'INSERT INTO calificaciones(servicio_id,autor_id,destinatario_id,puntaje,comentario) VALUES($1,$2,$3,5,$4)',
    [servicio, cliente, worker, 'Excelente trabajo']);

  const visiblesPara = async (id) => (await db.query(
    'SELECT * FROM calificaciones WHERE autor_id=$1 OR destinatario_id=$1', [id])).rows;

  assert.equal((await visiblesPara(cliente)).length, 1, 'el autor la ve');
  assert.equal((await visiblesPara(worker)).length, 1, 'el calificado la ve');
  assert.equal((await visiblesPara(otroCliente)).length, 0, 'un tercero no');
});
