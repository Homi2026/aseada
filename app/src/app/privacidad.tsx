import { PaginaLegal } from '../components/pagina-legal';
import { SOPORTE_EMAIL } from '../constants/sitio';

export default function Privacidad() {
  return (
    <PaginaLegal
      titulo="Política de privacidad"
      actualizado="23 de octubre de 2026"
      secciones={[
        {
          titulo: 'Qué datos guardamos',
          parrafos: [
            'De los clientes: nombre, correo, teléfono si lo entregas, la dirección de cada servicio y el historial de servicios, pagos y reclamos.',
            'De los aseadores, además: la comuna donde trabajan, su experiencia y los datos bancarios para transferirles sus pagos.',
            'No guardamos datos de tarjetas. Los pagos los procesa Flow, que tiene su propia política de privacidad.',
          ],
        },
        {
          titulo: 'Para qué los usamos',
          parrafos: [
            'Para prestar el servicio: coordinar cada trabajo entre cliente y aseador, cobrar, retener y liberar los pagos, procesar devoluciones, atender reclamos y enviarte avisos sobre tus servicios. No vendemos tus datos ni los usamos para publicidad de terceros.',
          ],
        },
        {
          titulo: 'Con quién los compartimos',
          parrafos: [
            'El aseador ve la dirección del servicio solo después de aceptarlo, y nunca antes. Compartimos con Flow los datos necesarios para cobrar y devolver pagos. Nuestros servidores y la base de datos están en un proveedor de infraestructura en la nube, que puede estar fuera de Chile.',
            'Solo entregaríamos tus datos a una autoridad cuando la ley lo exija.',
          ],
        },
        {
          titulo: 'Cuánto tiempo los guardamos',
          parrafos: [
            'Mientras tu cuenta esté activa y, después, el tiempo que exijan las obligaciones tributarias y contables sobre los pagos realizados.',
          ],
        },
        {
          titulo: 'Tus derechos',
          parrafos: [
            'Puedes pedir acceder a tus datos, corregirlos, eliminarlos u oponerte a su uso, conforme a la Ley 19.628 sobre Protección de la Vida Privada. Escríbenos desde el correo de tu cuenta y respondemos tu solicitud.',
          ],
        },
        {
          titulo: 'Contacto',
          parrafos: [`Para cualquier consulta sobre tus datos, escríbenos a ${SOPORTE_EMAIL}.`],
        },
      ]}
    />
  );
}
