// La 004 tiene que poder aplicarse sobre una base que YA tiene dos cuentas de
// la misma persona escritas con distintas mayusculas.
//
// El indice unico sobre LOWER(email) no se puede crear con esas cuentas ahi, y
// Postgres lo dice con "could not create unique index ... Key (lower(email))
// is duplicated", que no nombra a nadie ni dice que hacer. La migracion las
// detecta antes y aborta explicando cuales son.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const archivos = () => readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
const ARCHIVO_004 = archivos().find((f) => f.startsWith('004_'));

const aplicar = (db, archivo) => db.exec(readFileSync(join(MIGRACIONES, archivo), 'utf8'));

/** Base con todo lo anterior a la 004: el mundo antes del arreglo. */
async function baseAntesDeLa004() {
  const db = new PGlite();
  for (const archivo of archivos()) {
    if (archivo === ARCHIVO_004) break;
    await aplicar(db, archivo);
  }
  return db;
}

const crearUsuario = (db, email, rol = 'cliente') => db.query(
  'INSERT INTO usuarios(nombre,email,password,rol) VALUES($1,$2,$3,$4)', [email, email, 'h', rol]);

test('sin colisiones la 004 aplica y deja el email unico sin mayusculas', async () => {
  const db = await baseAntesDeLa004();
  await crearUsuario(db, 'a@t.cl');
  await crearUsuario(db, 'b@t.cl');

  await aplicar(db, ARCHIVO_004);

  await assert.rejects(() => crearUsuario(db, 'A@T.CL'), (error) => error.code === '23505',
    'la misma persona con otras mayusculas ya no puede abrir otra cuenta');
  await crearUsuario(db, 'c@t.cl');
});

test('con colisiones aborta nombrando el correo repetido, no con jerga de Postgres', async () => {
  const db = await baseAntesDeLa004();
  await crearUsuario(db, 'matias@t.cl');
  await crearUsuario(db, 'MATIAS@T.CL');
  await crearUsuario(db, 'otra@t.cl');

  await assert.rejects(() => aplicar(db, ARCHIVO_004), (error) => {
    assert.match(error.message, /matias@t\.cl/, 'deberia decir cual es el correo en conflicto');
    assert.match(error.message, /2 cuentas/, 'y cuantas cuentas hay');
    assert.match(error.message, /npm run migrate/, 'y como seguir despues de arreglarlo');
    assert.doesNotMatch(error.message, /could not create unique index/i);
    return true;
  });

  // Y no deja la base a medio camino: el indice unico no quedo creado.
  await crearUsuario(db, 'OTRA@T.CL');
});

test('reaplicar la 004 no falla', async () => {
  const db = await baseAntesDeLa004();
  await crearUsuario(db, 'a@t.cl');
  await aplicar(db, ARCHIVO_004);
  await aplicar(db, ARCHIVO_004);
});

// El DEFAULT de `activo` no se toca: lo comparten clientes y administradores,
// que si entran activos. Quien decide que el aseador nazca inactivo es
// /auth/registro, y esta prueba deja escrito que la base sigue como estaba
// para que nadie "arregle" el DEFAULT y active a todos los aseadores nuevos.
test('la 004 no cambia el DEFAULT de activo', async () => {
  const db = await baseAntesDeLa004();
  await aplicar(db, ARCHIVO_004);
  const { rows: [u] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('W','w@t.cl','h','worker') RETURNING activo");
  assert.equal(u.activo, true, 'el DEFAULT sigue en TRUE; la decision es de /auth/registro');
});
