import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

import { DESCRIPCION_SITIO, TITULO_SITIO } from '@/constants/sitio';

// Este es el documento HTML raiz de la exportacion web: lo que va aca sale en
// todas las paginas del sitio. Sin estas etiquetas, compartir el link no
// mostraba ni titulo ni descripcion.
// El <title> no va aca sino en el <Head> del layout: expo-router siempre
// inyecta su propio <title> al comienzo del head, y el navegador se queda con
// el primero. Si lo escribieramos aca, el titulo visible seria el vacio de
// expo-router.
// No hay og:image: la unica imagen publicada es el favicon y a ese tamano se ve
// peor que no poner nada. Cuando exista una imagen de marca (1200x630), va aca.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="description" content={DESCRIPCION_SITIO} />
        <meta property="og:site_name" content="Aseada" />
        <meta property="og:title" content={TITULO_SITIO} />
        <meta property="og:description" content={DESCRIPCION_SITIO} />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="es_CL" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={TITULO_SITIO} />
        <meta name="twitter:description" content={DESCRIPCION_SITIO} />
        <ScrollViewStyleReset />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
