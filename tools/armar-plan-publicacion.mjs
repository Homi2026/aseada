// Arma la pagina con el plan de publicacion: cada publicacion con su
// miniatura, su texto listo para copiar y lo que hay que hacer al subirla.
//
// Las imagenes van incrustadas como data: URI porque la pagina publicada no
// puede cargar imagenes de otros servidores.
//
// Correr con: node tools/armar-plan-publicacion.mjs <carpeta-miniaturas> <salida.html>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , CARPETA_MINIATURAS, SALIDA] = process.argv;
const TEXTOS = join(process.env.HOME, 'Documents', 'aseada-instagram');

const miniatura = (nombre) =>
  'data:image/jpeg;base64,' + readFileSync(join(CARPETA_MINIATURAS, `${nombre}.jpg`)).toString('base64');

const texto = (nombre) => readFileSync(join(TEXTOS, `${nombre}.txt`), 'utf8').trim();

const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PUBLICACIONES = [
  { dia: 'Lunes 26', hora: '19:00', tipo: 'Publicación', titulo: 'Aseada ya está en línea',
    piezas: ['1-lanzamiento'], textoDe: '1-lanzamiento' },
  { dia: 'Martes 27', hora: '13:00', tipo: 'Publicación', titulo: 'Precios claros',
    piezas: ['2-precios'], textoDe: '2-precios' },
  { dia: 'Miércoles 28', hora: '19:00', tipo: 'Publicación', titulo: 'Pago protegido',
    piezas: ['3-pago-protegido'], textoDe: '3-pago-protegido' },
  { dia: 'Jueves 29', hora: '13:00', tipo: 'Publicación', titulo: 'Cómo funciona',
    piezas: ['4-como-funciona'], textoDe: '4-como-funciona' },
  { dia: 'Viernes 30', hora: '19:00', tipo: 'Publicación', titulo: 'Plan semanal',
    piezas: ['5-plan-semanal'], textoDe: '5-plan-semanal' },
  { dia: 'Sábado 31', hora: '11:00', tipo: 'Publicación', titulo: 'Si nadie llega',
    piezas: ['6-si-nadie-llega'], textoDe: '6-si-nadie-llega' },
  { dia: 'Domingo 1 nov', hora: '11:00', tipo: 'Publicación', titulo: 'Convocatoria a aseadores',
    piezas: ['7-aseadores'], textoDe: '7-aseadores' },

  { dia: 'Lunes 2 nov', hora: '19:00', tipo: 'Carrusel', titulo: 'Cómo funciona, paso a paso',
    piezas: ['9-carrusel-1-tapa', '9-carrusel-2-paso1', '9-carrusel-3-paso2', '9-carrusel-4-paso3', '9-carrusel-5-cierre'],
    textoDe: '9-carrusel',
    aviso: 'Las cinco láminas van en una sola publicación, en este orden. Instagram vuelve a mostrar un carrusel a quien no lo terminó, por eso la tapa dice "Desliza".' },

  { dia: 'Miércoles 4 nov', hora: '13:00', tipo: 'Reel', titulo: 'El video explicativo',
    piezas: [], archivo: 'video-como-funciona.mp4', textoDe: 'video-como-funciona',
    aviso: 'El video no trae audio: ponle música del catálogo de Instagram al subirlo. Un Reel mudo se muestra menos.' },
];

const HISTORIAS = [
  { nombre: 'historia-1-encuesta', titulo: 'La encuesta',
    sticker: 'Sticker de <b>encuesta</b>, con las opciones: $39.990 · $51.990 · $64.990 · Más' },
  { nombre: 'historia-2-respuesta', titulo: 'La respuesta',
    sticker: 'Sin sticker. Súbela unas horas después, cuando ya haya votos.' },
  { nombre: 'historia-3-pregunta', titulo: 'La caja de preguntas',
    sticker: 'Sticker de <b>preguntas</b>. Lo que te respondan es material para las publicaciones de la semana siguiente.' },
  { nombre: 'historia-4-precios', titulo: 'Los precios',
    sticker: 'Sticker de <b>link</b> al sitio.' },
];

const tarjeta = (p, i) => `
  <article class="tarjeta" data-clave="pub-${i}">
    <header class="cabecera">
      <label class="hecho">
        <input type="checkbox" id="hecho-${i}">
        <span class="marca" aria-hidden="true"></span>
      </label>
      <div class="cuando">
        <span class="dia">${p.dia} · ${p.hora}</span>
        <h3>${p.titulo}</h3>
      </div>
      <span class="tipo tipo-${p.tipo.toLowerCase()}">${p.tipo}</span>
    </header>

    ${p.piezas.length ? `<div class="tira${p.piezas.length > 1 ? ' multiple' : ''}">
      ${p.piezas.map((n, j) => `<figure><img src="${miniatura(n)}" alt="${p.titulo}${p.piezas.length > 1 ? `, lámina ${j + 1}` : ''}" loading="lazy">${p.piezas.length > 1 ? `<figcaption>${j + 1}</figcaption>` : ''}</figure>`).join('')}
    </div>` : ''}

    ${p.archivo ? `<p class="archivo">Archivo: <code>${p.archivo}</code></p>` : ''}
    ${p.aviso ? `<p class="aviso">${p.aviso}</p>` : ''}

    <div class="texto">
      <div class="texto-cabecera">
        <span>Texto de la publicación</span>
        <button type="button" class="copiar" data-objetivo="texto-${i}">Copiar</button>
      </div>
      <pre id="texto-${i}">${escapar(p.textoDe ? texto(p.textoDe) : '')}</pre>
    </div>
  </article>`;

const historia = (h, i) => `
  <article class="tarjeta historia" data-clave="his-${i}">
    <header class="cabecera">
      <label class="hecho">
        <input type="checkbox" id="hecho-his-${i}">
        <span class="marca" aria-hidden="true"></span>
      </label>
      <div class="cuando">
        <span class="dia">Historia ${i + 1}</span>
        <h3>${h.titulo}</h3>
      </div>
    </header>
    <div class="tira vertical">
      <figure><img src="${miniatura(h.nombre)}" alt="${h.titulo}" loading="lazy"></figure>
      <p class="aviso">${h.sticker}</p>
    </div>
  </article>`;

const html = `<title>Plan de publicación Aseada</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&display=swap">
<style>
  :root {
    --papel: #F6F7F1;
    --superficie: #FFFFFF;
    --tinta: #15201A;
    --tenue: #5B665F;
    --borde: #DCE4DA;
    --pino: #1F5C46;
    --oro: #B07C12;
    --oro-fondo: #FBF1DC;
    --fuente: 'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  :root:not([data-theme="light"]) { }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --papel: #0E1813;
      --superficie: #16241D;
      --tinta: #EDF1EB;
      --tenue: #93A69A;
      --borde: #27372E;
      --pino: #4E9E79;
      --oro: #E8A93B;
      --oro-fondo: #2A2113;
    }
  }

  :root[data-theme="dark"] {
    --papel: #0E1813;
    --superficie: #16241D;
    --tinta: #EDF1EB;
    --tenue: #93A69A;
    --borde: #27372E;
    --pino: #4E9E79;
    --oro: #E8A93B;
    --oro-fondo: #2A2113;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--papel);
    color: var(--tinta);
    font-family: var(--fuente);
    -webkit-font-smoothing: antialiased;
  }

  .envoltura {
    max-width: 680px;
    margin: 0 auto;
    padding-inline: 16px;
    padding-block: 28px 64px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  header.principal { display: flex; flex-direction: column; gap: 10px; }

  .antetitulo {
    font-size: 12px; font-weight: 600; letter-spacing: 2px;
    text-transform: uppercase; color: var(--pino);
  }

  h1 {
    margin: 0; font-size: clamp(28px, 7vw, 40px); font-weight: 800;
    letter-spacing: -1.2px; line-height: 1.03; text-wrap: balance;
  }

  .intro { margin: 0; font-size: 15px; line-height: 1.55; color: var(--tenue); }

  .avance {
    display: flex; align-items: center; gap: 12px;
    background: var(--superficie); border: 1px solid var(--borde);
    border-radius: 14px; padding: 14px 16px; font-size: 14px;
  }
  .avance b { font-variant-numeric: tabular-nums; }
  .barra { flex: 1; height: 8px; background: var(--borde); border-radius: 999px; overflow: hidden; }
  .barra span { display: block; height: 100%; width: 0; background: var(--pino); transition: width 220ms ease; }

  h2.seccion {
    margin: 10px 0 0; font-size: 19px; font-weight: 800; letter-spacing: -0.4px;
    padding-bottom: 10px; border-bottom: 2px solid var(--borde);
  }

  .tarjeta {
    background: var(--superficie); border: 1px solid var(--borde);
    border-radius: 18px; padding: 16px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .tarjeta.listo { opacity: 0.55; }

  .cabecera { display: flex; align-items: flex-start; gap: 12px; }
  .cuando { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .dia { font-size: 12px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: var(--tenue); }
  .cuando h3 { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.4px; line-height: 1.2; }

  .hecho { position: relative; flex: none; width: 26px; height: 26px; cursor: pointer; }
  .hecho input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  .marca {
    display: block; width: 26px; height: 26px; border: 2px solid var(--borde);
    border-radius: 8px; transition: background 140ms ease, border-color 140ms ease;
  }
  .hecho input:checked + .marca { background: var(--pino); border-color: var(--pino); }
  .hecho input:checked + .marca::after {
    content: ""; position: absolute; left: 9px; top: 4px; width: 6px; height: 12px;
    border: solid #FFF; border-width: 0 2.5px 2.5px 0; transform: rotate(42deg);
  }
  .hecho input:focus-visible + .marca { outline: 2px solid var(--pino); outline-offset: 2px; }

  .tipo {
    flex: none; font-size: 11px; font-weight: 800; letter-spacing: 0.6px;
    text-transform: uppercase; padding: 5px 10px; border-radius: 999px;
    background: var(--oro-fondo); color: var(--oro);
  }

  .tira { display: flex; gap: 8px; }
  .tira figure { margin: 0; flex: 1; position: relative; }
  .tira img { width: 100%; display: block; border-radius: 10px; border: 1px solid var(--borde); }
  .tira.multiple { overflow-x: auto; padding-bottom: 4px; }
  .tira.multiple figure { flex: none; width: 110px; }
  .tira figcaption {
    position: absolute; left: 6px; top: 6px; background: rgba(0,0,0,0.6); color: #FFF;
    font-size: 11px; font-weight: 800; border-radius: 6px; padding: 2px 7px;
  }
  .tira.vertical { flex-direction: column; align-items: flex-start; gap: 12px; }
  .tira.vertical figure { width: 150px; flex: none; }

  .aviso {
    margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--tinta);
    background: var(--oro-fondo); border-radius: 10px; padding: 11px 13px;
  }
  .archivo { margin: 0; font-size: 13.5px; color: var(--tenue); }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
    background: var(--papel); border: 1px solid var(--borde); border-radius: 5px; padding: 1px 5px;
  }

  .texto { display: flex; flex-direction: column; gap: 8px; }
  .texto-cabecera {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
    text-transform: uppercase; color: var(--tenue);
  }
  .texto pre {
    margin: 0; font-family: var(--fuente); font-size: 14.5px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
    background: var(--papel); border: 1px solid var(--borde);
    border-radius: 12px; padding: 13px 14px; max-height: 190px; overflow-y: auto;
  }

  button.copiar {
    font-family: inherit; font-size: 13px; font-weight: 700; letter-spacing: 0;
    text-transform: none; color: #FFF; background: var(--pino);
    border: none; border-radius: 999px; padding: 8px 18px; cursor: pointer;
    min-height: 36px;
  }
  button.copiar:hover { filter: brightness(1.08); }
  button.copiar:focus-visible { outline: 2px solid var(--oro); outline-offset: 2px; }
  button.copiar.ok { background: var(--oro); color: #15201A; }

  .guardado {
    background: var(--superficie); border: 1px dashed var(--borde);
    border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
  }
  .guardado h3 { margin: 0; font-size: 17px; font-weight: 800; }
  .guardado p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--tenue); }
  .guardado img { width: 130px; border-radius: 10px; border: 1px solid var(--borde); display: block; }

  @media (prefers-reduced-motion: reduce) {
    .barra span, .marca, button.copiar { transition: none; }
  }
</style>

<div class="envoltura">

  <header class="principal">
    <span class="antetitulo">Semana de lanzamiento</span>
    <h1>Plan de publicación Aseada</h1>
    <p class="intro">
      Cada publicación con su imagen y su texto listo. Aprieta <b>Copiar</b>,
      guarda la imagen y súbela: son dos minutos. Marca el cuadrito cuando la
      publiques; esta página se acuerda en este teléfono.
    </p>
  </header>

  <div class="avance">
    <span>Publicadas</span>
    <b id="contador">0 de ${PUBLICACIONES.length + HISTORIAS.length}</b>
    <div class="barra"><span id="barra"></span></div>
  </div>

  <h2 class="seccion">Primera semana · una por día</h2>
  ${PUBLICACIONES.slice(0, 7).map(tarjeta).join('')}

  <h2 class="seccion">Segunda semana · carrusel y video</h2>
  ${PUBLICACIONES.slice(7).map((p, i) => tarjeta(p, i + 7)).join('')}

  <h2 class="seccion">Historias · cuando quieras</h2>
  ${HISTORIAS.map(historia).join('')}

  <div class="guardado">
    <h3>Esta guárdala para después</h3>
    <img src="${miniatura('8-precios-nuevos')}" alt="Afiche de la rebaja de precios">
    <p>
      El afiche de la rebaja compara el precio viejo con el nuevo. En una cuenta
      recién abierta nadie vio el viejo, así que anuncia una baja sobre un precio
      que el público nunca conoció y suena a truco de vitrina. Úsalo cuando ya
      tengas seguidores.
    </p>
  </div>

</div>

<script>
(function () {
  "use strict";

  var LLAVE = "aseada-plan-publicacion";
  var casillas = Array.prototype.slice.call(document.querySelectorAll('.hecho input'));
  var contador = document.getElementById("contador");
  var barra = document.getElementById("barra");
  var total = casillas.length;

  function leer() {
    try {
      return JSON.parse(localStorage.getItem(LLAVE) || "{}");
    } catch (e) {
      return {};
    }
  }

  function guardar(estado) {
    try {
      localStorage.setItem(LLAVE, JSON.stringify(estado));
    } catch (e) {
      /* Modo privado o almacenamiento bloqueado: la pagina sigue sirviendo igual. */
    }
  }

  function refrescar() {
    var hechas = casillas.filter(function (c) { return c.checked; }).length;
    contador.textContent = hechas + " de " + total;
    barra.style.width = total ? (hechas / total * 100) + "%" : "0%";
    casillas.forEach(function (c) {
      c.closest(".tarjeta").classList.toggle("listo", c.checked);
    });
  }

  var estado = leer();
  casillas.forEach(function (c) {
    var clave = c.closest(".tarjeta").dataset.clave;
    c.checked = Boolean(estado[clave]);
    c.addEventListener("change", function () {
      var actual = leer();
      actual[clave] = c.checked;
      guardar(actual);
      refrescar();
    });
  });
  refrescar();

  document.querySelectorAll("button.copiar").forEach(function (boton) {
    boton.addEventListener("click", function () {
      var texto = document.getElementById(boton.dataset.objetivo).textContent;
      var listo = function () {
        boton.textContent = "Copiado";
        boton.classList.add("ok");
        setTimeout(function () {
          boton.textContent = "Copiar";
          boton.classList.remove("ok");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(listo, function () {
          boton.textContent = "No se pudo";
        });
      } else {
        // Respaldo para navegadores sin API de portapapeles.
        var area = document.createElement("textarea");
        area.value = texto;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand("copy"); listo(); } catch (e) { boton.textContent = "No se pudo"; }
        document.body.removeChild(area);
      }
    });
  });
})();
</script>
`;

writeFileSync(SALIDA, html);
console.log(`Listo: ${SALIDA} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
