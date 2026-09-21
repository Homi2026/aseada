// El cliente siempre parsea la respuesta como JSON. Si el servidor contesta
// HTML, la app muestra un error ilegible y, peor, la pagina de error de
// Express incluye el stack trace con las rutas absolutas del servidor.

import test from 'node:test';
import assert from 'node:assert/strict';

// server.js exige JWT_SECRET y DATABASE_URL para arrancar. Estas pruebas no
// tocan la base, asi que basta con valores de relleno; van antes del import
// porque la validacion corre al cargar el modulo. De ahi el import dinamico:
// un `import` estatico se evaluaria antes que estas lineas.
process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';
// PUBLIC_URL puesta y las de Flow ausentes: asi el 503 de pagos tiene algo
// que nombrar y algo que callar.
process.env.PUBLIC_URL ||= 'https://ejemplo.test';
delete process.env.FLOW_API_KEY;
delete process.env.FLOW_SECRET_KEY;

const { default: app } = await import('../server.js');

/** Levanta la app en un puerto libre y la apaga al terminar. */
async function conServidor(fn) {
  const servidor = app.listen(0);
  await new Promise((listo) => servidor.once('listening', listo));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try { await fn(base); }
  finally { await new Promise((listo) => servidor.close(listo)); }
}

test('un cuerpo con JSON malformado responde JSON, no HTML', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/calcular-precio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"metros":}'
    });

    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /application\/json/);

    const cuerpo = await res.json();
    assert.match(cuerpo.error, /JSON/);
    // Lo que no debe filtrarse: rutas del servidor ni stack traces.
    assert.doesNotMatch(JSON.stringify(cuerpo), /node_modules|\/Users\/|at JSON\.parse/);
  });
});

test('una ruta inexistente responde JSON con 404', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/esta-ruta-no-existe`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.match((await res.json()).error, /no encontrada/i);
  });
});

test('el 503 de pagos nombra solo las variables que faltan', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/pagos/crear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servicio_id: 1 })
    });

    // exigirFlow corre antes que verificarToken, asi que el 503 llega sin token.
    assert.equal(res.status, 503);
    const { error } = await res.json();
    assert.match(error, /FLOW_API_KEY/);
    assert.match(error, /FLOW_SECRET_KEY/);
    // PUBLIC_URL si esta configurada: mandar a revisarla desorienta.
    assert.doesNotMatch(error, /PUBLIC_URL/);
  });
});
