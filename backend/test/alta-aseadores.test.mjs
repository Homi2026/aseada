// Quien se registra como aseador no entra solo, y la direccion del cliente no
// se reparte a cualquiera.
//
// Antes: `activo` nacia en TRUE, /auth/registro aceptaba rol 'worker' sin
// revision alguna, y la bolsa devolvia SELECT * de todos los servicios pagados
// CON la direccion completa. Una cuenta nueva -- tres campos en un formulario
// -- daba la lista de donde viven los clientes que ya pagaron.
//
// Corre contra PostgreSQL real (pglite) y el servidor real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool, reiniciarLimiteIntentos } = servidor;
const { default: jwt } = await import('jsonwebtoken');

const silencio = () => {};
const token = (id, rol) => jwt.sign({ id, email: `u${id}@t.cl`, rol }, process.env.JWT_SECRET);

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const pedir = (base, metodo, ruta, { sesion, cuerpo } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...(sesion && { Authorization: `Bearer ${sesion}` }) },
  // GET no lleva cuerpo: fetch lanza si se lo pones.
  ...(cuerpo !== undefined && metodo !== 'GET' && { body: JSON.stringify(cuerpo) })
});

/** Base migrada, con un cliente, un administrador y un servicio ya pagado. */
async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  reiniciarLimiteIntentos();

  const nuevo = async (nombre, email, rol, activo = true) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [nombre, email, 'hash', rol, activo])).rows[0].id;

  const cliente = await nuevo('Cliente', 'c@t.cl', 'cliente');
  const admin = await nuevo('Jefa', 'admin@t.cl', 'admin');
  const { rows: [servicio] } = await db.query(
    `INSERT INTO servicios(cliente_id,direccion,metros,precio_base,subtotal,comision,iva,total_cliente,worker_recibe,estado)
     VALUES($1,'Los Aromos 1234, depto 51, Nunoa',50,28000,28000,10076,1914,39990,28000,'buscando_worker') RETURNING id`,
    [cliente]);

  return { db, cliente, admin, servicio: servicio.id, nuevo };
}

const registrar = (base, rol, email = 'nuevo@t.cl') => pedir(base, 'POST', '/auth/registro', {
  cuerpo: { nombre: 'Persona Nueva', email, password: 'clave-larga-123', rol, telefono: '+56911111111' }
});

// ─── El alta ────────────────────────────────────────────────────────────────

test('un aseador recien registrado queda inactivo; un cliente no', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const aseador = await (await registrar(base, 'worker', 'aseador@t.cl')).json();
    assert.equal(aseador.usuario.activo, false, 'el aseador deberia quedar en revision');
    assert.match(aseador.mensaje, /revisamos/i, 'y el mensaje deberia decirselo');

    const cliente = await (await registrar(base, 'cliente', 'clienta@t.cl')).json();
    assert.equal(cliente.usuario.activo, true, 'el cliente entra activo');

    const { rows } = await e.db.query("SELECT activo FROM usuarios WHERE email='aseador@t.cl'");
    assert.equal(rows[0].activo, false, 'y queda asi en la base, no solo en la respuesta');
  });
});

test('el login devuelve si la cuenta esta activa', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    await registrar(base, 'worker', 'aseador@t.cl');
    const res = await pedir(base, 'POST', '/auth/login', {
      cuerpo: { email: 'aseador@t.cl', password: 'clave-larga-123' }
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).usuario.activo, false);
  });
});

// ─── La puerta ──────────────────────────────────────────────────────────────

test('un aseador en revision no ve la bolsa ni puede aceptar trabajos', async () => {
  const e = await escenario();
  const enRevision = await e.nuevo('En revision', 'w@t.cl', 'worker', false);

  await conServidor(async (base) => {
    for (const [metodo, ruta] of [['GET', '/api/worker/disponibles'], ['POST', `/api/worker/aceptar/${e.servicio}`]]) {
      const res = await pedir(base, metodo, ruta, { sesion: token(enRevision, 'worker') });
      assert.equal(res.status, 403, `${ruta} deberia cerrarse`);
      assert.match((await res.json()).error, /revisión/i, `${ruta} deberia explicar por que`);
    }
    // Y el trabajo sigue libre: no se lo asigno igual.
    const { rows: [s] } = await e.db.query('SELECT estado, worker_id FROM servicios WHERE id=$1', [e.servicio]);
    assert.equal(s.estado, 'buscando_worker');
    assert.equal(s.worker_id, null);
  });
});

test('el historial de un aseador en revision no le filtra la bolsa', async () => {
  const e = await escenario();
  const enRevision = await e.nuevo('En revision', 'w@t.cl', 'worker', false);

  await conServidor(async (base) => {
    const res = await pedir(base, 'GET', '/api/servicios', { sesion: token(enRevision, 'worker') });
    assert.equal(res.status, 200, 'su propio historial sigue abierto');
    assert.deepEqual(await res.json(), [], 'pero no incluye los trabajos de la bolsa');
  });
});

// ─── La direccion ───────────────────────────────────────────────────────────

test('la bolsa no entrega la direccion de un trabajo que nadie tomo', async () => {
  const e = await escenario();
  const aseador = await e.nuevo('Activo', 'w@t.cl', 'worker', true);

  await conServidor(async (base) => {
    for (const ruta of ['/api/worker/disponibles', '/api/servicios']) {
      const res = await pedir(base, 'GET', ruta, { sesion: token(aseador, 'worker') });
      assert.equal(res.status, 200);
      const [s] = await res.json();
      assert.ok(s, `${ruta} deberia mostrar el trabajo`);
      assert.equal('direccion' in s, false, `${ruta} no deberia traer la direccion`);
      assert.equal(s.direccion_visible, false, `${ruta} deberia decir que no es visible`);
      // Y nada de la direccion se cuela por otra clave.
      assert.doesNotMatch(JSON.stringify(s), /Aromos/i, `${ruta} filtra la direccion por otro lado`);
      assert.ok(s.worker_recibe > 0, `${ruta} si deberia decir cuanto paga`);
    }
  });
});

test('el aseador si ve la direccion del trabajo que ya es suyo', async () => {
  const e = await escenario();
  const aseador = await e.nuevo('Activo', 'w@t.cl', 'worker', true);

  await conServidor(async (base) => {
    assert.equal((await pedir(base, 'POST', `/api/worker/aceptar/${e.servicio}`, { sesion: token(aseador, 'worker') })).status, 200);

    const [s] = await (await pedir(base, 'GET', '/api/servicios', { sesion: token(aseador, 'worker') })).json();
    assert.equal(s.direccion_visible, true);
    assert.match(s.direccion, /Aromos/, 'ya es su trabajo: necesita saber donde ir');
  });
});

test('el cliente sigue viendo la direccion de sus propios servicios', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const [s] = await (await pedir(base, 'GET', '/api/servicios', { sesion: token(e.cliente, 'cliente') })).json();
    assert.match(s.direccion, /Aromos/, 'es su casa: la escribio el');
    assert.equal('direccion_visible' in s, false, 'la marca es solo para la vista del aseador');
  });
});

// ─── La revision ────────────────────────────────────────────────────────────

test('el administrador lista los aseadores con los que esperan primero', async () => {
  const e = await escenario();
  await e.db.query(
    `INSERT INTO usuarios(nombre,email,password,rol,activo,creado_en) VALUES
       ('Activa','a@t.cl','h','worker',true,'2026-09-01'),
       ('Espera hace rato','b@t.cl','h','worker',false,'2026-09-05'),
       ('Espera recien','c2@t.cl','h','worker',false,'2026-09-20')`);

  await conServidor(async (base) => {
    const res = await pedir(base, 'GET', '/api/admin/workers', { sesion: token(e.admin, 'admin') });
    assert.equal(res.status, 200);
    const workers = await res.json();

    assert.deepEqual(workers.map((w) => w.nombre), ['Espera hace rato', 'Espera recien', 'Activa'],
      'los inactivos primero, y entre ellos el que lleva mas tiempo esperando');
    for (const campo of ['id', 'nombre', 'email', 'telefono', 'comuna', 'experiencia', 'activo', 'perfil_pago_completo', 'creado_en']) {
      assert.ok(campo in workers[0], `falta ${campo}, que es lo que se mira para decidir`);
    }
    assert.equal('password' in workers[0], false, 'el hash de la contrasena no sale de la base');
  });
});

test('activar un aseador lo deja entrar a la bolsa y se lo avisa', async () => {
  const e = await escenario();
  const enRevision = await e.nuevo('En revision', 'w@t.cl', 'worker', false);

  await conServidor(async (base) => {
    const res = await pedir(base, 'POST', `/api/admin/workers/${enRevision}/activar`,
      { sesion: token(e.admin, 'admin'), cuerpo: { activo: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, activo: true });

    // La puerta se abre sin volver a entrar: el token viejo sigue sirviendo.
    assert.equal((await pedir(base, 'GET', '/api/worker/disponibles', { sesion: token(enRevision, 'worker') })).status, 200);

    const { rows } = await e.db.query('SELECT tipo, mensaje FROM notificaciones WHERE usuario_id=$1', [enRevision]);
    assert.equal(rows.length, 1, 'deberia enterarse de que ya puede trabajar');
    assert.match(rows[0].mensaje, /activada/i);
  });
});

test('desactivar vuelve a cerrar la puerta y no avisa nada', async () => {
  const e = await escenario();
  const aseador = await e.nuevo('Activo', 'w@t.cl', 'worker', true);

  await conServidor(async (base) => {
    const res = await pedir(base, 'POST', `/api/admin/workers/${aseador}/activar`,
      { sesion: token(e.admin, 'admin'), cuerpo: { activo: false } });
    assert.deepEqual(await res.json(), { ok: true, activo: false });

    assert.equal((await pedir(base, 'GET', '/api/worker/disponibles', { sesion: token(aseador, 'worker') })).status, 403);
    const { rows } = await e.db.query('SELECT id FROM notificaciones WHERE usuario_id=$1', [aseador]);
    assert.equal(rows.length, 0, 'una baja no se anuncia con una felicitacion');
  });
});

test('solo un administrador activa aseadores', async () => {
  const e = await escenario();
  const aseador = await e.nuevo('Activo', 'w@t.cl', 'worker', true);

  await conServidor(async (base) => {
    const rutas = [['GET', '/api/admin/workers'], ['POST', `/api/admin/workers/${aseador}/activar`]];
    for (const [metodo, ruta] of rutas) {
      assert.equal((await pedir(base, metodo, ruta, { cuerpo: { activo: true } })).status, 401, `${ruta} sin sesion`);
      for (const rol of ['cliente', 'worker']) {
        const res = await pedir(base, metodo, ruta, { sesion: token(aseador, rol), cuerpo: { activo: true } });
        assert.equal(res.status, 403, `${ruta} como ${rol}`);
      }
    }
    const { rows: [u] } = await e.db.query('SELECT activo FROM usuarios WHERE id=$1', [aseador]);
    assert.equal(u.activo, true, 'y nadie alcanzo a cambiar el flag');
  });
});

test('activar exige decir true o false, y el aseador tiene que existir', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const sesion = token(e.admin, 'admin');
    for (const cuerpo of [{}, { activo: 'si' }, { activo: 1 }]) {
      const res = await pedir(base, 'POST', '/api/admin/workers/1/activar', { sesion, cuerpo });
      assert.equal(res.status, 400, `${JSON.stringify(cuerpo)} deberia ser 400`);
    }
    // El cliente existe, pero no es aseador: no se activa por esta puerta.
    const res = await pedir(base, 'POST', `/api/admin/workers/${e.cliente}/activar`, { sesion, cuerpo: { activo: true } });
    assert.equal(res.status, 404);
  });
});
