# Generar la presentadora en Higgsfield

El video de alguien presentando Aseada se puede hacer con un avatar de
Higgsfield en vez de grabar a una persona. **La generación la haces tú en
higgsfield.ai**: el conector que tengo acá sólo lee el catálogo y el saldo, no
genera.

Tu cuenta: plan **Plus**, con 277,55 créditos al 26 de octubre de 2026.

## Qué modelo usar

**Marketing Studio** (`marketing_studio_video`), con el preset **UGC**. Es el
que está hecho para esto: un avatar hablando a cámara, formato de Reel.

| Ajuste | Valor |
|---|---|
| Modelo | Marketing Studio |
| Preset / modo | UGC |
| Formato | 9:16 (vertical) |
| Resolución | 1080p |
| Duración | 15 segundos (es el máximo del modelo) |
| Audio | Activado |
| Avatar | Uno femenino del catálogo de presets |
| Setting | Una cocina o living con luz de día |

## El guion, cortado a 15 segundos

El guion de 50 segundos no cabe. Este está medido para entrar en 15:

> Hola, soy [nombre], de Aseada. Eliges el tamaño de tu casa, ves el precio
> exacto y agendas. Tu pago queda retenido hasta que confirmas que quedó bien.
> El link está en la bio.

Son 33 palabras. Dichas a ritmo normal, unos 13 segundos, que deja aire al
final.

Fíjate que **no dice el monto**. Es a propósito: el precio aparece escrito en
pantalla en el montaje, justo cuando ella dice "ves el precio exacto". Así el
video no caduca si cambia la tabla de precios — sólo hay que volver a renderizar
el montaje, no a generar el avatar.

## Después de generarlo

1. Descarga el MP4 de Higgsfield.
2. Déjalo en `tools/video-instagram/public/presentadora.mp4`.
3. Renderiza:

       cd tools/video-instagram
       npx remotion render Presentacion ~/Documents/aseada-instagram/video-presentacion.mp4

El montaje ya está ajustado a 15 segundos y le agrega la portada de Aseada, el
rótulo con el nombre, el precio en pantalla al segundo 6 y el cierre con las
tres garantías. El resultado son unos 22 segundos.

Antes de renderizar, en `src/Presentacion.tsx` cambia `nombre="[tu nombre]"`
por el nombre que le pongas a la presentadora.

## Dos cosas que conviene mirar antes de gastar créditos

**El español.** Estos modelos generan audio bien en inglés y más irregular en
español, y casi nunca con acento chileno. Genera **una sola prueba** y escúchala
antes de hacer más: si suena a español neutro de doblaje, no se nota tanto; si
suena mal pronunciado, mejor volver a la idea de grabar a una persona.

Si quedó bien de imagen pero mal de voz, hay dos modelos para arreglarlo sin
regenerar todo: `dubbing` (que incluye `spa`) y `sync_so` (Sync Lipsync 3), que
pega un audio nuevo sobre el video existente.

**Qué es y qué no es.** Un avatar generado es una presentadora, no una persona
de la empresa. No le pongas nombre y apellido de alguien real ni la presentes
como trabajadora o dueña de Aseada: eso sí sería hacer pasar por real algo que
no lo es. Que diga "de Aseada" y cuente el servicio está bien.

Y una nota práctica: Aseada vende que un desconocido entre a tu casa con
confianza. Una cara real de la familia hace más por eso que un avatar, aunque
el avatar salga hoy y la grabación tome una tarde. Vale la pena hacer las dos y
ver cuál anda mejor.
