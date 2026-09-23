// Cobrar mas por menos metros.
//
// La tabla de fumigacion fijaba una comision de lista solo en el tramo chico
// (un 32% del base) mientras el resto usaba el 20% dinamico, y eso daba vuelta
// la escalera: un depto de 40 m2 pagaba $64.990 y una casa de 100 m2 $61.776.
// El cliente ve las dos cifras en la misma pantalla y no hay forma de
// explicarlo.
//
// Esta prueba es la que evita que vuelva a pasar: recorre los cinco tamanos
// que la app ofrece de verdad y exige que el precio nunca baje al subir los
// metros. A proposito no fija montos -- las tarifas estan en revision y una
// prueba que los memoriza se rompe en cada ajuste sin senalar nada real.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const { calcularPrecio } = (await import('../server.js')).default;

// Los cinco tamanos del selector de la app.
const TAMANOS = [40, 65, 100, 150, 250];

const SERVICIOS = [
  ['aseo', ['aseo', null]],
  ['fumigacion de insectos', ['fumigacion', 'insectos']],
  ['fumigacion de roedores', ['fumigacion', 'roedores']],
  ['fumigacion mixta', ['fumigacion', 'mixto']]
];

const escaleraDe = ([tipo_servicio, tipo_plaga]) =>
  TAMANOS.map((metros) => calcularPrecio(metros, 0, false, tipo_servicio, tipo_plaga).total_cliente);

test('el precio nunca baja cuando suben los metros', () => {
  for (const [nombre, servicio] of SERVICIOS) {
    const escalera = escaleraDe(servicio);
    for (let i = 1; i < escalera.length; i++) {
      assert.ok(escalera[i] >= escalera[i - 1],
        `${nombre}: ${TAMANOS[i]}m2 cuesta ${escalera[i]} y ${TAMANOS[i - 1]}m2 cuesta ${escalera[i - 1]}; ` +
        `la escalera completa es ${escalera.join(' → ')}`);
    }
  }
});

// Dos tamanos del mismo tramo valen lo mismo (65 y 100 m2 caen los dos en el
// tramo de 100 en fumigacion), pero al cambiar de tramo el precio tiene que
// subir de verdad: si no, el tramo de mas arriba no existe.
test('al cambiar de tramo el precio sube, no se queda igual', () => {
  for (const [nombre, servicio] of SERVICIOS) {
    const escalera = escaleraDe(servicio);
    const tramos = escalera.filter((valor, i) => i === 0 || valor !== escalera[i - 1]);
    assert.ok(tramos.length >= 2, `${nombre}: la tabla deberia tener mas de un tramo`);
    for (let i = 1; i < tramos.length; i++) {
      assert.ok(tramos[i] > tramos[i - 1], `${nombre}: los tramos deberian subir, dieron ${tramos.join(' → ')}`);
    }
  }
});

// El tamano mas chico es el que se publicita: si termina costando mas que el
// siguiente, la publicidad contradice a la app.
test('el tamano mas chico es el mas barato de su tabla', () => {
  for (const [nombre, servicio] of SERVICIOS) {
    const escalera = escaleraDe(servicio);
    assert.equal(escalera[0], Math.min(...escalera), `${nombre}: ${TAMANOS[0]}m2 deberia ser el mas barato`);
    assert.ok(escalera[0] < escalera[escalera.length - 1], `${nombre}: el tramo mas grande deberia costar mas`);
  }
});

// El ajuste de la comision de lista sale del margen de Aseada; lo que recibe
// el aseador lo fija el precio base del tramo y no se toca.
test('bajar la comision de lista no le baja el pago al aseador', () => {
  for (const [nombre, [tipo_servicio, tipo_plaga]] of SERVICIOS) {
    const p = calcularPrecio(40, 0, false, tipo_servicio, tipo_plaga);
    assert.equal(p.worker_recibe, p.precio_base, `${nombre}: el aseador recibe el precio base del tramo`);
    assert.equal(p.total_cliente, p.subtotal + p.comision + p.iva, `${nombre}: el total cuadra`);
    assert.ok(p.comision > 0, `${nombre}: Aseada sigue cobrando comision`);
  }
});
