// Liberar un pago escribe en cuatro tablas: pagos, servicios,
// transferencias_trabajador y usuarios. Sin transaccion, una falla a mitad
// —no hay tasa de retencion cargada para el año, se corta la conexion— dejaba
// el pago 'liberado' y el servicio 'pagado' pero SIN transferencia: el
// trabajador no cobraba nunca y no aparecia en ninguna lista del admin, asi
// que nadie se enteraba.
//
// Lo que protegen estas pruebas: si algo falla, no queda nada escrito, y el
// servicio se puede volver a liberar cuando se arregle la causa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const P = createRequire(import.meta.url)('../pagos-trabajador.js');
const servidor = (await import('../server.js')).default;
const { usarPool } = servidor;
const { default: jwt } = await import('jsonwebtoken');

const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-09-22T15:00:00Z');
const silencio = () => {};

/** Servicio terminado y pagado, listo para que se libere el pago. */
async function escenario({ estado = 'completado', completadoHace = 0 } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,$2,$3,true) RETURNING id',
    [email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');
  const servicio = async (token) => {
    const { rows: [s] } = await db.query(
      `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,completado_en)
       VALUES($1,$2,'Calle 1',50,28000,28000,10076,1914,39990,28000,$3,$4) RETURNING id`,
      [cliente, worker, estado, new Date(AHORA.getTime() - completadoHace * HORA)]);
    await db.query(
      `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_fecha_deposito)
       VALUES($1,$2,39990,10076,28000,'pagado',$3,$4)`, [s.id, cliente, token, new Date('2026-09-20T00:00:00Z')]);
    return s.id;
  };
  return { db, cliente, worker, servicio };
}

const comoQuedo = async (db, servicioId) => {
  const { rows: [fila] } = await db.query(
    `SELECT s.estado AS servicio, p.estado AS pago,
            (SELECT count(*)::int FROM transferencias_trabajador t WHERE t.servicio_id=s.id) AS transferencias
     FROM servicios s JOIN pagos p ON p.servicio_id=s.id WHERE s.id=$1`, [servicioId]);
  return fila;
};

// ─── La falla clasica: enero sin tasa de retencion cargada ──────────────────

test('si falla a mitad, el pago no queda liberado sin transferencia', async () => {
  const e = await escenario();
  const servicio = await e.servicio('tok-1');
  // tasaRetencion se consulta DESPUES de marcar el pago liberado y el
  // servicio pagado: es justo la falla que dejaba el pago en el aire.
  await e.db.query('DELETE FROM tasas_retencion');

  await assert.rejects(
    () => P.enTransaccion(e.db, (db) => P.liberarServicio(db, servicio, { origen: 'cliente', ahora: AHORA })),
    /tasa de retencion/);

  assert.deepEqual(await comoQuedo(e.db, servicio), { servicio: 'completado', pago: 'pagado', transferencias: 0 },
    'tras el ROLLBACK todo tiene que seguir como antes de intentar');

  const { rows: [w] } = await e.db.query('SELECT total_servicios FROM usuarios WHERE id=$1', [e.worker]);
  assert.equal(w.total_servicios, 0, 'tampoco se le cuenta el servicio al trabajador');
});

test('arreglada la causa, el mismo servicio se libera sin quedar a medias', async () => {
  const e = await escenario();
  const servicio = await e.servicio('tok-1');
  await e.db.query('DELETE FROM tasas_retencion');
  await assert.rejects(() => P.enTransaccion(e.db, (db) => P.liberarServicio(db, servicio, { origen: 'cliente', ahora: AHORA })));

  await e.db.query('INSERT INTO tasas_retencion(anio,tasa) VALUES(2026,0.1525)');
  const r = await P.enTransaccion(e.db, (db) => P.liberarServicio(db, servicio, { origen: 'cliente', ahora: AHORA }));

  assert.ok(r.transferencia, 'el segundo intento si deja la transferencia');
  assert.deepEqual(await comoQuedo(e.db, servicio), { servicio: 'pagado', pago: 'liberado', transferencias: 1 });
});

// ─── La misma falla, entrando por la ruta que usa el cliente ────────────────

test('POST /api/servicios/:id/confirmar no deja rastro si la liberacion falla', async () => {
  const e = await escenario();
  const servicio = await e.servicio('tok-1');
  await e.db.query('DELETE FROM tasas_retencion');
  usarPool(e.db);

  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/servicios/${servicio}/confirmar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt.sign({ id: e.cliente, email: 'c@t.cl', rol: 'cliente' }, process.env.JWT_SECRET)}`
      }
    });
    assert.equal(res.status, 500, 'el cliente tiene que ver que algo fallo, no un falso "gracias"');
  } finally {
    await new Promise((listo) => s.close(listo));
  }

  assert.deepEqual(await comoQuedo(e.db, servicio), { servicio: 'completado', pago: 'pagado', transferencias: 0 });
});

// ─── El proceso diario: un servicio malo no puede botar a los demas ─────────

test('en la liberacion automatica, un servicio que falla no arrastra a los otros', async () => {
  const e = await escenario({ completadoHace: 30 });
  const malo = await e.servicio('tok-malo');
  const bueno = await e.servicio('tok-bueno');

  // Falla solo al insertar la transferencia del primero: la ultima escritura
  // de la secuencia, con el pago y el servicio ya cambiados.
  const baseQueFalla = {
    query: async (sql, params) => {
      if (/INSERT INTO transferencias_trabajador/.test(sql) && Number(params[1]) === malo) {
        throw new Error('fallo simulado al insertar la transferencia');
      }
      return e.db.query(sql, params);
    }
  };

  const errores = [];
  const original = console.error;
  console.error = (mensaje) => errores.push(String(mensaje));
  let liberados;
  try { liberados = await P.liberarVencidos(baseQueFalla, { ahora: AHORA }); }
  finally { console.error = original; }

  assert.equal(liberados.length, 1, 'el servicio sano igual se libera');
  assert.equal(liberados[0].servicio.id, bueno);
  assert.ok(errores.some((m) => m.includes(`#${malo}`)), 'el que fallo queda registrado con su numero');

  assert.deepEqual(await comoQuedo(e.db, malo), { servicio: 'completado', pago: 'pagado', transferencias: 0 });
  assert.deepEqual(await comoQuedo(e.db, bueno), { servicio: 'pagado', pago: 'liberado', transferencias: 1 });
});

// ─── Reembolsar tambien escribe en dos tablas ───────────────────────────────

test('un reembolso a medias no deja el pago devuelto con el servicio en reclamo', async () => {
  const e = await escenario();
  const servicio = await e.servicio('tok-1');
  await e.db.query("UPDATE servicios SET estado='en_reclamo', reclamo_en=NOW(), reclamo_motivo='no_llego' WHERE id=$1", [servicio]);

  const baseQueFalla = {
    query: async (sql, params) => {
      if (/UPDATE servicios SET estado='reembolsado'/.test(sql)) throw new Error('fallo simulado al cerrar el servicio');
      return e.db.query(sql, params);
    }
  };

  await assert.rejects(
    () => P.enTransaccion(baseQueFalla, (db) => P.resolverReclamo(db, servicio, 'reembolsar', { ahora: AHORA })),
    /fallo simulado/);

  assert.deepEqual(await comoQuedo(e.db, servicio), { servicio: 'en_reclamo', pago: 'pagado', transferencias: 0 },
    'el reclamo sigue abierto y el pago retenido: se puede reintentar');
});
