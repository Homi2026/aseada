// El temporizador que reemplaza al servicio de cron aparte de Railway.
//
// Antes esto lo disparaba un servicio de Railway con deploy.cronSchedule, una
// vez al dia -- el CLI no expone ese campo por fuera del panel y quedo
// bloqueado ahi (ver commits de septiembre). El backend ya es un proceso
// siempre encendido: correrProcesoPeriodico() se llama solo, con un
// setInterval, sin depender de nada externo.
//
// Lo unico que tiene logica propia para probar es el guard contra corridas
// superpuestas: si la base esta lenta y el intervalo se cumple de nuevo antes
// de que la vuelta anterior termine, la segunda no debe tocar la base.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool, correrProcesoPeriodico } = servidor;

const silencio = () => {};

async function baseAlDia() {
  const db = new PGlite();
  await migrar(db, silencio);
  return db;
}

/**
 * Envuelve una base real y deja que el test controle cuando responde la
 * primera consulta (la de liberarVencidos), para forzar la superposicion sin
 * depender de temporizadores de verdad.
 */
function baseQueSePuedePausar(db) {
  let llamadas = 0;
  let liberarPrimeraLlamada;
  const primeraLlamadaEnCurso = new Promise((resolver) => { liberarPrimeraLlamada = resolver; });
  return {
    db: {
      query: async (sql, params) => {
        llamadas++;
        if (llamadas === 1) await primeraLlamadaEnCurso;
        return db.query(sql, params);
      }
    },
    contar: () => llamadas,
    dejarSeguir: () => liberarPrimeraLlamada()
  };
}

test('una segunda corrida mientras la primera esta en curso no toca la base', async () => {
  const db = await baseAlDia();
  const pausable = baseQueSePuedePausar(db);
  usarPool(pausable.db);

  const primera = correrProcesoPeriodico(); // no se espera: queda "en curso"
  await new Promise((r) => setImmediate(r)); // le da el turno para que entre y quede pausada

  const segunda = await correrProcesoPeriodico(); // debe volver de inmediato, sin consultar
  assert.equal(segunda, undefined, 'la segunda corrida no devuelve nada: se salto entera');
  assert.equal(pausable.contar(), 1, 'la segunda no debio hacer ninguna consulta nueva');

  pausable.dejarSeguir();
  await primera; // deja que la primera termine antes de que el test siga
});

test('despues de que la primera termina, la siguiente corre normal', async () => {
  const db = await baseAlDia();
  usarPool(db);

  await correrProcesoPeriodico();
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM servicios');
  // No hay servicios en esta base: solo confirma que la corrida no se quedo
  // trabada y que la base sigue respondiendo consultas normales despues.
  assert.equal(rows[0].n, 0);

  // Una tercera corrida, ya sin nada pendiente en el guard, tampoco debe fallar.
  await correrProcesoPeriodico();
});

test('si la corrida falla, el guard se libera igual y la siguiente puede correr', async () => {
  const quiebre = { query: async () => { throw new Error('la base se cayo'); } };
  usarPool(quiebre);

  await correrProcesoPeriodico(); // no debe lanzar: el error se atrapa y se loguea

  // Si el guard hubiera quedado trabado en "corriendo", esta segunda llamada
  // volveria de inmediato sin siquiera intentar la consulta. Se verifica que
  // SI la intenta, comparando que el mismo error se repite.
  let intento = false;
  usarPool({ query: async () => { intento = true; throw new Error('la base se cayo'); } });
  await correrProcesoPeriodico();
  assert.equal(intento, true, 'el guard debio liberarse tras la falla anterior');
});
