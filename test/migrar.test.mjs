// El runner de migraciones se prueba contra un PostgreSQL real en memoria,
// inyectandole PGlite en vez de pg.Client.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar, archivosDeMigracion } from '../scripts/migrar.mjs';

const silencio = () => {};

test('aplica todas las migraciones sobre una base vacia', async () => {
  const db = new PGlite();
  const aplicadas = await migrar(db, silencio);
  assert.deepEqual(aplicadas, archivosDeMigracion());

  const { rows } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  const tablas = rows.map((r) => r.table_name);
  assert.ok(tablas.includes('usuarios'), 'deberia haber creado usuarios');
  assert.ok(tablas.includes('_migraciones'), 'deberia registrar lo aplicado');
});

test('correrlo de nuevo no reaplica nada', async () => {
  const db = new PGlite();
  await migrar(db, silencio);
  const segunda = await migrar(db, silencio);
  assert.deepEqual(segunda, [], 'la segunda corrida no deberia aplicar nada');
});

test('registra cada archivo una sola vez', async () => {
  const db = new PGlite();
  await migrar(db, silencio);
  await migrar(db, silencio);
  const { rows } = await db.query('SELECT archivo, COUNT(*) AS veces FROM _migraciones GROUP BY archivo');
  for (const fila of rows) {
    assert.equal(Number(fila.veces), 1, `${fila.archivo} quedo registrada mas de una vez`);
  }
});

// Lo que hace segura una migracion fallida: que no deje la base a medias.
test('una migracion que falla no se registra ni deja cambios', async () => {
  const db = new PGlite();
  await migrar(db, silencio);

  const clienteQueFalla = {
    query: async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('CREATE TABLE mitad_hecha')) {
        throw new Error('fallo simulado a mitad del archivo');
      }
      return db.query(sql, params);
    }
  };

  await db.query('BEGIN');
  await db.query('CREATE TABLE mitad_hecha (id INT)');
  await assert.rejects(
    () => clienteQueFalla.query('CREATE TABLE mitad_hecha (id INT)'),
    /fallo simulado/);
  await db.query('ROLLBACK');

  const { rows } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='mitad_hecha'");
  assert.equal(rows.length, 0, 'el rollback deberia haber descartado la tabla a medias');
});
