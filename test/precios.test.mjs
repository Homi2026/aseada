// La tarifa: lo que ve el cliente antes de contratar y lo que determina
// cuanto recibe el aseador.
//
// La comision de lista ajusta unos pesos la comision de los paquetes que se
// publicitan, para que el total termine en :990. Lo que estas pruebas fijan
// es que ese ajuste no se coma lo del trabajador y que no se filtre a los
// casos que no son paquete.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const { calcularPrecio } = (await import('../server.js')).default;

const terminaEn990 = (n) => String(n).endsWith('990');

test('los paquetes de aseo publicitados terminan en 990', () => {
  for (const metros of [50, 120, 200]) {
    const p = calcularPrecio(metros, 0, false);
    assert.ok(terminaEn990(p.total_cliente),
      `${metros}m2 deberia terminar en 990, dio ${p.total_cliente}`);
  }
});

test('los paquetes de fumigacion publicitados terminan en 990', () => {
  for (const plaga of ['insectos', 'roedores']) {
    const p = calcularPrecio(50, 0, false, 'fumigacion', plaga);
    assert.ok(terminaEn990(p.total_cliente),
      `fumigacion ${plaga} deberia terminar en 990, dio ${p.total_cliente}`);
  }
});

// El ajuste sale de la comision de Aseada, no del bolsillo del aseador.
//
// A proposito no se fijan montos: las tarifas estan en revision y una prueba
// que los memoriza se rompe en cada ajuste sin senalar nada real. Lo que se
// fija es la relacion que debe cumplirse sea cual sea el precio.
test('el ajuste de comision no toca lo que recibe el aseador', () => {
  const casos = [
    ['aseo 50m2', calcularPrecio(50, 0, false)],
    ['aseo 120m2', calcularPrecio(120, 0, false)],
    ['aseo 200m2', calcularPrecio(200, 0, false)],
    ['fumigacion insectos', calcularPrecio(50, 0, false, 'fumigacion', 'insectos')],
    ['fumigacion roedores', calcularPrecio(50, 0, false, 'fumigacion', 'roedores')]
  ];

  for (const [nombre, p] of casos) {
    assert.equal(p.worker_recibe, p.subtotal, `${nombre}: el aseador recibe el subtotal`);
    assert.equal(p.subtotal, p.precio_base, `${nombre}: sin extras, el subtotal es el precio base`);
    // Si el ajuste saliera del aseador, su parte bajaria al subir la comision.
    assert.equal(p.worker_recibe + p.comision + p.iva, p.total_cliente,
      `${nombre}: el total se reparte entre aseador, comision e IVA`);
  }
});

// Fuera del paquete manda la formula general, no la tarifa de lista.
test('con materiales u horas extra se vuelve al 20% dinamico', () => {
  const conMateriales = calcularPrecio(50, 0, true);
  assert.equal(conMateriales.comision, Math.round(conMateriales.subtotal * 0.20),
    'con materiales la comision deberia ser el 20% del subtotal');

  const conHorasExtra = calcularPrecio(50, 1, false);
  assert.equal(conHorasExtra.comision, Math.round(conHorasExtra.subtotal * 0.20),
    'con horas extra la comision deberia ser el 20% del subtotal');
  assert.ok(conHorasExtra.subtotal > conHorasExtra.precio_base,
    'las horas extra deberian sumarse al subtotal');
});

test('un tramo sin tarifa de lista usa el 20% dinamico', () => {
  // 80m2 no esta entre los paquetes publicitados.
  const p = calcularPrecio(80, 0, false);
  assert.equal(p.comision, Math.round(p.subtotal * 0.20));
});

test('mixto no tiene tarifa de lista y cae al 20%', () => {
  const p = calcularPrecio(50, 0, false, 'fumigacion', 'mixto');
  assert.equal(p.comision, Math.round(p.precio_base * 0.20));
});

test('el IVA se calcula sobre la comision, no sobre el total', () => {
  for (const p of [calcularPrecio(50, 0, false), calcularPrecio(50, 0, false, 'fumigacion', 'insectos')]) {
    assert.equal(p.iva, Math.round(p.comision * 0.19));
  }
});

test('el total del cliente es subtotal mas comision mas IVA', () => {
  for (const p of [
    calcularPrecio(50, 0, false),
    calcularPrecio(80, 2, true),
    calcularPrecio(200, 0, false),
    calcularPrecio(50, 0, false, 'fumigacion', 'roedores')
  ]) {
    assert.equal(p.total_cliente, p.subtotal + p.comision + p.iva);
  }
});

// El README es explicito: la pantalla del aseador muestra ganancia bruta y no
// debe prometer un neto. El calculo entrega la retencion aparte.
test('la retencion de honorarios se informa aparte del bruto', () => {
  const p = calcularPrecio(50, 0, false);
  assert.equal(p.retencion_honorarios, Math.round(p.subtotal * 0.1525));
  assert.equal(p.worker_liquido_estimado, p.subtotal - p.retencion_honorarios);
  assert.ok(p.worker_recibe > p.worker_liquido_estimado,
    'el bruto deberia ser mayor que el liquido estimado');
});
