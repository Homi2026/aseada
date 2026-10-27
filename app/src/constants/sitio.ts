/**
 * Identidad publica del sitio. Vive aca porque la usan dos lugares distintos:
 * el documento HTML raiz (`src/app/+html.tsx`) y el <Head> del layout, que es
 * el que termina escribiendo el <title> de verdad en la exportacion web.
 */
export const TITULO_SITIO = 'Aseada · Aseo del hogar y fumigación en Chile';

/**
 * De donde cuelga el sitio. og:image y og:url tienen que ser direcciones
 * absolutas: WhatsApp y Facebook no resuelven rutas relativas al previsualizar
 * un link. Cuando exista el dominio propio, se cambia aca o por la variable.
 */
export const URL_SITIO =
  process.env.EXPO_PUBLIC_SITE_URL || 'https://web-production-d6ba2.up.railway.app';

/** A donde escriben clientes y aseadores: contraseña olvidada, dudas, reclamos. */
export const SOPORTE_EMAIL = 'soporteaseada@gmail.com';

export const DESCRIPCION_SITIO =
  'Agenda aseo del hogar o fumigación con aseadores de confianza. Sabes el precio antes de solicitar y tu pago queda retenido hasta que confirmas que el servicio quedó bien.';
