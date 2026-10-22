// El servidor aplica sus migraciones al arrancar, antes de atender. Si la base
// falla, no revienta: arranca igual y /health muestra lo pendiente.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { archivosDeMigracion } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const { migrarAlArrancar } = await import('../server.js');
const silencio = () => {};

test('en una base vacia aplica todas las migraciones, y la segunda vez ninguna', async () => {
  const db = new PGlite();
  const primera = await migrarAlArrancar(db, silencio);
  assert.deepEqual(primera, archivosDeMigracion());
  const segunda = await migrarAlArrancar(db, silencio);
  assert.deepEqual(segunda, []);
});

test('si la base falla devuelve null en vez de reventar el arranque', async () => {
  const rota = { query: async () => { throw new Error('sin conexion'); } };
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    assert.equal(await migrarAlArrancar(rota, silencio), null);
  } finally {
    console.error = errorOriginal;
  }
});
