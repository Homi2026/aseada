// Protege el esquema de desincronizarse de server.js.
//
// Las tablas de Aseada vivieron un tiempo solo como estado manual en una base
// que despues desaparecio, y el repositorio no tenia forma de detectarlo.
// Estas pruebas levantan un PostgreSQL real en memoria (pglite), aplican las
// migraciones y corren contra ellas las mismas consultas que usa el servidor.
//
// Correr con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACIONES = join(RAIZ, 'migrations');

const archivosDeMigracion = () => readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();

/** Base nueva con todas las migraciones aplicadas en orden. */
async function baseMigrada() {
  const db = new PGlite();
  for (const archivo of archivosDeMigracion()) {
    await db.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'));
  }
  return db;
}

test('las migraciones aplican en orden sobre una base vacia', async () => {
  const archivos = archivosDeMigracion();
  assert.ok(archivos.includes('000_schema.sql'), 'falta el esquema base');
  await baseMigrada();
});

test('las migraciones son idempotentes: reaplicarlas no falla', async () => {
  const db = await baseMigrada();
  for (const archivo of archivosDeMigracion()) {
    await db.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'));
  }
});

// Este es el guardia contra la desincronizacion: si alguien agrega una
// consulta a server.js sobre una tabla que no existe en las migraciones, esta
// prueba falla sin que nadie tenga que acordarse de actualizarla.
//
// El escaneo es textual y no distingue codigo de comentarios, asi que una
// consulta comentada tambien la dispara. Es deliberado: preferimos un falso
// positivo, que se ve al instante, a dejar pasar una tabla que falta.
test('toda tabla que consulta server.js existe en el esquema', async () => {
  const codigo = readFileSync(join(RAIZ, 'server.js'), 'utf8');
  const usadas = new Set();
  for (const [, tabla] of codigo.matchAll(/\b(?:FROM|JOIN|INSERT INTO|UPDATE)\s+([a-z_]+)/gi)) {
    // 'IF' viene de `CREATE TABLE IF NOT EXISTS`, no es una tabla.
    if (tabla.toLowerCase() !== 'if') usadas.add(tabla.toLowerCase());
  }
  assert.ok(usadas.size > 0, 'no se detecto ninguna consulta en server.js');

  const db = await baseMigrada();
  const { rows } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  const existentes = new Set(rows.map((r) => r.table_name));

  const faltantes = [...usadas].filter((t) => !existentes.has(t)).sort();
  assert.deepEqual(faltantes, [], `server.js consulta tablas que el esquema no crea: ${faltantes.join(', ')}`);
});

test('el flujo completo corre con las consultas reales de server.js', async () => {
  const db = await baseMigrada();

  const { rows: [cliente] } = await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,telefono,calificacion_promedio,total_servicios,activo) VALUES($1,$2,$3,$4,$5,5.0,0,true) RETURNING id',
    ['Benja', 'cliente@test.cl', 'hash-bcrypt', 'cliente', '+56900000000']);
  const { rows: [worker] } = await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,telefono,calificacion_promedio,total_servicios,activo) VALUES($1,$2,$3,$4,$5,5.0,0,true) RETURNING id',
    ['Aseador', 'worker@test.cl', 'hash-bcrypt', 'worker', '+56911111111']);

  const { rows: [servicio] } = await db.query(
    `INSERT INTO servicios(cliente_id,direccion,fecha_servicio,metros,horas_extra,con_materiales,precio_base,horas_extra_precio,subtotal,comision,iva,total_cliente,worker_recibe,retencion_honorarios,estado,tipo_servicio,tipo_plaga,horas_incluidas)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pendiente_pago',$15,$16,$17) RETURNING *`,
    [cliente.id, 'Av. Siempreviva 742', new Date().toISOString(), 60, 0, false,
     39900, 0, 39900, 7980, 1516, 49396, 39900, 6085, 'fumigacion', 'insectos', null]);
  assert.equal(servicio.estado, 'pendiente_pago');

  // notificarWorkers(): una notificacion por aseador activo.
  const { affectedRows } = await db.query(
    `INSERT INTO notificaciones(usuario_id, tipo, titulo, mensaje, leida, creado_en)
     SELECT id, 'nuevo_servicio', $1, $2, false, NOW() FROM usuarios WHERE rol='worker' AND activo=true`,
    ['Nuevo trabajo disponible', 'Hay un servicio disponible.']);
  assert.equal(affectedRows, 1, 'deberia notificar exactamente al unico worker activo');

  // Ciclo de pago Flow.
  await db.query(
    'INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [servicio.id, cliente.id, 49396, 7980, 39900, 'pendiente', 'tok_abc', 'ASEADA-1-123']);
  await db.query("UPDATE pagos SET estado='pagado', pagado_en=NOW() WHERE flow_token=$1", ['tok_abc']);
  await db.query("UPDATE servicios SET estado='buscando_worker' WHERE id=$1", [servicio.id]);
  await db.query("UPDATE servicios SET estado='en_proceso', worker_id=$1 WHERE id=$2", [worker.id, servicio.id]);
  await db.query("UPDATE servicios SET estado='completado', completado_en=NOW() WHERE id=$1", [servicio.id]);

  const { rows: [liberacion] } = await db.query(
    'SELECT s.*, p.id as pago_id, p.pago_worker, u.email as worker_email FROM servicios s JOIN pagos p ON p.servicio_id=s.id JOIN usuarios u ON u.id=s.worker_id WHERE s.id=$1',
    [servicio.id]);
  assert.equal(liberacion.worker_email, 'worker@test.cl');
  assert.equal(liberacion.pago_worker, 39900);

  // Las tres tablas que hoy solo se leen deben responder, no fallar.
  for (const tabla of ['calificaciones', 'disponibilidad', 'fotos_servicio']) {
    await db.query(`SELECT * FROM ${tabla} ORDER BY id DESC`);
  }
});

test('POST /api/worker/perfil persiste la modalidad del aseador', async () => {
  const db = await baseMigrada();
  const { rows: [worker] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,telefono,calificacion_promedio,total_servicios,activo) VALUES('A','w@t.cl','h','worker','',5.0,0,true) RETURNING id");

  const { rows: [actualizado] } = await db.query(
    `UPDATE usuarios SET modalidad=$1, acepta_boleta=true, comuna=$2, experiencia=$3, perfil_pago_completo=true
     WHERE id=$4 RETURNING perfil_pago_completo, comuna`,
    ['independiente', 'Providencia', '3 anios', worker.id]);
  assert.equal(actualizado.perfil_pago_completo, true);
  assert.equal(actualizado.comuna, 'Providencia');
});

// Los estados validos estan escritos en el JS; estos CHECK evitan que un bug
// deje la base en un estado que el codigo despues no sabe interpretar.
test('la base rechaza valores fuera de los estados validos', async () => {
  const db = await baseMigrada();
  const { rows: [u] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol,telefono,calificacion_promedio,total_servicios,activo) VALUES('A','a@t.cl','h','cliente','',5.0,0,true) RETURNING id");

  const rechaza = async (descripcion, fn) => {
    await assert.rejects(fn, `la base acepto ${descripcion}`);
  };

  await rechaza('un rol inexistente', () => db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('X','x@t.cl','h','admin')"));

  await rechaza('un email repetido', () => db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('X','a@t.cl','h','cliente')"));

  // La modalidad dependiente implicaria relacion laboral, que aun no esta
  // definida: la base no debe permitir declararla todavia.
  await rechaza("modalidad='dependiente'", () => db.query(
    "UPDATE usuarios SET modalidad='dependiente' WHERE id=$1", [u.id]));

  const servicioValido = (extra) => db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,total_cliente,worker_recibe,${extra.col})
     VALUES($1,'Calle 1',50,25000,25000,5000,30950,25000,$2)`, [u.id, extra.valor]);

  await rechaza('un estado de servicio inexistente', () => servicioValido({ col: 'estado', valor: 'en_tramite' }));
  await rechaza('un tipo_servicio inexistente', () => servicioValido({ col: 'tipo_servicio', valor: 'jardineria' }));
  await rechaza('fumigacion sin declarar la plaga', () => servicioValido({ col: 'tipo_servicio', valor: 'fumigacion' }));
});
