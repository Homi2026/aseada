import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

import { DESCRIPCION_SITIO, TITULO_SITIO, URL_SITIO } from '@/constants/sitio';

// Este es el documento HTML raiz de la exportacion web: lo que va aca sale en
// todas las paginas del sitio. Sin estas etiquetas, compartir el link no
// mostraba ni titulo ni descripcion.
// El <title> no va aca sino en el <Head> del layout: expo-router siempre
// inyecta su propio <title> al comienzo del head, y el navegador se queda con
// el primero. Si lo escribieramos aca, el titulo visible seria el vacio de
// expo-router.
// og:image sale de app/public/og.png, que se genera con
// `node tools/exportar-instagram.mjs` desde tools/piezas-instagram/CompartirLink.dc.html.
// Tiene que ser una direccion absoluta: al previsualizar un link, WhatsApp y
// Facebook no resuelven rutas relativas.
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
        <meta property="og:url" content={URL_SITIO} />
        <meta property="og:image" content={`${URL_SITIO}/og.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Aseada · Tu casa limpia. Tu tiempo, de vuelta." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={`${URL_SITIO}/og.png`} />
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
