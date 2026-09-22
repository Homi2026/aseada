// Quien puede tocar las rutas que mueven pagos a trabajadores.
//
// Estas comprobaciones corren antes de cualquier consulta a la base, asi que
// se prueban con el servidor real y una base inexistente.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';
process.env.CRON_SECRET = 'cron-de-prueba';

const { default: app } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');

const token = (rol) => jwt.sign({ id: 1, email: 'x@t.cl', rol }, process.env.JWT_SECRET);

async function conServidor(fn) {
  const servidor = app.listen(0);
  await new Promise((listo) => servidor.once('listening', listo));
  try { await fn(`http://127.0.0.1:${servidor.address().port}`); }
  finally { await new Promise((listo) => servidor.close(listo)); }
}

const pedir = (base, metodo, ruta, rol) => fetch(base + ruta, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...(rol && { Authorization: `Bearer ${token(rol)}` }) },
  ...(metodo === 'POST' && { body: '{}' })
});

test('el proceso diario exige el secreto del cron', async () => {
  await conServidor(async (base) => {
    assert.equal((await fetch(`${base}/api/cron/diario`)).status, 401, 'sin encabezado');
    const conOtro = await fetch(`${base}/api/cron/diario`, { headers: { Authorization: 'Bearer otro' } });
    assert.equal(conOtro.status, 401, 'con un secreto equivocado');
  });
});

test('las rutas de administracion rechazan a clientes y trabajadores', async () => {
  await conServidor(async (base) => {
    const rutas = [
      ['GET', '/api/admin/transferencias'],
      ['POST', '/api/admin/transferencias/1/transferida'],
      ['GET', '/api/admin/reclamos'],
      ['POST', '/api/admin/servicios/1/resolver']
    ];
    for (const [metodo, ruta] of rutas) {
      assert.equal((await pedir(base, metodo, ruta)).status, 401, `${ruta} sin sesion`);
      assert.equal((await pedir(base, metodo, ruta, 'cliente')).status, 403, `${ruta} como cliente`);
      assert.equal((await pedir(base, metodo, ruta, 'worker')).status, 403, `${ruta} como trabajador`);
    }
  });
});

test('confirmar y reclamar son solo del cliente', async () => {
  await conServidor(async (base) => {
    for (const ruta of ['/api/servicios/1/confirmar', '/api/servicios/1/reclamo', '/api/pagos/liberar/1']) {
      assert.equal((await pedir(base, 'POST', ruta, 'worker')).status, 403,
        `${ruta}: un trabajador no puede liberarse su propio pago`);
    }
  });
});

// El rol admin existe en la base, pero nadie puede pedirlo al registrarse:
// si se pudiera, cualquiera se asignaria las transferencias a trabajadores.
test('el registro publico no permite crear administradores', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/auth/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'X', email: 'x@t.cl', password: 'clave-larga-123', rol: 'admin' })
    });
    assert.equal(res.status, 400);
  });
});
