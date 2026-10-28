# Semana de lanzamiento en Instagram

Siete publicaciones, una por día. Los textos están acá para copiar y pegar.

**Las imágenes ya están listas como archivos PNG**, en `~/Documents/aseada-instagram/`
(carpeta Documentos → aseada-instagram). Son cuadradas, 1080×1080, listas para subir.

**Antes de publicar nada:** pon el link del sitio en la biografía de Instagram.
Todas las piezas dicen "Link en la bio".

Sitio: https://web-production-d6ba2.up.railway.app

## Calendario

Del miércoles 28 de octubre al martes 3 de noviembre. Las horas apuntan a
cuando la gente está en el teléfono: tarde-noche entre semana, media mañana el
fin de semana.

| Día | Fecha | Hora | Publicación | Archivo |
|---|---|---|---|---|
| 1 | Mié 28 oct | 19:00 | Lanzamiento | `1-lanzamiento.png` |
| 2 | Jue 29 oct | 13:00 | Precios claros | `2-precios.png` |
| 3 | Vie 30 oct | 19:00 | Pago protegido | `3-pago-protegido.png` |
| 4 | Sáb 31 oct | 11:00 | Cómo funciona | `4-como-funciona.png` |
| 5 | Dom 1 nov | 11:00 | Plan semanal | `5-plan-semanal.png` |
| 6 | Lun 2 nov | 19:00 | Si nadie llega | `6-si-nadie-llega.png` |
| 7 | Mar 3 nov | 13:00 | Convocatoria a aseadores | `7-aseadores.png` |

Los nombres de día y las fechas tienen que calzar. La primera version de esta
tabla los tenia corridos en uno, y un calendario con el dia equivocado manda a
programar en la fecha equivocada.

Si prefieres otras fechas, corre el calendario completo: el orden importa más
que los días exactos. El día 1 tiene que ir primero porque anuncia el sitio, y
el día 7 al final porque convoca aseadores una vez que ya se vio la propuesta.

## Las imágenes también están en línea

Cada pieza tiene una dirección pública en el sitio, para programarlas desde
Metricool o compartirlas sin adjuntar archivos:

https://web-production-d6ba2.up.railway.app/instagram/1-lanzamiento.png

Cambia el nombre del archivo al final por el de cada día.

## Hashtags

Repetir los mismos en todas las publicaciones hace que Instagram las agrupe.
Usa entre 5 y 8, mezclando los de marca con los de búsqueda real:

`#Aseada #AseoDelHogar #LimpiezaSantiago #ServicioDeAseo #CasaLimpia #Emprendimiento #Chile`

---

## Día 1 · Lanzamiento

Aseada ya está en línea.

Pides aseo para tu casa, sabes el precio exacto antes de agendar, y tu pago
queda retenido hasta que confirmas que el trabajo quedó bien.

Sin cotizaciones por WhatsApp. Sin sorpresas al final.

Link en la bio para agendar.

---

## Día 2 · Precios claros

Esto es lo que cuesta. Nada más.

🏠 Depto hasta 50 m² · 3 horas · $35.990
🏡 Casa hasta 120 m² · 5 horas · $51.990
🏘️ Casa hasta 200 m² · 6,5 horas · $64.990

El precio que ves es el que pagas. Lo sabes antes de confirmar, no después.

---

## Día 3 · Pago protegido

La pregunta que más nos hacen: ¿y si pago y el trabajo queda mal?

No pasa, porque tu dinero no se entrega al tiro.

Pagas al agendar, pero Aseada retiene ese dinero. El aseador lo recibe recién
cuando tú confirmas que quedó bien. Si hubo un problema, lo reportas desde la
app y te devolvemos.

---

## Día 4 · Cómo funciona

Agendar toma dos minutos:

1. Eliges el tamaño de tu hogar y ves el precio exacto
2. Un aseador toma tu solicitud, y ves su nombre, teléfono y calificación
3. Revisas el trabajo, confirmas, y recién ahí se le paga

Eso es todo. Link en la bio.

---

## Día 5 · Plan semanal

Si necesitas aseo todas las semanas, sale más barato.

Plan mensual: 4 visitas a $34.190 cada una
Plan 3 meses: 12 visitas a $33.109 cada una

(Valores para un departamento de hasta 50 m². Una visita suelta cuesta $35.990.)

Cada visita mantiene la misma garantía: el pago queda retenido hasta que la
confirmas.

---

## Día 6 · Si nadie llega

¿Y si no llega nadie? Te respondemos derecho:

Nos damos cuenta solos. Si el aseador no marca su llegada, el sistema lo
detecta y te avisa. No tienes que reclamar nada.

Y tú eliges: lo reagendamos con otro aseador para hoy o mañana, o te
devolvemos el dinero en máximo 72 horas.

Tu pago sigue retenido todo ese tiempo. Nunca queda en manos de alguien que no
llegó.

---

## Día 7 · Convocatoria a aseadores

¿Eres detallista y responsable? Nos faltan manos.

En Aseada ves cuánto ganas antes de aceptar un trabajo. El cliente ya pagó: el
dinero está retenido y esperando por ti.

Trabajas como prestador independiente, con tu boleta de honorarios, y eliges
qué trabajos tomar.

Postula desde el link en la bio.

---

## La página con el plan, para el teléfono

Todas las publicaciones en orden, cada una con su miniatura y su texto con un
botón para copiarlo, y un cuadrito que marcar cuando ya la subiste:

https://claude.ai/artifact/WZVTANNaHxyvFbLECBBSVp

Está pensada para tenerla abierta en el teléfono mientras publicas: copiar,
guardar la imagen, subir. El avance se guarda en ese mismo teléfono.

Se vuelve a generar, si cambian las piezas o los textos, con:

    cd ~/Documents/aseada-instagram && for f in *.png; do \
      sips -s format jpeg -s formatOptions 62 -Z 400 "$f" --out /tmp/mini/"${f%.png}".jpg; done
    node tools/armar-plan-publicacion.mjs /tmp/mini /tmp/plan.html

## Cómo publicar

**A mano (no depende de nada).** Abres Instagram, subes el PNG del día y pegas
su texto. Son dos minutos por publicación.

**Programado con Metricool (recomendado).** Metricool sube las publicaciones
solo, a la hora que fijes. Hoy la cuenta tiene conectada `recetasdecorazon`,
no Aseada. Para usarlo:

1. Entra a Metricool y crea una marca nueva llamada "Aseada".
2. Conecta ahí el Instagram de Aseada (tiene que ser cuenta de empresa o de
   creador; una cuenta personal no se puede programar).
3. Avísame: con la marca conectada programo las 7 de una vez, con sus fechas y
   horas, y puedo consultar cuál es la mejor hora según tu audiencia real.

## Si quieres cambiar las imágenes

Los diseños viven en el lienzo "Lanzamiento Aseada · Instagram". Después de
editarlos ahí, se vuelven a generar los PNG corriendo el script de exportación.
Pídemelo y lo hago.

## Segunda semana: carrusel, historias y video

La primera semana son siete publicaciones sueltas. Lo que sigue es material
para la semana del 4 al 8 de noviembre, con tres formatos que la primera
semana no tiene.

### El carrusel didáctico (5 láminas)

`9-carrusel-1-tapa.png` a `9-carrusel-5-cierre.png`, en ese orden, en una
sola publicación. El texto está en `9-carrusel.txt`.

Un carrusel se mide distinto a una foto: Instagram lo vuelve a mostrar a
quien no lo terminó. Por eso la tapa dice "Desliza" y la última lámina es la
que lleva al link.

### Las historias interactivas

Las historias no se guardan en el perfil, pero son lo único que genera
respuestas directas. Las cuatro piezas son verticales, 1080×1920, y están
diseñadas con una franja vacía a propósito: **ahí va el sticker**, que se
pone en Instagram al momento de subirla.

| Archivo | Sticker que hay que agregar |
|---|---|
| `historia-1-encuesta.png` | Encuesta, con opciones de precio: `$39.990` / `$51.990` / `$64.990` / `Más` |
| `historia-2-respuesta.png` | Ninguno. Va después de la encuesta, cuando ya votaron. |
| `historia-3-pregunta.png` | Caja de preguntas ("Hazme una pregunta") |
| `historia-4-precios.png` | Sticker de link al sitio |

La 1 y la 2 van juntas: la encuesta primero, y la respuesta unas horas
después, cuando ya hay votos. Las respuestas de la caja de preguntas dan
material para publicaciones de la semana siguiente, escritas con las dudas
reales de la gente en vez de las que uno se imagina.

### El video explicativo

`video-como-funciona.mp4`, vertical, 23 segundos, sin voz. Se sube como
Reel. El texto está en `video-como-funciona.txt`.

No tiene audio, así que **hay que ponerle música desde Instagram al subirlo**:
un Reel sin sonido se reproduce menos. Cualquier pista instrumental del
catálogo sirve; lo que importa es que haya algo.

El video se vuelve a generar con:

    node tools/video-instagram  # ver tools/video-instagram/README.md

Los textos y los precios del video están en `tools/video-instagram/src/`.

### El video con una persona presentando

Es el que más confianza genera y el único que no puedo producir yo: necesita
a alguien frente a la cámara. El guion completo, los planos y las
instrucciones de grabación están en [video-presentacion.md](video-presentacion.md).

## Una advertencia sobre el afiche de "Bajamos los precios"

`8-precios-nuevos.png` muestra los precios viejos tachados y los nuevos al
lado. Funciona solo con gente que alcanzó a ver los precios anteriores.

En una cuenta recién abierta, nadie los vio: el afiche anuncia una rebaja
sobre un precio que esa persona nunca conoció, y suena a truco de vitrina.
**No lo uses en la semana de lanzamiento.** Guárdalo para cuando la cuenta
ya tenga seguidores, o úsalo ahora solo si alcanzaste a mandarle los precios
viejos a alguien por mensaje.

Para la semana de lanzamiento, el afiche de precios que corresponde es
`2-precios.png`, que simplemente dice cuánto cuesta.

## Después de la semana

Ideas para seguir, sin inventar nada que el sitio no haga:

- Antes y después de un servicio real (con permiso del cliente).
- Presentar a un aseador: su nombre, su comuna, hace cuánto trabaja.
- Responder dudas que lleguen por mensaje directo, en formato pregunta.
- Avisar cuando el servicio llegue a una comuna nueva.
