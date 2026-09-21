// Adonde vuelve el cliente despues de pagar en Flow.

import test from 'node:test';
import assert from 'node:assert/strict';

/** destinoTrasPago() tal como lo define server.js, para probarlo aislado. */
const destinoTrasPago = (APP_URL) => (resultado, token) => {
  const query = `?pago=${resultado}&token=${encodeURIComponent(token || '')}`;
  return APP_URL ? `${APP_URL}/cliente/historial${query}` : `aseada://pago-${resultado}${query}`;
};

test('con APP_URL definida vuelve a una URL que el navegador puede abrir', () => {
  const destino = destinoTrasPago('https://app.aseada.cl');

  const exito = destino('exitoso', 'tok_abc');
  assert.match(exito, /^https:\/\/app\.aseada\.cl\//, 'debe ser http(s), no un esquema propio');
  assert.match(exito, /pago=exitoso/);
  assert.match(exito, /token=tok_abc/);

  assert.match(destino('rechazado', 'tok_abc'), /pago=rechazado/);
});

test('sin APP_URL cae al deep link de la app movil', () => {
  const destino = destinoTrasPago('');
  assert.match(destino('exitoso', 'tok_abc'), /^aseada:\/\/pago-exitoso/);
});

test('un token con caracteres raros no rompe la URL', () => {
  const destino = destinoTrasPago('https://app.aseada.cl');
  const url = destino('exitoso', 'a b&c=d');
  assert.doesNotMatch(url.split('token=')[1], /[&= ]/, 'el token debe ir escapado');
  assert.doesNotThrow(() => new URL(url), 'debe seguir siendo una URL valida');
});

test('sin token la URL sigue siendo valida', () => {
  const destino = destinoTrasPago('https://app.aseada.cl');
  assert.doesNotThrow(() => new URL(destino('rechazado', undefined)));
});
