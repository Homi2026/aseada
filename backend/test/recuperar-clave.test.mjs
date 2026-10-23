// Recuperar la contraseña sin servicio de correo: el admin genera una clave
// temporal, el usuario entra con ella y la cambia desde su perfil.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool, reiniciarLimiteIntentos } = await import('../server.js');
const { default: jwt } = await import('jsonwebtoken');
const { default: bcrypt } = await import('bcryptjs');

const silencio = () => {};

async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  reiniciarLimiteIntentos?.();
  const hash = await bcrypt.hash('clave-original-1', 4);
  const nuevo = async (email, rol) => (await db.query(
    'INSERT INTO usuarios(nombre,email,password,rol,activo) VALUES($1,$1,$2,$3,true) RETURNING id', [email, hash, rol])).rows[0].id;
  const admin = await nuevo('admin@t.cl', 'admin');
  const cliente = await nuevo('cliente@t.cl', 'cliente');
  const firmar = (id, email, rol) => jwt.sign({ id, email, rol }, process.env.JWT_SECRET);
  return { db, tokenAdmin: firmar(admin, 'admin@t.cl', 'admin'), tokenCliente: firmar(cliente, 'cliente@t.cl', 'cliente') };
}

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const post = (base, ruta, cuerpo, token) => fetch(base + ruta, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(cuerpo)
});

test('el admin genera una clave temporal con la que el usuario puede entrar', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    const r = await post(base, '/api/admin/usuarios/restablecer-clave', { email: 'Cliente@T.cl' }, e.tokenAdmin);
    assert.equal(r.status, 200);
    const { clave_temporal } = await r.json();
    assert.equal(clave_temporal.length, 10);

    assert.equal((await post(base, '/auth/login', { email: 'cliente@t.cl', password: 'clave-original-1' })).status, 400,
      'la contraseña anterior deja de servir');
    assert.equal((await post(base, '/auth/login', { email: 'cliente@t.cl', password: clave_temporal })).status, 200);
  });
});

test('solo un admin puede restablecer contraseñas', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    assert.equal((await post(base, '/api/admin/usuarios/restablecer-clave', { email: 'admin@t.cl' }, e.tokenCliente)).status, 403);
    assert.equal((await post(base, '/api/admin/usuarios/restablecer-clave', { email: 'admin@t.cl' })).status, 401);
  });
});

test('restablecer una cuenta que no existe da 404', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    assert.equal((await post(base, '/api/admin/usuarios/restablecer-clave', { email: 'nadie@t.cl' }, e.tokenAdmin)).status, 404);
  });
});

test('cambiar la contraseña exige la actual correcta y una nueva de 8 caracteres', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    assert.equal((await post(base, '/api/usuarios/cambiar-clave', { actual: 'otra-cosa-9', nueva: 'nueva-clave-1' }, e.tokenCliente)).status, 400);
    assert.equal((await post(base, '/api/usuarios/cambiar-clave', { actual: 'clave-original-1', nueva: 'corta' }, e.tokenCliente)).status, 400);
    assert.equal((await post(base, '/api/usuarios/cambiar-clave', { actual: 'clave-original-1', nueva: 'nueva-clave-1' }, e.tokenCliente)).status, 200);
    assert.equal((await post(base, '/auth/login', { email: 'cliente@t.cl', password: 'nueva-clave-1' })).status, 200);
  });
});
