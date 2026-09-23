// Que dos aseadores no puedan tomar el mismo trabajo.
//
// Los aseadores consultan la bolsa cada 5 segundos, asi que dos pueden ver el
// mismo servicio disponible y aceptarlo con milisegundos de diferencia. La
// ruta miraba el estado con un SELECT y despues escribia sin repetir esa
// condicion: los dos recibian "Trabajo aceptado" y el servicio quedaba del
// ultimo, sin que el primero se enterara de que ya no era suyo.
//
// La carrera se fuerza a proposito: la base de prueba retiene la primera
// escritura hasta que el segundo aseador ya hizo su SELECT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = servidor;
const { default: jwt } = await import('jsonwebtoken');

const silencio = () => {};

/** Un cliente, dos aseadores y un servicio pagado esperando quien lo tome. */
async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,$2,$3,true) RETURNING id',
    [email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const w1 = await nuevo('w1@t.cl', 'worker');
  const w2 = await nuevo('w2@t.cl', 'worker');
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,'Calle 1',50,28000,28000,10076,1914,39990,28000,'buscando_worker') RETURNING id`, [cliente]);
  return { db, cliente, w1, w2, servicio: s.id };
}

/**
 * Base que retiene la escritura de quien llegue primero hasta que los dos
 * aseadores hayan leido el servicio. Asi los dos ven 'buscando_worker' antes
 * de que ninguno escriba: la carrera real, sin depender de la suerte.
 */
function baseConCarrera(db) {
  let leyeron = 0;
  let listo;
  const leyeronLosDos = new Promise((resolver) => { listo = resolver; });
  return {
    query: async (sql, params) => {
      if (/SELECT \* FROM servicios WHERE id=/.test(sql) && ++leyeron === 2) listo();
      if (/^UPDATE servicios SET estado='en_proceso'/.test(sql)) await leyeronLosDos;
      return db.query(sql, params);
    }
  };
}

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const aceptar = (base, servicioId, workerId) => fetch(`${base}/api/worker/aceptar/${servicioId}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ id: workerId, email: `w${workerId}@t.cl`, rol: 'worker' }, process.env.JWT_SECRET)}`
  }
});

test('dos aseadores compitiendo por el mismo servicio: gana uno solo', async () => {
  const e = await escenario();
  usarPool(baseConCarrera(e.db));

  await conServidor(async (base) => {
    const [uno, dos] = await Promise.all([
      aceptar(base, e.servicio, e.w1),
      aceptar(base, e.servicio, e.w2)
    ]);
    const estados = [uno.status, dos.status].sort();
    assert.deepEqual(estados, [200, 400], 'uno acepta y el otro se entera de que llego tarde');

    const rechazado = uno.status === 400 ? uno : dos;
    assert.match((await rechazado.json()).error, /otro aseador/i);

    const ganador = uno.status === 200 ? e.w1 : e.w2;
    const { rows: [s] } = await e.db.query('SELECT worker_id, estado FROM servicios WHERE id=$1', [e.servicio]);
    assert.equal(s.worker_id, ganador, 'el servicio queda del que recibio el 200');
    assert.equal(s.estado, 'en_proceso');
  });
});

test('quien llega cuando el trabajo ya se tomo recibe 400, no lo reasigna', async () => {
  const e = await escenario();
  usarPool(e.db);

  await conServidor(async (base) => {
    assert.equal((await aceptar(base, e.servicio, e.w1)).status, 200);
    const tarde = await aceptar(base, e.servicio, e.w2);
    assert.equal(tarde.status, 400);

    const { rows: [s] } = await e.db.query('SELECT worker_id FROM servicios WHERE id=$1', [e.servicio]);
    assert.equal(s.worker_id, e.w1, 'el segundo no se lo puede quitar al primero');
  });
});

// El token sigue siendo valido hasta que expira, asi que desactivar una
// cuenta no basta si la ruta no lo mira.
test('un aseador desactivado no toma trabajos nuevos', async () => {
  const e = await escenario();
  usarPool(e.db);
  await e.db.query('UPDATE usuarios SET activo=false WHERE id=$1', [e.w1]);

  await conServidor(async (base) => {
    assert.equal((await aceptar(base, e.servicio, e.w1)).status, 403);
    const { rows: [s] } = await e.db.query('SELECT estado, worker_id FROM servicios WHERE id=$1', [e.servicio]);
    assert.equal(s.estado, 'buscando_worker');
    assert.equal(s.worker_id, null);
  });
});
