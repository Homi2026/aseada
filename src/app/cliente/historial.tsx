import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';

export default function HistorialCliente() {
  const [servicios, setServicios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      try {
        const { token } = await obtenerSesion();
        const res = await api.get('/api/mis-servicios', token!);
        setServicios(Array.isArray(res) ? res : []);
      } catch (error) {
        setServicios([]);
      } finally {
        setLoading(false);
      }
    };

    cargar();
  }, []);

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
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Servicio #{item.id}</Text>
              <Text style={styles.cardText}>{item.tipo_servicio === 'fumigacion' ? `🪳 Fumigación · ${item.tipo_plaga || 'plaga'}` : '🧹 Aseo del hogar'}</Text>
              <Text style={styles.cardText}>📍 {item.direccion || 'Sin dirección'}</Text>
              <Text style={styles.cardText}>🏠 {item.metros} m²</Text>
              <Text style={styles.cardText}>📌 Estado: {item.estado}</Text>
              <Text style={styles.cardPrice}>${Number(item.total_cliente || 0).toLocaleString()}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 20 },
  list: { paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  cardTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#666', marginBottom: 4 },
  cardPrice: { marginTop: 8, fontSize: 18, fontWeight: 'bold', color: '#6C63FF' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { fontSize: 54, marginBottom: 12 },
  emptyText: { fontSize: 18, color: '#666' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f8ff' },
});
