// Lo que llega del cliente no se cree sin mirarlo.
//
// Antes: `metros` en 0 o negativo cotizaba como el tramo de 50; "abc" o 5000
// no caian en ningun tramo y devolvian total $0, o sea un "Pagar $0" en la
// pantalla del cliente y un trabajo sin pago para el aseador. Y una fumigacion
// sin `tipo_plaga` reventaba contra el CHECK de la base: 500 con el texto de
// Postgres adentro.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrar } from '../scripts/migrar.mjs';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const servidor = (await import('../server.js')).default;
const { usarPool } = servidor;
const { default: jwt } = await import('jsonwebtoken');

const silencio = () => {};

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

async function escenario() {
  const db = new PGlite();
  await migrar(db, silencio);
  usarPool(db);
  const { rows: [cliente] } = await db.query(
    "INSERT INTO usuarios(nombre,email,password,rol) VALUES('C','c@t.cl','h','cliente') RETURNING id");
  return { db, cliente: cliente.id, sesion: jwt.sign({ id: cliente.id, email: 'c@t.cl', rol: 'cliente' }, process.env.JWT_SECRET) };
}

const cotizar = (base, cuerpo) => fetch(`${base}/api/calcular-precio`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
});

const contratar = (base, sesion, cuerpo) => fetch(`${base}/api/servicios`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion}` },
  body: JSON.stringify({ direccion: 'Calle 1', ...cuerpo })
});

// Fecha de manana en el calendario chileno, para no depender del dia que se corra.
const MANANA = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

const METROS_MALOS = [0, -5, 1001, 5000, 'abc', 12.5, null, undefined, '', [], {}];

test('cotizar con metros invalidos responde 400, nunca un precio', async () => {
  await escenario();
  await conServidor(async (base) => {
    for (const metros of METROS_MALOS) {
      const res = await cotizar(base, { metros });
      assert.equal(res.status, 400, `metros=${JSON.stringify(metros)} deberia ser 400`);
      const { error, total_cliente } = await res.json();
      assert.equal(total_cliente, undefined, `metros=${JSON.stringify(metros)} devolvio un precio igual`);
      assert.match(error, /metros/i);
    }
  });
});

test('contratar con metros invalidos no crea el servicio', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    for (const metros of METROS_MALOS) {
      assert.equal((await contratar(base, e.sesion, { metros })).status, 400, `metros=${JSON.stringify(metros)}`);
    }
    const { rows } = await e.db.query('SELECT id FROM servicios');
    assert.equal(rows.length, 0, 'ninguno de esos deberia haber quedado guardado');
  });
});

test('los metros que la app si ofrece pasan', async () => {
  await escenario();
  await conServidor(async (base) => {
    for (const metros of [1, 40, 65, 100, 150, 250, 1000, '40']) {
      const res = await cotizar(base, { metros });
      assert.equal(res.status, 200, `metros=${metros} deberia cotizar`);
      assert.ok((await res.json()).total_cliente > 0, `metros=${metros} deberia dar un precio`);
    }
  });
});

test('fumigar sin decir la plaga es un 400 en espanol, no un 500 de Postgres', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    for (const tipo_plaga of [undefined, null, '', 'termitas', 'INSECTOS']) {
      const res = await contratar(base, e.sesion, { metros: 50, tipo_servicio: 'fumigacion', tipo_plaga });
      assert.equal(res.status, 400, `tipo_plaga=${JSON.stringify(tipo_plaga)}`);
      const { error } = await res.json();
      assert.match(error, /plaga/i);
      // Lo que no puede salir: nombres de constraints ni jerga de la base.
      assert.doesNotMatch(error, /constraint|check|violates|servicios_/i);
    }
    for (const tipo_plaga of ['insectos', 'roedores', 'mixto']) {
      assert.equal((await contratar(base, e.sesion, { metros: 50, tipo_servicio: 'fumigacion', tipo_plaga })).status, 201, tipo_plaga);
    }
  });
});

test('el tipo de servicio tiene que ser uno de los dos que existen', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    for (const tipo_servicio of ['jardineria', '', null, 'ASEO']) {
      assert.equal((await contratar(base, e.sesion, { metros: 50, tipo_servicio })).status, 400, String(tipo_servicio));
    }
  });
});

test('las horas extra van de 0 a 3', async () => {
  await escenario();
  await conServidor(async (base) => {
    for (const horas_extra of [-1, 4, 99, 'muchas', 1.5]) {
      assert.equal((await cotizar(base, { metros: 50, horas_extra })).status, 400, String(horas_extra));
    }
    for (const horas_extra of [0, 1, 2, 3]) {
      assert.equal((await cotizar(base, { metros: 50, horas_extra })).status, 200, String(horas_extra));
    }
  });
});

test('la fecha del servicio tiene que ser valida y no haber pasado', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    for (const fecha_servicio of ['el jueves', '2026-13-45', AYER, '2020-01-01']) {
      const res = await contratar(base, e.sesion, { metros: 50, fecha_servicio });
      assert.equal(res.status, 400, `fecha=${fecha_servicio}`);
      assert.match((await res.json()).error, /fecha/i);
    }

    // Hoy y manana si: agendar para mas tarde el mismo dia es lo normal.
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    for (const fecha_servicio of [hoy, MANANA, `${MANANA}T15:30:00.000Z`, undefined, null]) {
      assert.equal((await contratar(base, e.sesion, { metros: 50, fecha_servicio })).status, 201,
        `fecha=${fecha_servicio} deberia aceptarse`);
    }
  });
});

test('sin direccion no hay servicio', async () => {
  const e = await escenario();
  await conServidor(async (base) => {
    for (const direccion of [undefined, null, '', '   ']) {
      const res = await fetch(`${base}/api/servicios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.sesion}` },
        body: JSON.stringify({ metros: 50, direccion })
      });
      assert.equal(res.status, 400, `direccion=${JSON.stringify(direccion)}`);
      assert.match((await res.json()).error, /direcci/i);
    }
  });
});
