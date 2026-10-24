// Convierte cada pieza .dc.html en un HTML suelto y la fotografia a PNG
// 1080x1080 con Chrome. El resultado son los archivos que se suben a Instagram.
//
// Correr con: node tools/exportar-instagram.mjs
// Las imagenes quedan en ~/Documents/aseada-instagram/

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ORIGEN = new URL('./piezas-instagram/', import.meta.url).pathname;
const TRABAJO = '/tmp/ig-aseada-render';
const DESTINO = join(process.env.HOME, 'Documents', 'aseada-instagram');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// El orden de publicacion, dia por dia.
const ORDEN = [
  ['Main.dc.html', '1-lanzamiento'],
  ['Precios.dc.html', '2-precios'],
  ['PagoProtegido.dc.html', '3-pago-protegido'],
  ['ComoFunciona.dc.html', '4-como-funciona'],
  ['PlanSemanal.dc.html', '5-plan-semanal'],
  ['SiNadieLlega.dc.html', '6-si-nadie-llega'],
  ['Aseadores.dc.html', '7-aseadores'],
];

mkdirSync(TRABAJO, { recursive: true });
mkdirSync(DESTINO, { recursive: true });

const entre = (texto, desde, hasta) => {
  const i = texto.indexOf(desde);
  const j = texto.indexOf(hasta, i);
  return i === -1 || j === -1 ? '' : texto.slice(i + desde.length, j);
};

for (const [archivo, nombre] of ORDEN) {
  const fuente = readFileSync(join(ORIGEN, archivo), 'utf8');
  // El <helmet> lleva la fuente de Google y los estilos base; el contenido
  // visible es todo lo que va entre </helmet> y </x-dc>.
  const cabeza = entre(fuente, '<helmet>', '</helmet>');
  const cuerpo = entre(fuente, '</helmet>', '</x-dc>');
  const suelto = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">${cabeza}
<style>html,body{margin:0;padding:0;width:1080px;height:1080px;overflow:hidden}</style>
</head><body>${cuerpo}</body></html>`;
  const htmlPath = join(TRABAJO, `${nombre}.html`);
  writeFileSync(htmlPath, suelto);

  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1080,1080',
    // Tiempo virtual para que alcance a descargar y aplicar la tipografia.
    '--virtual-time-budget=8000',
    `--screenshot=${join(DESTINO, `${nombre}.png`)}`,
    `file://${htmlPath}`,
  ], { stdio: 'pipe' });
  console.log(`✓ ${nombre}.png`);
}

console.log(`\nListo. ${readdirSync(DESTINO).filter((f) => f.endsWith('.png')).length} imágenes en:\n${DESTINO}`);
