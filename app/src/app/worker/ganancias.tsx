import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { api, esSesionVencida } from '../../constants/api';
import { exigirSesion, volverAlLogin } from '../../constants/auth';
import { EstadoError } from '../../components/estado-error';

export default function GananciasWorker() {
  const [total, setTotal] = useState(0);
  const [trabajos, setTrabajos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');

  const cargar = useCallback(async () => {
    try {
      const { token } = await exigirSesion();
      const res = await api.get('/api/mis-servicios', token);
      const servicios = Array.isArray(res) ? res : [];
      const pagados = servicios.filter((item: any) => ['completado', 'pagado'].includes(item.estado));
      const suma = pagados.reduce((acc: number, item: any) => acc + Number(item.worker_liquido_estimado || (Number(item.worker_recibe || 0) - Number(item.retencion_honorarios || 0))), 0);
      setTotal(suma);
      setTrabajos(pagados.length);
      setErrorCarga('');
    } catch (e: any) {
      // Mostrar $0 cuando en realidad fallo la carga es mentirle al trabajador
      // sobre su plata: se distingue el error del total real.
      if (esSesionVencida(e)) return volverAlLogin();
      setErrorCarga(e?.message || 'Revisa tu conexión e intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (errorCarga) {
    return (
      <EstadoError
        titulo="No pudimos cargar tus ganancias"
        mensaje={errorCarga}
        onReintentar={() => { setLoading(true); cargar(); }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ganancias</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Líquido estimado acumulado</Text>
        <Text style={styles.amount}>${total.toLocaleString('es-CL')}</Text>
        <Text style={styles.meta}>{trabajos} trabajos pagados</Text>
      </View>

      <Text style={styles.description}>Estimación después de una retención referencial de honorarios. El monto final depende de tu situación tributaria.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  label: { fontSize: 14, color: '#666', marginBottom: 8 },
  amount: { fontSize: 36, fontWeight: 'bold', color: '#6C63FF' },
  meta: { color: '#667085', fontSize: 13, marginTop: 8 },
  description: { marginTop: 20, fontSize: 15, color: '#666', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f8ff' },
});
