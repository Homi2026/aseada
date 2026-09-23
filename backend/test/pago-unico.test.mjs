// Que un servicio no se pueda cobrar dos veces.
//
// /api/pagos/crear creaba una orden nueva en Flow en cada llamada: el cliente
// que tocaba "Pagar" dos veces pagaba dos veces, y al liberar el segundo pago
// quedaba huerfano (nadie lo veia, nadie lo devolvia). Aca se prueban las
// tres defensas: la ruta reusa la orden pendiente, la base no acepta dos
// cobros vivos del mismo servicio, y la confirmacion de Flow sobrevive a esa
// restriccion marcando el cobro de mas como 'duplicado' en vez de reventar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';
// Con las variables de Flow puestas las rutas de pago responden de verdad;
// las llamadas a Flow se interceptan mas abajo.
process.env.FLOW_API_KEY = 'llave-de-prueba';
process.env.FLOW_SECRET_KEY = 'secreto-de-prueba';
// Apunta a un puerto cerrado a proposito: si el doble de axios dejara de
// aplicarse, la prueba falla al instante en vez de salir a Flow de verdad.
process.env.FLOW_API_URL = 'http://127.0.0.1:9/api';
process.env.PUBLIC_URL = 'https://api.aseada.test';

const servidor = (await import('../server.js')).default;
const { usarPool } = servidor;
const { default: jwt } = await import('jsonwebtoken');
// Por require y no por import: server.js usa el axios de CommonJS, y el
// import de ESM entrega otra copia del modulo. Reemplazar la copia
// equivocada deja las pruebas llamando a Flow de verdad.
const axios = createRequire(import.meta.url)('axios');

const silencio = () => {};

// ─── Flow de mentira ────────────────────────────────────────────────────────
// server.js habla con Flow por axios; se reemplazan sus dos metodos para
// contar ordenes creadas sin salir a internet.
const flow = { ordenesCreadas: 0, estado: 1, caido: false };
axios.post = async (url) => {
  if (url.endsWith('/payment/create')) {
    flow.ordenesCreadas += 1;
    // Flow devuelve el pay.php del mismo ambiente al que se le pidio la
    // orden; de ahi lo reconstruye server.js cuando reusa una pendiente.
    return { data: { url: `${process.env.FLOW_API_URL.replace(/\/api$/, '')}/app/web/pay.php`, token: `tok-${flow.ordenesCreadas}`, flowOrder: 9000 + flow.ordenesCreadas } };
  }
  // Los push de Expo: no interesan aca.
  return { data: {} };
};
axios.get = async (url) => {
  // Flow caido, o un token que ya no reconoce (se rotaron las llaves, o la
  // orden se creo en sandbox y ahora se pregunta en produccion).
  if (flow.caido) throw new Error('Flow no responde');
  if (url.endsWith('/payment/getStatus')) return { data: { status: flow.estado, paymentData: {} } };
  throw new Error(`llamada inesperada a ${url}`);
};

/** Cliente con un servicio recien creado, esperando el pago. */
async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,$2,$3,true) RETURNING id',
    [email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const admin = await nuevo('admin@t.cl', 'admin');
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,'Calle 1',50,28000,28000,10076,1914,39990,28000,'pendiente_pago') RETURNING id`, [cliente]);
  flow.ordenesCreadas = 0;
  flow.estado = 1;
  flow.caido = false;
  usarPool(db);
  return { db, cliente, admin, servicio: s.id };
}

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const crearPago = (base, servicioId, clienteId) => fetch(`${base}/api/pagos/crear`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ id: clienteId, email: 'c@t.cl', rol: 'cliente' }, process.env.JWT_SECRET)}`
  },
  body: JSON.stringify({ servicio_id: servicioId })
});

const confirmacion = (base, token) => fetch(`${base}/pagos/flow/confirmacion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token }).toString()
});

// ─── 1. La ruta no crea la segunda orden ────────────────────────────────────

test('tocar "Pagar" dos veces crea una sola orden en Flow', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const primera = await (await crearPago(base, e.servicio, e.cliente)).json();
    const segunda = await (await crearPago(base, e.servicio, e.cliente)).json();

    assert.equal(flow.ordenesCreadas, 1, 'la segunda llamada debe reusar la orden, no crear otra');
    assert.equal(segunda.url_pago, primera.url_pago, 'el cliente vuelve al mismo link de pago');
    assert.match(segunda.url_pago, /token=tok-1/);

    const { rows } = await e.db.query('SELECT * FROM pagos WHERE servicio_id=$1', [e.servicio]);
    assert.equal(rows.length, 1, 'un solo pago registrado para el servicio');
  });
});

test('si la orden pendiente ya se pago, no se crea otra: se avisa', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await crearPago(base, e.servicio, e.cliente);
    flow.estado = 2; // Flow ya la cobro, la confirmacion todavia no llega.
    const res = await crearPago(base, e.servicio, e.cliente);

    assert.equal(res.status, 409);
    assert.equal(flow.ordenesCreadas, 1);
    assert.match((await res.json()).error, /ya recibimos el pago/i);
  });
});

test('una orden rechazada por Flow si se puede reintentar', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await crearPago(base, e.servicio, e.cliente);
    flow.estado = 3; // rechazada: ese link ya no sirve para pagar.
    const res = await (await crearPago(base, e.servicio, e.cliente)).json();

    assert.equal(flow.ordenesCreadas, 2, 'con la orden muerta hay que crear una nueva');
    assert.match(res.url_pago, /token=tok-2/);
    const { rows } = await e.db.query("SELECT estado FROM pagos WHERE servicio_id=$1 ORDER BY id", [e.servicio]);
    assert.deepEqual(rows.map((r) => r.estado), ['rechazado', 'pendiente']);
  });
});

// Si no se puede preguntar por la orden, no se sabe si esta pagada. Entregar
// igual el link viejo dejaba al cliente pegado: mientras Flow no reconozca ese
// token, cada clic en Pagar devuelve el mismo link muerto y nunca se crea una
// orden nueva. Que reintente es mas seguro que eso, y no arriesga cobro doble.
test('si Flow no contesta, no se entrega un link que puede estar muerto', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await crearPago(base, e.servicio, e.cliente);
    flow.caido = true;

    const res = await crearPago(base, e.servicio, e.cliente);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /no pudimos verificar tu orden/i);
    assert.equal(flow.ordenesCreadas, 1, 'tampoco se crea otra orden: seria arriesgar el cobro doble');
  });
});

// El caso que atrapaba de verdad no es la caida pasajera: es el token que Flow
// no va a reconocer nunca mas. Pasado el tiempo de vida de una orden, una que
// sigue 'pendiente' no se va a pagar (si se hubiera pagado, la confirmacion ya
// habria llegado), asi que se cierra y se crea una nueva.
test('una orden vieja que Flow no reconoce no deja al cliente sin poder pagar', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await crearPago(base, e.servicio, e.cliente);
    await e.db.query("UPDATE pagos SET creado_en = NOW() - INTERVAL '3 hours' WHERE servicio_id=$1", [e.servicio]);
    flow.caido = true;

    const res = await (await crearPago(base, e.servicio, e.cliente)).json();
    assert.equal(flow.ordenesCreadas, 2, 'con la orden vencida hay que crear una nueva');
    assert.match(res.url_pago, /token=tok-2/);
  });

  const { rows } = await e.db.query('SELECT estado FROM pagos WHERE servicio_id=$1 ORDER BY id', [e.servicio]);
  assert.deepEqual(rows.map((r) => r.estado), ['rechazado', 'pendiente'],
    'la orden vieja queda cerrada, no compitiendo con la nueva');
});

// ─── 2. La base tampoco lo permite ──────────────────────────────────────────

test('el indice unico rechaza el segundo pago cobrado del mismo servicio', async () => {
  const e = await escenario();
  const pago = (token, estado) => e.db.query(
    'INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token) VALUES($1,$2,39990,10076,28000,$3,$4)',
    [e.servicio, e.cliente, estado, token]);

  await pago('tok-a', 'pagado');
  await assert.rejects(() => pago('tok-b', 'pagado'), (error) => error.code === '23505',
    'la base no puede aceptar dos cobros vivos del mismo servicio');
  // Liberado tambien cuenta como cobro vivo: es plata que no se devolvio.
  await assert.rejects(() => pago('tok-c', 'liberado'), (error) => error.code === '23505');
  // Los que no representan plata retenida si pueden repetirse.
  await pago('tok-d', 'pendiente');
  await pago('tok-e', 'rechazado');
  await pago('tok-f', 'duplicado');
});

// ─── 3. La confirmacion de Flow no revienta con el cobro de mas ─────────────

test('un cobro duplicado se marca y se avisa, y Flow recibe 200', async () => {
  const e = await escenario();
  const pago = (token, estado) => e.db.query(
    'INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_order) VALUES($1,$2,39990,10076,28000,$3,$4,$5)',
    [e.servicio, e.cliente, estado, token, `ASEADA-${e.servicio}-${token}`]);
  await pago('tok-bueno', 'pagado');
  await pago('tok-de-mas', 'pendiente');
  flow.estado = 2;

  await conServidor(async (base) => {
    const res = await confirmacion(base, 'tok-de-mas');
    assert.equal(res.status, 200, 'si no es 200, Flow reintenta el aviso para siempre');
    assert.deepEqual(await res.json(), { ok: true });
  });

  const { rows } = await e.db.query('SELECT flow_token, estado, duplicado_en FROM pagos WHERE servicio_id=$1 ORDER BY id', [e.servicio]);
  assert.deepEqual(rows.map((r) => [r.flow_token, r.estado]), [['tok-bueno', 'pagado'], ['tok-de-mas', 'duplicado']]);
  assert.ok(rows[1].duplicado_en, 'queda cuando se detecto, para la devolucion');

  const { rows: avisos } = await e.db.query("SELECT usuario_id FROM notificaciones WHERE tipo='pago_duplicado'");
  assert.ok(avisos.some((a) => a.usuario_id === e.admin), 'el administrador tiene que devolverlo en el panel de Flow');
  assert.ok(avisos.some((a) => a.usuario_id === e.cliente), 'y el cliente tiene que saber que se le devuelve');
});
