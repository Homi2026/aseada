import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';
import { avisar, confirmar } from '../../constants/dialogos';

const pesos = (n: any) => '$' + Number(n || 0).toLocaleString('es-CL');
const fecha = (f: string) => new Date(f).toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** En que va el pago de un trabajo, dicho para el trabajador. */
function estadoPago(item: any): { texto: string; color: string } | null {
  switch (item.estado) {
    case 'en_proceso':
      return { texto: 'Cuando termines, márcalo como terminado.', color: '#1d4ed8' };
    case 'completado':
      return { texto: 'Esperando que el cliente confirme. Si no responde, se confirma solo a las 24 horas.', color: '#7c3aed' };
    case 'en_reclamo':
      return { texto: 'El cliente reportó un problema. Tu pago queda retenido mientras lo revisamos.', color: '#b91c1c' };
    case 'reembolsado':
      return { texto: 'El reclamo se resolvió con devolución al cliente.', color: '#475569' };
  }
  switch (item.pago_trabajador_estado) {
    case 'esperando_fondos':
      return { texto: `Pago liberado. Flow nos deposita el ${fecha(item.pago_trabajador_disponible)} y te transferimos dentro de las 24 horas siguientes.`, color: '#b45309' };
    case 'por_transferir':
      return { texto: 'Pago liberado. Te lo transferimos dentro de las próximas 24 horas.', color: '#15803d' };
    case 'transferido':
      return { texto: `Transferido el ${fecha(item.pago_trabajador_transferido_en)}.`, color: '#15803d' };
  }
  return null;
}

export default function HistorialWorker() {
  const [servicios, setServicios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const { token } = await obtenerSesion();
      const res = await api.get('/api/mis-servicios', token!);
      setServicios(Array.isArray(res) ? res : []);
    } catch {
      setServicios([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const terminar = async (id: number) => {
    const ok = await confirmar('¿Terminaste el trabajo?',
      'Le avisaremos al cliente para que lo confirme. Tu pago se libera cuando lo confirme, o solo a las 24 horas si no responde.',
      'Sí, terminé');
    if (!ok) return;
    setOcupado(id);
    try {
      const { token } = await obtenerSesion();
      const res = await api.request('PUT', `/api/servicios/${id}/completar`, {}, token!);
      avisar('¡Listo!', res.mensaje);
      await cargar();
    } catch (e: any) {
      avisar('No se pudo marcar', e?.message || 'Intenta nuevamente.');
    } finally {
      setOcupado(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Historial de trabajos</Text>

      {servicios.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🧹</Text>
          <Text style={styles.emptyText}>Aún no tienes trabajos registrados</Text>
        </View>
      ) : (
        <FlatList
          data={servicios}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const pago = estadoPago(item);
            const monto = item.pago_trabajador_monto ?? item.worker_recibe;
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Trabajo #{item.id}</Text>
                <Text style={styles.cardText}>{item.tipo_servicio === 'fumigacion' ? `🪳 Fumigación · ${item.tipo_plaga || 'plaga'}` : '🧹 Aseo del hogar'}</Text>
                <Text style={styles.cardText}>📍 {item.direccion || 'Sin dirección'}</Text>
                <Text style={styles.cardText}>🏠 {item.metros} m²</Text>
                <Text style={styles.cardPrice}>{item.pago_trabajador_monto ? 'Recibirás' : 'Ganancia bruta'}: {pesos(monto)}</Text>
                {pago && <Text style={[styles.pago, { color: pago.color }]}>{pago.texto}</Text>}

                {item.estado === 'en_proceso' && (
                  <TouchableOpacity style={styles.btn} onPress={() => terminar(item.id)} disabled={ocupado === item.id}>
                    {ocupado === item.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>✅ Marcar como terminado</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 20 },
  list: { paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  cardTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#666', marginBottom: 4 },
  cardPrice: { marginTop: 8, fontSize: 18, fontWeight: 'bold', color: '#6C63FF' },
  pago: { marginTop: 8, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  btn: { backgroundColor: '#1f6b4f', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 12 },
  btnTexto: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { fontSize: 54, marginBottom: 12 },
  emptyText: { fontSize: 18, color: '#666' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f8ff' },
});
