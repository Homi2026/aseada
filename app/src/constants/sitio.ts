/**
 * Identidad publica del sitio. Vive aca porque la usan dos lugares distintos:
 * el documento HTML raiz (`src/app/+html.tsx`) y el <Head> del layout, que es
 * el que termina escribiendo el <title> de verdad en la exportacion web.
 */
/**
 * La fumigacion esta apagada por ley, no por decision de producto: el Decreto
 * 157/2005 del Minsal exige autorizacion sanitaria de la SEREMI y un
 * responsable tecnico titulado PRESENTE en cada faena. Un aseador solo en una
 * casa no cumple el art. 104. El backend la rechaza en `revisarSolicitud`;
 * esta bandera es su espejo en la interfaz, para no ofrecer lo que la API no
 * acepta. Las dos se prenden juntas el dia que se intermedien empresas ya
 * autorizadas.
 */
export const FUMIGACION_HABILITADA = false;

export const TITULO_SITIO = 'Aseada · Aseo del hogar en Chile';

export const DESCRIPCION_SITIO =
  'Agenda aseo del hogar con aseadores de confianza. Sabes el precio antes de solicitar y tu pago queda retenido hasta que confirmas que el servicio quedó bien.';
