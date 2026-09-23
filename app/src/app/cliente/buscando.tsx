import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';

export default function Buscando() {
  const { servicioId, total } = useLocalSearchParams();
  const [estado, setEstado] = useState('buscando');
  const [worker, setWorker] = useState<any>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { token } = await obtenerSesion();
        const res = await api.get(`/api/servicios`, token!);
        const servicio = res.find((s: any) => s.id === Number(servicioId));
        if (servicio?.estado === 'en_proceso' || servicio?.estado === 'aceptada') {
          setEstado('aceptado');
          clearInterval(interval);
        }
      } catch (e) {}
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  if (estado === 'aceptado') {
    return (
      <View style={styles.container}>
        <Text style={styles.icono}>🎉</Text>
        <Text style={styles.titulo}>¡Aseador encontrado!</Text>
        <Text style={styles.subtitulo}>Tu aseador está en camino</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.replace('/cliente/home')}>
          <Text style={styles.btnTexto}>Ver detalles</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icono}>🔍</Text>
      <Text style={styles.titulo}>Buscando aseador...</Text>
      <Text style={styles.subtitulo}>Notificando a los aseadores cercanos</Text>
      <ActivityIndicator size="large" color="#6C63FF" style={styles.spinner} />
      <View style={styles.resumen}>
        <Text style={styles.resumenTexto}>Total a pagar</Text>
        <Text style={styles.resumenPrecio}>${Number(total).toLocaleString()}</Text>
      </View>
      <TouchableOpacity style={styles.btnCancelar} onPress={() => router.back()}>
        <Text style={styles.btnCancelarTexto}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  icono: { fontSize: 80, marginBottom: 16 },
  titulo: { fontSize: 28, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  subtitulo: { fontSize: 16, color: '#666', marginBottom: 32, textAlign: 'center' },
  spinner: { marginBottom: 32 },
  resumen: { backgroundColor: '#f0efff', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 24, width: '100%' },
  resumenTexto: { fontSize: 14, color: '#666', marginBottom: 4 },
  resumenPrecio: { fontSize: 32, fontWeight: 'bold', color: '#6C63FF' },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 16, width: '100%', alignItems: 'center' },
  btnTexto: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  btnCancelar: { padding: 16 },
  btnCancelarTexto: { color: '#999', fontSize: 14 }
});
