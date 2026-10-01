import { Linking, Platform } from 'react-native';
import { api } from './api';

/**
 * Crea el cobro en Flow para un servicio y lleva al cliente a pagar.
 * Despues de pagar, Flow lo devuelve a /cliente/historial.
 */
export async function irAPagar(servicioId: number, token: string) {
  const { url_pago } = await api.post('/api/pagos/crear', { servicio_id: servicioId }, token);
  if (!url_pago) throw new Error('Flow no devolvió el enlace de pago');
  if (Platform.OS === 'web') {
    window.location.href = url_pago;
  } else {
    await Linking.openURL(url_pago);
  }
}

/** Los estados que no dependen de si el aseador ya marco su llegada. */
const ESTADOS_CLIENTE_FIJOS: Record<string, { texto: string; color: string }> = {
  pendiente_pago: { texto: 'Falta pagar', color: '#b45309' },
  buscando_worker: { texto: 'Pago retenido · buscando trabajador', color: '#1d4ed8' },
  completado: { texto: 'Terminado · confirma si quedó bien', color: '#7c3aed' },
  en_reclamo: { texto: 'Reclamo en revisión · pago retenido', color: '#b91c1c' },
  pagado: { texto: 'Confirmado', color: '#15803d' },
  reembolsado: { texto: 'Dinero devuelto', color: '#475569' },
};

/**
 * Lo que el cliente ve del estado de su servicio. 'en_proceso' se distingue
 * segun si el aseador ya marco su llegada o si todavia va en camino.
 */
export function estadoCliente(servicio: { estado: string; llegada_en?: string | null }): { texto: string; color: string } {
  if (servicio.estado === 'en_proceso') {
    return servicio.llegada_en
      ? { texto: 'El aseador llegó', color: '#1d4ed8' }
      : { texto: 'Aseador asignado · en camino', color: '#1d4ed8' };
  }
  return ESTADOS_CLIENTE_FIJOS[servicio.estado] || { texto: servicio.estado, color: '#666' };
}

export const MOTIVOS_RECLAMO = [
  { id: 'no_llego', texto: 'No llegó nadie' },
  { id: 'incompleto', texto: 'El trabajo quedó incompleto' },
  { id: 'danio', texto: 'Hubo un daño o pérdida' },
  { id: 'otro', texto: 'Otro problema' },
];

export const GARANTIA = 'Tu pago queda retenido por Aseada. El trabajador solo lo recibe cuando confirmas que el servicio quedó bien. Si nadie llega, el trabajo no se realiza o hay cualquier problema, repórtalo desde tu historial y te devolvemos el dinero.';
