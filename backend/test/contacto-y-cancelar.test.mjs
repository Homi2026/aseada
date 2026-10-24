// Dos huecos que veia el usuario: el cliente no sabia quien iba a su casa, y
// no podia cancelar un servicio que nadie habia tomado todavia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

const require = createRequire(import.meta.url);
const P = require('../pagos-trabajador.js');

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');

async function escenario() {
  const db = new PGlite();
  await migrar(db, () => {});
  usarPool(db);
  const nuevo = async (email, rol, telefono) => (await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,telefono,activo,calificacion_promedio,total_servicios) VALUES($1,$2,'h',$3,$4,true,4.8,7) RETURNING id",
    [`Nombre ${email}`, email, rol, telefono])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente', '+56911111111');
  // Cadena vacia: telefono es NOT NULL DEFAULT '', asi que "sin telefono" es ''.
  const otroCliente = await nuevo('c2@t.cl', 'cliente', '');
  const worker = await nuevo('w@t.cl', 'worker', '+56922222222');
  const servicio = async (estado, workerId = null) => (await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,$2,'Calle 1',50,28000,28000,11756,2234,41990,28000,$3) RETURNING id`, [cliente, workerId, estado])).rows[0].id;
  const firmar = (id, email, rol) => jwt.sign({ id, email, rol }, process.env.JWT_SECRET);
  return { db, cliente, otroCliente, worker, servicio,
    tokenCliente: firmar(cliente, 'c@t.cl', 'cliente'), tokenWorker: firmar(worker, 'w@t.cl', 'worker') };
}

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const misServicios = (base, token) => fetch(`${base}/api/mis-servicios`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

test('el cliente ve el nombre, teléfono y calificación del aseador que tomó su servicio', async () => {
  const e = await escenario();
  await e.servicio('en_proceso', e.worker);
  await conServidor(async (base) => {
    const [s] = await misServicios(base, e.tokenCliente);
    assert.equal(s.worker_nombre, 'Nombre w@t.cl');
    assert.equal(s.worker_telefono, '+56922222222');
    assert.equal(Number(s.worker_calificacion), 4.8);
    assert.equal(s.worker_total_servicios, 7);
  });
});

test('mientras nadie lo toma, no hay aseador que mostrar', async () => {
  const e = await escenario();
  await e.servicio('buscando_worker');
  await conServidor(async (base) => {
    const [s] = await misServicios(base, e.tokenCliente);
    assert.equal(s.worker_nombre, null);
  });
});

test('el aseador ve el contacto del cliente de su propio trabajo', async () => {
  const e = await escenario();
  await e.servicio('en_proceso', e.worker);
  await conServidor(async (base) => {
    const [s] = await misServicios(base, e.tokenWorker);
    assert.equal(s.cliente_nombre, 'Nombre c@t.cl');
    assert.equal(s.cliente_telefono, '+56911111111');
  });
});

test('cancelar un servicio pagado que nadie tomó devuelve el dinero', async () => {
  const e = await escenario();
  const id = await e.servicio('buscando_worker');
  await e.db.query("INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_order) VALUES($1,$2,41990,11756,28000,'pagado','ORD-1')", [id, e.cliente]);
  const r = await P.enTransaccion(e.db, (db) => P.cancelarServicio(db, id, e.cliente));
  assert.equal(r.servicio.estado, 'reembolsado');
  assert.equal(r.pago.estado, 'reembolsado');
  assert.ok(r.pago.reembolsado_en);
});

test('cancelar sin haber pagado no devuelve nada y cierra la orden pendiente', async () => {
  const e = await escenario();
  const id = await e.servicio('pendiente_pago');
  await e.db.query("INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token) VALUES($1,$2,41990,11756,28000,'pendiente','tok')", [id, e.cliente]);
  const r = await P.enTransaccion(e.db, (db) => P.cancelarServicio(db, id, e.cliente));
  assert.equal(r.servicio.estado, 'reembolsado');
  assert.equal(r.pago, null);
  const { rows: [p] } = await e.db.query('SELECT estado FROM pagos WHERE servicio_id=$1', [id]);
  assert.equal(p.estado, 'rechazado', 'la orden de Flow no debe quedar viva');
});

test('no se cancela un servicio que ya tiene aseador, ni el de otro cliente, ni una visita de plan', async () => {
  const e = await escenario();
  const conAseador = await e.servicio('en_proceso', e.worker);
  assert.equal((await P.cancelarServicio(e.db, conAseador, e.cliente)).status, 400);

  const propio = await e.servicio('buscando_worker');
  assert.equal((await P.cancelarServicio(e.db, propio, e.otroCliente)).status, 403);

  const { rows: [plan] } = await e.db.query(
    `INSERT INTO planes(cliente_id,tipo,direccion,metros,visitas,fecha_inicio,precio_visita,total,estado)
     VALUES($1,'mensual','Calle 1',50,4,CURRENT_DATE,36950,147800,'activo') RETURNING id`, [e.cliente]);
  await e.db.query('UPDATE servicios SET plan_id=$2 WHERE id=$1', [propio, plan.id]);
  assert.equal((await P.cancelarServicio(e.db, propio, e.cliente)).status, 400);
});

test('editar el perfil cambia nombre y teléfono, valida, y no permite cambiar el email', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const guardar = (cuerpo, token = e.tokenCliente) => fetch(`${base}/api/usuarios/perfil`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo)
    });
    assert.equal((await guardar({ nombre: 'A' })).status, 400, 'nombre demasiado corto');
    assert.equal((await guardar({ nombre: 'Benjamín López', telefono: 'cuatro cuatro' })).status, 400, 'telefono con letras');
    assert.equal((await fetch(`${base}/api/usuarios/perfil`, { method: 'POST' })).status, 401, 'sin sesion');

    const r = await guardar({ nombre: 'Benjamín López', telefono: '+56 9 1234 5678', email: 'otro@t.cl' });
    assert.equal(r.status, 200);
    const { usuario } = await r.json();
    assert.equal(usuario.nombre, 'Benjamín López');
    assert.equal(usuario.telefono, '+56 9 1234 5678');
    assert.equal(usuario.email, 'c@t.cl', 'el email no se cambia aunque venga en el cuerpo');
  });
});

test('la disponibilidad exige sesión: son horarios y nombres de aseadores', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    assert.equal((await fetch(`${base}/api/disponibilidad`)).status, 401);
    assert.equal((await fetch(`${base}/api/disponibilidad`, { headers: { Authorization: `Bearer ${e.tokenCliente}` } })).status, 200);
  });
});
