// La migracion 003 tiene que poder aplicarse sobre una base que YA cobro dos
// veces el mismo servicio.
//
// El indice unico no se puede crear si esos duplicados siguen ahi, y una
// migracion que falla deja el resto del archivo sin aplicar. Asi que primero
// limpia: deja vivo un solo cobro por servicio y marca el resto como
// 'duplicado' para que aparezcan y se devuelvan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const archivos = () => readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
const ARCHIVO_003 = archivos().find((f) => f.startsWith('003_'));

const aplicar = (db, archivo) => db.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'));

/** Base con todo lo anterior a la 003 aplicado: el mundo antes del arreglo. */
async function baseAntesDeLa003() {
  const db = new PGlite();
  for (const archivo of archivos()) {
    if (archivo === ARCHIVO_003) break;
    await aplicar(db, archivo);
  }
  const { rows: [cliente] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id");
  const { rows: [admin] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('A','a@t.cl','h','admin') RETURNING id");
  // Un admin dado de baja no tiene que recibir tareas nuevas.
  await db.query("INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES('X','x@t.cl','h','admin',false)");
  const servicio = async (estado) => (await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,'Calle 1',50,28000,28000,10076,1914,39990,28000,$2) RETURNING id`, [cliente.id, estado])).rows[0].id;
  const pago = (servicioId, token, estado, creadoEn) => db.query(
    `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_order,creado_en)
     VALUES($1,$2,39990,10076,28000,$3,$4,$5,$6)`,
    [servicioId, cliente.id, estado, token, `ASEADA-${servicioId}-${token}`, creadoEn]);
  return { db, cliente: cliente.id, admin: admin.id, servicio, pago };
}

const estados = async (db, servicioId) => (await db.query(
  'SELECT flow_token, estado FROM pagos WHERE servicio_id=$1 ORDER BY creado_en, id', [servicioId])).rows;

test('la 003 limpia los cobros duplicados que ya existian y despues crea el indice', async () => {
  const b = await baseAntesDeLa003();
  const servicio = await b.servicio('completado');
  // Antes del arreglo esto era posible: el cliente pago dos veces.
  await b.pago(servicio, 'tok-primero', 'pagado', '2026-09-20T10:00:00Z');
  await b.pago(servicio, 'tok-segundo', 'pagado', '2026-09-20T10:03:00Z');
  await b.pago(servicio, 'tok-tercero', 'pagado', '2026-09-20T10:05:00Z');

  await aplicar(b.db, ARCHIVO_003);

  assert.deepEqual(await estados(b.db, servicio), [
    { flow_token: 'tok-primero', estado: 'pagado' },
    { flow_token: 'tok-segundo', estado: 'duplicado' },
    { flow_token: 'tok-tercero', estado: 'duplicado' }
  ], 'queda vivo el mas antiguo; los demas hay que devolverlos');

  // Y con la base ya limpia, el indice impide que vuelva a pasar.
  await assert.rejects(() => b.pago(servicio, 'tok-cuarto', 'pagado', '2026-09-21T10:00:00Z'),
    (error) => error.code === '23505');
});

// Un pago 'liberado' ya tiene una transferencia al trabajador colgando de el:
// marcarlo duplicado dejaria esa transferencia apuntando a plata que decimos
// que hay que devolver.
test('si uno de los duplicados ya se libero, ese es el que sobrevive', async () => {
  const b = await baseAntesDeLa003();
  const servicio = await b.servicio('pagado');
  await b.pago(servicio, 'tok-viejo', 'pagado', '2026-09-20T10:00:00Z');
  await b.pago(servicio, 'tok-liberado', 'liberado', '2026-09-20T10:04:00Z');

  await aplicar(b.db, ARCHIVO_003);

  assert.deepEqual(await estados(b.db, servicio), [
    { flow_token: 'tok-viejo', estado: 'duplicado' },
    { flow_token: 'tok-liberado', estado: 'liberado' }
  ]);
});

test('los pagos que no son cobros vivos quedan como estaban', async () => {
  const b = await baseAntesDeLa003();
  const servicio = await b.servicio('pendiente_pago');
  await b.pago(servicio, 'tok-1', 'pendiente', '2026-09-20T10:00:00Z');
  await b.pago(servicio, 'tok-2', 'rechazado', '2026-09-20T10:01:00Z');
  await b.pago(servicio, 'tok-3', 'pendiente', '2026-09-20T10:02:00Z');

  await aplicar(b.db, ARCHIVO_003);

  assert.deepEqual((await estados(b.db, servicio)).map((p) => p.estado),
    ['pendiente', 'rechazado', 'pendiente'],
    'el indice es parcial: solo le importan los cobros que retienen plata');
});

test('reaplicar la 003 sobre una base ya limpia no cambia nada ni falla', async () => {
  const b = await baseAntesDeLa003();
  const servicio = await b.servicio('completado');
  await b.pago(servicio, 'tok-unico', 'pagado', '2026-09-20T10:00:00Z');

  await aplicar(b.db, ARCHIVO_003);
  await aplicar(b.db, ARCHIVO_003);

  assert.deepEqual(await estados(b.db, servicio), [{ flow_token: 'tok-unico', estado: 'pagado' }]);
});

// Marcar el pago y nada mas dejaba la plata del cliente etiquetada en una
// tabla que nadie mira: no hay ninguna ruta que liste los pagos en
// 'duplicado'. El aviso es lo unico que hace que alguien los devuelva.
test('la 003 avisa al administrador y al cliente por cada cobro de mas', async () => {
  const b = await baseAntesDeLa003();
  const servicio = await b.servicio('completado');
  await b.pago(servicio, 'tok-primero', 'pagado', '2026-09-20T10:00:00Z');
  await b.pago(servicio, 'tok-segundo', 'pagado', '2026-09-20T10:03:00Z');

  await aplicar(b.db, ARCHIVO_003);

  const { rows: avisos } = await b.db.query(
    "SELECT usuario_id, titulo, mensaje FROM notificaciones WHERE tipo='pago_duplicado' ORDER BY id");
  assert.equal(avisos.length, 2, 'uno para el admin activo y uno para el cliente');

  const alAdmin = avisos.find((a) => a.usuario_id === b.admin);
  assert.equal(alAdmin.titulo, 'Hay que devolver un cobro duplicado');
  assert.equal(alAdmin.mensaje,
    `El servicio #${servicio} se cobró dos veces. Devuelve $39.990 en el panel de Flow: orden ASEADA-${servicio}-tok-segundo.`,
    'tiene que decir cual orden devolver, y los montos como los escribe la app');

  const alCliente = avisos.find((a) => a.usuario_id === b.cliente);
  assert.equal(alCliente.titulo, 'Te cobramos dos veces');
  assert.match(alCliente.mensaje, new RegExp(`Recibimos dos pagos del servicio #${servicio}\\. Te devolvemos \\$39\\.990;`));
});

test('sin cobros duplicados la 003 no inventa avisos', async () => {
  const b = await baseAntesDeLa003();
  const servicio = await b.servicio('completado');
  await b.pago(servicio, 'tok-unico', 'pagado', '2026-09-20T10:00:00Z');

  await aplicar(b.db, ARCHIVO_003);
  await aplicar(b.db, ARCHIVO_003);

  const { rows: [{ total }] } = await b.db.query("SELECT count(*)::int AS total FROM notificaciones");
  assert.equal(total, 0, 'reaplicarla tampoco puede duplicar avisos');
});
