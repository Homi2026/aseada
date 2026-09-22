// Como se traducen los rechazos de Flow.
//
// axios reduce cualquier rechazo a "Request failed with status code 400",
// que no le dice nada ni al cliente ni a quien lee los logs. Flow si explica
// el motivo en el cuerpo; estas pruebas fijan que ese motivo llegue.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const { FlowError, responderErrorFlow } = (await import('../server.js')).default;

/** Error de axios tal como llega cuando Flow responde con un 4xx/5xx. */
const errorAxios = (status, cuerpo) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: cuerpo } });

/** Respuesta de Express minima que registra lo que se le responde. */
function respuestaFalsa() {
  const r = { statusCode: null, cuerpo: null };
  r.status = (codigo) => { r.statusCode = codigo; return r; };
  r.json = (cuerpo) => { r.cuerpo = cuerpo; return r; };
  return r;
}

const silenciarConsola = () => {
  const original = console.error;
  console.error = () => {};
  return () => { console.error = original; };
};

// Rechazo copiado de una respuesta real de Flow produccion.
const EMAIL_INVALIDO = { code: 1620, message: 'The userEmail: prueba@aseada.test is not valid.' };

test('FlowError conserva el mensaje de Flow en vez del de axios', () => {
  const e = new FlowError(errorAxios(400, EMAIL_INVALIDO));
  assert.equal(e.message, EMAIL_INVALIDO.message);
  assert.doesNotMatch(e.message, /Request failed with status code/);
  assert.equal(e.codigoFlow, 1620);
});

test('un 4xx de Flow se marca como problema del dato enviado', () => {
  assert.equal(new FlowError(errorAxios(400, EMAIL_INVALIDO)).esDelCliente, true);
  assert.equal(new FlowError(errorAxios(503, { message: 'down' })).esDelCliente, false);
});

test('sin respuesta de Flow (timeout, red caida) no se marca como del cliente', () => {
  const sinRed = new FlowError(new Error('timeout of 20000ms exceeded'));
  assert.equal(sinRed.esDelCliente, false);
  assert.equal(sinRed.message, 'timeout of 20000ms exceeded');
});

test('el email invalido se le explica al cliente en castellano', () => {
  const restaurar = silenciarConsola();
  try {
    const res = respuestaFalsa();
    responderErrorFlow(res, new FlowError(errorAxios(400, EMAIL_INVALIDO)));
    assert.equal(res.statusCode, 400, 'es un dato que el cliente puede corregir: 400, no 500');
    assert.match(res.cuerpo.error, /email/i);
    assert.doesNotMatch(res.cuerpo.error, /Request failed/);
  } finally { restaurar(); }
});

test('otro rechazo de Flow devuelve 400 con el motivo', () => {
  const restaurar = silenciarConsola();
  try {
    const res = respuestaFalsa();
    responderErrorFlow(res, new FlowError(errorAxios(400, { code: 108, message: 'Invalid amount' })));
    assert.equal(res.statusCode, 400);
    assert.match(res.cuerpo.error, /Invalid amount/);
  } finally { restaurar(); }
});

test('si Flow esta caido responde 502 sin culpar al cliente', () => {
  const restaurar = silenciarConsola();
  try {
    const res = respuestaFalsa();
    responderErrorFlow(res, new FlowError(errorAxios(503, { message: 'Service Unavailable' })));
    assert.equal(res.statusCode, 502, 'la falla es de Flow, no del dato: 502');
    assert.match(res.cuerpo.error, /Flow/);
  } finally { restaurar(); }
});

test('un error que no viene de Flow sigue siendo 500', () => {
  const res = respuestaFalsa();
  responderErrorFlow(res, new Error('la base no respondio'));
  assert.equal(res.statusCode, 500);
});
