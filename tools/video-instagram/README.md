# Video explicativo para Instagram

El Reel de "cómo funciona Aseada": vertical, 23 segundos, sin voz. Está hecho
con [Remotion](https://remotion.dev), que renderiza video desde React, así que
el texto y los precios se cambian editando código y volviendo a renderizar.

Vive aparte del resto del repo a propósito: usa React 19, y la app de Expo
tiene que quedarse en React 18.

## Ver el video mientras se edita

    cd tools/video-instagram
    npm install   # solo la primera vez
    npx remotion studio

Abre un editor en el navegador. Cada escena tiene su propia pestaña en
"Escenas", y los cambios se ven al instante.

## Generar el archivo para subir

    npx remotion render ComoFunciona ~/Documents/aseada-instagram/video-como-funciona.mp4

## Qué hay en `src/`

| Archivo | Qué contiene |
|---|---|
| `ComoFunciona.tsx` | El video armado: qué escena va primero y cuánto dura cada una. **Los textos y los precios están acá.** |
| `EscenaGancho.tsx` | La portada, los primeros 3 segundos. |
| `EscenaPaso.tsx` | La escena de un paso. Se usa tres veces con textos distintos. |
| `EscenaCierre.tsx` | El final con las tres garantías y el llamado a la acción. |
| `marca.ts` | Los colores y la tipografía, los mismos del sitio. |

## Si cambian los precios

El video nombra `$35.990` una vez, en el paso 1. Está en `ComoFunciona.tsx`,
en la propiedad `monto`. Después de cambiarlo hay que volver a renderizar y
subir el archivo nuevo: Instagram no deja reemplazar el video de un Reel ya
publicado, hay que borrarlo y subirlo de nuevo.

## El video no tiene audio

Es a propósito: la música se elige en Instagram al subir el Reel, desde su
catálogo, que es el único que no da problemas de derechos. Pero hay que
ponerle alguna, porque un Reel mudo se muestra menos.
