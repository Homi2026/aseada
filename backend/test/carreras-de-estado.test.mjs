// Las condiciones que se leen con un SELECT y despues no se repiten al
// escribir.
//
// El patron aparecia en tres lugares distintos y en los tres la plata quedaba
// mal:
//
//   1. resolver un reclamo "reembolsando" un servicio que no estaba en
//      reclamo marcaba el pago como devuelto igual, y ese pago ya no se le
//      podia liberar nunca al trabajador;
//   2. el aseador apretando "Terminé" mientras el cliente aprieta "Reportar
//      problema" borraba el reclamo, y a las 24 h el pago se liberaba solo;
//   3. el cliente reclamando justo cuando vence el plazo devolvia a
//      'en_reclamo' un servicio ya pagado y liberado, y el reclamo quedaba
//      pegado para siempre.
//
// Aca se prueban los tres contra PostgreSQL de verdad, interceptando la base
// para meter la otra operacion justo en el hueco.

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

const silencio = () => {};
const AHORA = new Date('2026-09-22T15:00:00Z');

/** Cliente, aseador, administrador y un servicio ya pagado por Flow. */
async function escenario({ estado = 'completado' } = {}) {
  const db = new PGlite();
  await migrar(db, silencio);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,$2,$3,true) RETURNING id',
    [email, 'h', rol])).rows[0].id;
  const cliente = await nuevo('c@t.cl', 'cliente');
  const worker = await nuevo('w@t.cl', 'worker');
  const admin = await nuevo('a@t.cl', 'admin');
  const { rows: [s] } = await db.query(
    `INSERT INTO servicios(cliente_id,worker_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado,completado_en)
     VALUES($1,$2,'Calle 1',50,28000,28000,10076,1914,39990,28000,$3,$4) RETURNING id`,
    // completado_en solo tiene sentido cuando el servicio ya se termino: es
    // lo que mira la liberacion automatica a las 24 h.
    [cliente, worker, estado, estado === 'completado' ? AHORA : null]);
  await db.query(
    `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_order,flow_fecha_deposito)
     VALUES($1,$2,39990,10076,28000,'pagado','tok','ASEADA-1',$3)`, [s.id, cliente, new Date('2026-09-20T00:00:00Z')]);
  return { db, cliente, worker, admin, servicio: s.id };
}

const token = (id, rol) => jwt.sign({ id, email: `${rol}@t.cl`, rol }, process.env.JWT_SECRET);

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const pedir = (base, ruta, { metodo = 'POST', usuario, rol, cuerpo } = {}) => fetch(`${base}${ruta}`, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(usuario, rol)}` },
  body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
});

const comoQuedo = async (db, servicioId) => {
  const { rows: [fila] } = await db.query(
    `SELECT s.estado AS servicio, p.estado AS pago,
            (SELECT count(*)::int FROM transferencias_trabajador t WHERE t.servicio_id=s.id) AS transferencias
     FROM servicios s JOIN pagos p ON p.servicio_id=s.id WHERE s.id=$1`, [servicioId]);
  return fila;
};

/** La misma base, pero corriendo `entrometerse` en la consulta que calce. */
const conIntruso = (db, calza, entrometerse, { antes = false } = {}) => ({
  query: async (sql, params) => {
    if (calza(sql)) {
      if (antes) await entrometerse();
      else {
        const r = await db.query(sql, params);
        await entrometerse();
        return r;
      }
    }
    return db.query(sql, params);
  }
});

// ─── 1. Reembolsar un servicio que no esta en reclamo ───────────────────────

test('reembolsar un servicio que no esta en reclamo no toca la plata', async () => {
  const e = await escenario({ estado: 'completado' });
  usarPool(e.db);

  await conServidor(async (base) => {
    const res = await pedir(base, `/api/admin/servicios/${e.servicio}/resolver`,
      { usuario: e.admin, rol: 'admin', cuerpo: { accion: 'reembolsar' } });
    assert.equal(res.status, 400, 'el admin tiene que ver un error entendible, no un 500');
    assert.match((await res.json()).error, /no está en reclamo/i);
  });

  assert.deepEqual(await comoQuedo(e.db, e.servicio), { servicio: 'completado', pago: 'pagado', transferencias: 0 },
    'un pago marcado "reembolsado" por error queda fuera del indice unico y ya no se le puede liberar al trabajador');

  // Y la prueba de que no quedo impagable: el cliente confirma y se libera.
  const r = await P.enTransaccion(e.db, (db) => P.liberarServicio(db, e.servicio, { origen: 'cliente', ahora: AHORA }));
  assert.ok(r.transferencia, 'el trabajador igual puede cobrar su servicio');
});

test('un servicio todavia en la bolsa tampoco se puede reembolsar por error', async () => {
  const e = await escenario({ estado: 'buscando_worker' });
  await e.db.query('UPDATE servicios SET worker_id=NULL WHERE id=$1', [e.servicio]);
  usarPool(e.db);

  await conServidor(async (base) => {
    const res = await pedir(base, `/api/admin/servicios/${e.servicio}/resolver`,
      { usuario: e.admin, rol: 'admin', cuerpo: { accion: 'reembolsar' } });
    assert.equal(res.status, 400);
  });

  const { rows: [p] } = await e.db.query('SELECT estado FROM pagos WHERE servicio_id=$1', [e.servicio]);
  assert.equal(p.estado, 'pagado', 'el trabajo sigue publicado: el cobro no puede figurar como devuelto');
});

// ─── 2. "Terminé" no puede pisar un reclamo ─────────────────────────────────

test('si el cliente reclama mientras el aseador termina, gana el reclamo', async () => {
  const e = await escenario({ estado: 'en_proceso' });
  // El cliente aprieta "Reportar problema" justo despues de que la ruta leyo
  // el servicio y antes de que lo escriba.
  usarPool(conIntruso(e.db, (sql) => sql === 'SELECT * FROM servicios WHERE id=$1',
    () => P.reclamar(e.db, e.servicio, e.cliente, { motivo: 'no_llego' })));

  await conServidor(async (base) => {
    const res = await pedir(base, `/api/servicios/${e.servicio}/completar`,
      { metodo: 'PUT', usuario: e.worker, rol: 'worker' });
    assert.equal(res.status, 409, 'el aseador tiene que saber que el trabajo no quedo cerrado');
    assert.match((await res.json()).error, /ya no está en proceso/i);
  });

  const { rows: [s] } = await e.db.query('SELECT estado, completado_en FROM servicios WHERE id=$1', [e.servicio]);
  assert.equal(s.estado, 'en_reclamo', 'el reclamo tiene que seguir en pie para que el admin lo vea');
  assert.equal(s.completado_en, null, 'sin completado_en la liberacion automatica no lo toca a las 24 h');
});

// ─── 3. Reclamar no puede resucitar un pago ya liberado ─────────────────────

test('si el pago se libera mientras el cliente reclama, el reclamo se rechaza', async () => {
  const e = await escenario({ estado: 'completado' });
  // Vence el plazo y corre la liberacion automatica justo antes de que el
  // reclamo escriba.
  const base = conIntruso(e.db, (sql) => /UPDATE servicios SET estado='en_reclamo'/.test(sql),
    () => P.enTransaccion(e.db, (db) => P.liberarServicio(db, e.servicio, { origen: 'automatica', ahora: AHORA })),
    { antes: true });

  const r = await P.reclamar(base, e.servicio, e.cliente, { motivo: 'no_llego' });

  assert.equal(r.status, 409, 'no se le puede decir "tu pago queda retenido" con la plata ya girada');
  assert.match(r.error, /ya no admite reclamos/i);
  assert.deepEqual(await comoQuedo(e.db, e.servicio), { servicio: 'pagado', pago: 'liberado', transferencias: 1 },
    'el servicio queda como lo dejo la liberacion, no en un reclamo del que no se sale');
});

// ─── 4. La bandera de datos de pago dice la verdad ──────────────────────────

test('sin RUT ni cuenta, el perfil del aseador no figura como completo', async () => {
  const e = await escenario();
  usarPool(e.db);

  await conServidor(async (b) => {
    const res = await pedir(b, '/api/worker/perfil', { usuario: e.worker, rol: 'worker', cuerpo: {
      modalidad: 'independiente', acepta_boleta: true, comuna: 'Ñuñoa', experiencia: 'algo'
    } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).perfil_pago_completo, false,
      'el admin no puede activar a un aseador creyendo que se le puede transferir');

    const workers = await (await pedir(b, '/api/admin/workers', { metodo: 'GET', usuario: e.admin, rol: 'admin' })).json();
    assert.equal(workers.find((w) => w.id === e.worker).perfil_pago_completo, false);

    // Con los tres datos que la lista de transferencias exige, si.
    const completo = await pedir(b, '/api/worker/perfil', { usuario: e.worker, rol: 'worker', cuerpo: {
      modalidad: 'independiente', acepta_boleta: true, comuna: 'Ñuñoa', experiencia: 'algo',
      rut: '12.345.678-9', banco: 'BancoEstado', tipo_cuenta: 'vista', numero_cuenta: '123456789'
    } });
    assert.equal((await completo.json()).perfil_pago_completo, true);
  });

  // La misma definicion que usa la lista de transferencias del admin: una
  // sola idea de "datos de pago completos" en todo el producto.
  const { rows: [u] } = await e.db.query(
    'SELECT (rut IS NOT NULL AND banco IS NOT NULL AND numero_cuenta IS NOT NULL) AS datos, perfil_pago_completo FROM usuarios WHERE id=$1',
    [e.worker]);
  assert.equal(u.perfil_pago_completo, u.datos);
});
