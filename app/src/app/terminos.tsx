import { PaginaLegal } from '../components/pagina-legal';
import { SOPORTE_EMAIL } from '../constants/sitio';

export default function Terminos() {
  return (
    <PaginaLegal
      titulo="Términos y condiciones"
      actualizado="23 de octubre de 2026"
      secciones={[
        {
          titulo: 'Qué es Aseada',
          parrafos: [
            'Aseada es una plataforma que conecta a personas que necesitan servicios para su hogar con aseadores que prestan esos servicios de forma independiente. Aseada cobra el servicio, retiene el pago como garantía y lo entrega al aseador cuando el servicio se confirma.',
            'Los aseadores no son trabajadores de Aseada: prestan sus servicios como independientes y emiten su propia boleta de honorarios. Antes de poder tomar trabajos, cada aseador pasa por una revisión.',
          ],
        },
        {
          titulo: 'Precios y pago',
          parrafos: [
            'Ves el precio total antes de pagar. Incluye el valor del servicio, la comisión de Aseada y el IVA de esa comisión. No hay cobros adicionales por el mismo servicio.',
            'Los pagos se procesan con Flow. Aseada no recibe ni guarda los datos de tu tarjeta.',
          ],
        },
        {
          titulo: 'Tu pago queda retenido',
          parrafos: [
            'El aseador no recibe tu pago hasta que confirmas que el servicio quedó bien. Si no confirmas ni reportas un problema dentro de las 24 horas siguientes a que el aseador lo marque como terminado, el servicio se da por conforme y el pago se libera.',
          ],
        },
        {
          titulo: 'Si el aseador no llega',
          parrafos: [
            'Si el aseador no marca su llegada dentro de las 2 horas siguientes a aceptar el servicio, te avisamos y puedes elegir: reagendarlo con otro aseador para hoy o mañana, o pedir que te devolvamos el dinero.',
            'Si pides la devolución, la iniciamos de inmediato y te devolvemos el dinero en un plazo máximo de 72 horas. Flow te enviará un correo para que confirmes la devolución; el plazo en que el dinero aparece en tu tarjeta depende de tu banco.',
          ],
        },
        {
          titulo: 'Reclamos',
          parrafos: [
            'Si hubo un problema con un servicio, repórtalo desde tu historial antes de confirmarlo. Mientras revisamos el reclamo, el pago sigue retenido. Según lo que encontremos, liberamos el pago al aseador o te devolvemos el dinero.',
          ],
        },
        {
          titulo: 'Cancelaciones',
          parrafos: [
            'Si pagaste y todavía ningún aseador tomó el servicio, puedes reportarlo desde tu historial y te devolvemos el dinero. Si nadie toma tu servicio el día que pediste, te avisamos y puedes pedir la devolución.',
          ],
        },
        {
          titulo: 'Planes semanales',
          parrafos: [
            'Los planes mensual (4 visitas) y de 3 meses (12 visitas) se pagan por adelantado, con un precio por visita menor que el de una visita suelta. Las visitas se programan una por semana a partir de la fecha que elijas.',
            'Cada visita tiene la misma garantía que un servicio individual: su pago queda retenido hasta que la confirmas, y si el aseador no llega, puedes reagendarla o pedir la devolución de esa visita. Para cancelar visitas futuras de un plan, escríbenos a soporte.',
          ],
        },
        {
          titulo: 'Tu cuenta',
          parrafos: [
            'Eres responsable de mantener tu contraseña en reserva y de que los datos de tu cuenta sean correctos, en especial la dirección del servicio. Podemos suspender cuentas que se usen para fraude o para dañar a otros usuarios.',
          ],
        },
        {
          titulo: 'Tus derechos como consumidor',
          parrafos: [
            'Nada en estos términos limita los derechos que te da la Ley 19.496 sobre Protección de los Derechos de los Consumidores. Estos términos se rigen por las leyes de Chile.',
          ],
        },
        {
          titulo: 'Contacto',
          parrafos: [`Para cualquier duda, reclamo o solicitud, escríbenos a ${SOPORTE_EMAIL}.`],
        },
      ]}
    />
  );
}
