import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';
import { avisar, confirmar } from '../../constants/dialogos';
import { ESTADOS_CLIENTE, GARANTIA, MOTIVOS_RECLAMO, irAPagar } from '../../constants/pagos';

// Mientras el pago no se libera, el cliente puede reportar un problema.
const RECLAMABLES = ['buscando_worker', 'en_proceso', 'completado'];

export default function HistorialCliente() {
  // Flow devuelve aqui con ?pago=exitoso|rechazado despues de pagar.
  const { pago } = useLocalSearchParams<{ pago?: string }>();
  const [servicios, setServicios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [reclamando, setReclamando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');

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

  const conSesion = async (id: number, accion: (token: string) => Promise<void>) => {
    setOcupado(id);
    try {
      const { token } = await obtenerSesion();
      await accion(token!);
    } catch (e: any) {
      avisar('No se pudo completar', e?.message || 'Intenta nuevamente.');
    } finally {
      setOcupado(null);
    }
  };

  const pagar = (id: number) => conSesion(id, (token) => irAPagar(id, token));

  const confirmarServicio = async (id: number) => {
    const ok = await confirmar('¿Quedó todo bien?',
      'Al confirmar, liberamos el pago al trabajador. Si hubo un problema, usa "Reportar un problema".', 'Sí, quedó bien');
    if (!ok) return;
    await conSesion(id, async (token) => {
      const res = await api.post(`/api/servicios/${id}/confirmar`, {}, token);
      avisar('¡Gracias!', res.mensaje);
      await cargar();
    });
  };

  const enviarReclamo = async (id: number) => {
    if (!motivo) return avisar('Falta el motivo', 'Elige qué pasó.');
    await conSesion(id, async (token) => {
      const res = await api.post(`/api/servicios/${id}/reclamo`, { motivo, detalle }, token);
      avisar('Recibimos tu reclamo', res.mensaje);
      setReclamando(null);
      setMotivo('');
      setDetalle('');
      await cargar();
    });
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
      <Text style={styles.title}>Historial de servicios</Text>

      {pago === 'exitoso' && (
        <View style={[styles.banner, styles.bannerOk]}>
          <Text style={styles.bannerTitulo}>✅ Pago recibido</Text>
          <Text style={styles.bannerTexto}>{GARANTIA}</Text>
        </View>
      )}
      {pago === 'rechazado' && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={styles.bannerTitulo}>El pago no se completó</Text>
          <Text style={styles.bannerTexto}>No se cobró nada. Puedes intentarlo de nuevo desde tu solicitud.</Text>
        </View>
      )}

      {servicios.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>Todavía no tienes servicios</Text>
        </View>
      ) : (
        <FlatList
          data={servicios}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const estado = ESTADOS_CLIENTE[item.estado] || { texto: item.estado, color: '#666' };
            const cargando = ocupado === item.id;
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Servicio #{item.id}</Text>
                <Text style={[styles.estado, { color: estado.color }]}>● {estado.texto}</Text>
                <Text style={styles.cardText}>{item.tipo_servicio === 'fumigacion' ? `🪳 Fumigación · ${item.tipo_plaga || 'plaga'}` : '🧹 Aseo del hogar'}</Text>
                <Text style={styles.cardText}>📍 {item.direccion || 'Sin dirección'}</Text>
                <Text style={styles.cardText}>🏠 {item.metros} m²</Text>
                <Text style={styles.cardPrice}>${Number(item.total_cliente || 0).toLocaleString('es-CL')}</Text>

                {item.estado === 'pendiente_pago' && (
                  <TouchableOpacity style={styles.btnPrincipal} onPress={() => pagar(item.id)} disabled={cargando}>
                    {cargando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>Pagar ahora</Text>}
                  </TouchableOpacity>
                )}

                {item.estado === 'completado' && (
                  <>
                    <Text style={styles.nota}>El trabajador lo marcó como terminado. Si no nos dices nada, lo daremos por conforme 24 horas después.</Text>
                    <TouchableOpacity style={styles.btnPrincipal} onPress={() => confirmarServicio(item.id)} disabled={cargando}>
                      {cargando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>✅ Quedó todo bien</Text>}
                    </TouchableOpacity>
                  </>
                )}

                {item.estado === 'en_reclamo' && (
                  <Text style={styles.nota}>Estamos revisando tu reclamo. Tu pago sigue retenido y no se le libera al trabajador hasta resolverlo.</Text>
                )}

                {RECLAMABLES.includes(item.estado) && reclamando !== item.id && (
                  <TouchableOpacity style={styles.btnSecundario} onPress={() => setReclamando(item.id)}>
                    <Text style={styles.btnSecundarioTexto}>Reportar un problema</Text>
                  </TouchableOpacity>
                )}

                {reclamando === item.id && (
                  <View style={styles.reclamo}>
                    <Text style={styles.reclamoTitulo}>¿Qué pasó?</Text>
                    {MOTIVOS_RECLAMO.map((m) => (
                      <TouchableOpacity key={m.id} style={[styles.motivo, motivo === m.id && styles.motivoActivo]} onPress={() => setMotivo(m.id)}>
                        <Text style={[styles.motivoTexto, motivo === m.id && styles.motivoTextoActivo]}>{m.texto}</Text>
                      </TouchableOpacity>
                    ))}
                    <TextInput style={styles.input} placeholder="Cuéntanos más (opcional)" value={detalle} onChangeText={setDetalle} multiline />
                    <TouchableOpacity style={styles.btnReclamo} onPress={() => enviarReclamo(item.id)} disabled={cargando}>
                      {cargando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>Enviar reclamo</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setReclamando(null); setMotivo(''); setDetalle(''); }}>
                      <Text style={styles.cancelar}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
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
  banner: { borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1 },
  bannerOk: { backgroundColor: '#eef7f0', borderColor: '#cfe6d6' },
  bannerError: { backgroundColor: '#fdf0ef', borderColor: '#f3d0cc' },
  bannerTitulo: { fontSize: 15, fontWeight: 'bold', marginBottom: 4, color: '#17231b' },
  bannerTexto: { fontSize: 13, lineHeight: 19, color: '#344238' },
  list: { paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  cardTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  estado: { fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#666', marginBottom: 4 },
  cardPrice: { marginTop: 8, fontSize: 18, fontWeight: 'bold', color: '#6C63FF' },
  nota: { fontSize: 13, color: '#555', lineHeight: 19, marginTop: 10 },
  btnPrincipal: { backgroundColor: '#6C63FF', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 12 },
  btnTexto: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  btnSecundario: { borderRadius: 10, padding: 11, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#e5c9c5' },
  btnSecundarioTexto: { color: '#b91c1c', fontSize: 14, fontWeight: '600' },
  reclamo: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#fdf6f5', borderWidth: 1, borderColor: '#f3d0cc' },
  reclamoTitulo: { fontSize: 15, fontWeight: 'bold', marginBottom: 8 },
  motivo: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#eee', backgroundColor: '#fff', marginBottom: 6 },
  motivoActivo: { borderColor: '#b91c1c', backgroundColor: '#fdecea' },
  motivoTexto: { color: '#444' },
  motivoTextoActivo: { color: '#b91c1c', fontWeight: 'bold' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, backgroundColor: '#fff', marginTop: 4, minHeight: 60, textAlignVertical: 'top' },
  btnReclamo: { backgroundColor: '#b91c1c', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 10 },
  cancelar: { color: '#777', textAlign: 'center', marginTop: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { fontSize: 54, marginBottom: 12 },
  emptyText: { fontSize: 18, color: '#666' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f8ff' },
});
