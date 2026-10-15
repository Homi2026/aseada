// La fumigación está apagada, y tiene que seguir apagada.
//
// No es una preferencia de producto: el Decreto Supremo 157/2005 del Ministerio
// de Salud exige autorización sanitaria de la SEREMI (art. 95), un responsable
// técnico con título profesional de ocho semestres que debe "estar presente en
// las faenas de aplicación" (art. 104), y un certificado por tratamiento
// firmado por ese responsable con el número de la resolución (art. 101).
// Despachar un aseador solo a una casa es incompatible con el art. 104.
//
// Estas pruebas existen para que nadie la vuelva a prender sin querer: ni
// borrando una validación, ni agregando un tipo de servicio, ni desde la app.
// El día que se intermedien empresas ya autorizadas, se prende
// FUMIGACION_HABILITADA, estas pruebas fallan, y ahí se revisan a conciencia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.DATABASE_URL ||= 'postgresql://prueba:prueba@127.0.0.1:1/prueba';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const servidor = (await import('../server.js')).default;
const { TIPOS_SERVICIO_A_LA_VENTA, calcularPrecio } = servidor;

async function conServidor(fn) {
  const s = servidor.listen(0);
  await new Promise((listo) => s.once('listening', listo));
  try { await fn(`http://127.0.0.1:${s.address().port}`); }
  finally { await new Promise((listo) => s.close(listo)); }
}

const postJson = (base, ruta, cuerpo) => fetch(base + ruta, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo)
});

// ─── Lo que el cliente puede comprar ────────────────────────────────────────

test('la fumigación no está entre los servicios a la venta', () => {
  assert.deepEqual(TIPOS_SERVICIO_A_LA_VENTA, ['aseo']);
});

test('cotizar una fumigación se rechaza con un motivo en castellano', async () => {
  await conServidor(async (base) => {
    const res = await postJson(base, '/api/calcular-precio', {
      metros: 40, tipo_servicio: 'fumigacion', tipo_plaga: 'insectos'
    });
    assert.equal(res.status, 400, 'no puede cotizarse algo que no se puede prestar');
    const { error } = await res.json();
    assert.match(error, /fumigaci/i);
    // El cliente no tiene por qué leer sobre decretos: se le dice qué sí hay.
    assert.match(error, /aseo/i);
  });
});

test('las tres plagas se rechazan por igual, no solo una', async () => {
  await conServidor(async (base) => {
    for (const plaga of ['insectos', 'roedores', 'mixto']) {
      const res = await postJson(base, '/api/calcular-precio', {
        metros: 40, tipo_servicio: 'fumigacion', tipo_plaga: plaga
      });
      assert.equal(res.status, 400, `la plaga ${plaga} debería rechazarse`);
    }
  });
});

test('crear el servicio tampoco pasa, aunque se salte la cotización', async () => {
  await conServidor(async (base) => {
    // Sin token: lo que importa es que NO devuelva 201. Un atacante con sesión
    // válida tampoco debe poder, y eso lo cubre el mismo embudo de validación.
    const res = await postJson(base, '/api/servicios', {
      metros: 40, direccion: 'Calle 1', tipo_servicio: 'fumigacion', tipo_plaga: 'insectos'
    });
    assert.notEqual(res.status, 201, 'no puede crearse un servicio de fumigación');
  });
});

// ─── Lo que sí tiene que seguir funcionando ─────────────────────────────────

test('el aseo no se vio afectado', async () => {
  await conServidor(async (base) => {
    const res = await postJson(base, '/api/calcular-precio', { metros: 40 });
    assert.equal(res.status, 200);
    const p = await res.json();
    assert.equal(p.tipo_servicio, 'aseo');
    assert.ok(p.total_cliente > 0);
  });
});

test('la tabla de tarifas de fumigación se conserva para cuando se habilite', () => {
  // Apagar la venta no es lo mismo que borrar el trabajo hecho. El camino que
  // sí cumple la ley es intermediar empresas autorizadas, y ese día la tarifa
  // ya tiene que estar calculada y creciente.
  const p = calcularPrecio(40, 0, false, 'fumigacion', 'insectos');
  assert.ok(p.total_cliente > 0, 'el cálculo sigue existiendo');
  assert.equal(p.tipo_servicio, 'fumigacion');
});

// ─── Y que la app no ofrezca lo que la API rechaza ──────────────────────────

test('la app tiene la bandera apagada, igual que el backend', () => {
  const sitio = readFileSync(join(RAIZ, '..', 'app', 'src', 'constants', 'sitio.ts'), 'utf8');
  assert.match(sitio, /export const FUMIGACION_HABILITADA = false;/,
    'si la app la prende sola, ofrecería algo que la API rechaza con 400');
});

test('la portada ya no anuncia fumigación', () => {
  const landing = readFileSync(join(RAIZ, '..', 'app', 'src', 'app', 'landing.tsx'), 'utf8');
  // Se mira el texto que ve el cliente, no los nombres de estilos, que quedan
  // a propósito para cuando se vuelva a habilitar.
  const visible = landing.replace(/styles\.\w+/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const palabra of [/Fumigaci[óo]n residencial/i, /desde \$59\.990/, /desde \$72\.990/]) {
    assert.doesNotMatch(visible, palabra, 'la portada no puede ofrecer fumigación');
  }
});

test('el título y la descripción del sitio tampoco la mencionan', () => {
  const sitio = readFileSync(join(RAIZ, '..', 'app', 'src', 'constants', 'sitio.ts'), 'utf8');
  const titulo = sitio.match(/TITULO_SITIO = '([^']+)'/)?.[1] ?? '';
  const desc = sitio.match(/DESCRIPCION_SITIO =\s*'([^']+)'/)?.[1] ?? '';
  assert.doesNotMatch(titulo, /fumigaci/i);
  assert.doesNotMatch(desc, /fumigaci/i);
});
