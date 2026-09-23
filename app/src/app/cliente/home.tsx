import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { obtenerSesion, cerrarSesion } from '../../constants/auth';

export default function HomeCliente() {
  const [usuario, setUsuario] = useState<any>(null);

  useEffect(() => {
    obtenerSesion().then(({ usuario }) => setUsuario(usuario));
  }, []);

  const salir = async () => {
    await cerrarSesion();
    router.replace('/login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.saludo}>Hola, {usuario?.nombre?.split(' ')[0]} 👋</Text>
        <TouchableOpacity onPress={salir}>
          <Text style={styles.salir}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.centro}>
        <Text style={styles.titulo}>¿Necesitas aseo?</Text>
        <Text style={styles.subtitulo}>Aseadores profesionales cerca de ti</Text>

        <TouchableOpacity style={styles.btnPrincipal} onPress={() => router.push('/cliente/solicitar')}>
          <Text style={styles.btnIcono}>🧹</Text>
          <Text style={styles.btnTexto}>Solicitar Aseo</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.menu}>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/cliente/historial')}>
          <Text style={styles.menuIcono}>📋</Text>
          <Text style={styles.menuTexto}>Historial</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/cliente/perfil')}>
          <Text style={styles.menuIcono}>👤</Text>
          <Text style={styles.menuTexto}>Perfil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingTop: 60, backgroundColor: '#fff' },
  saludo: { fontSize: 20, fontWeight: 'bold' },
  salir: { color: '#999', fontSize: 14 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  titulo: { fontSize: 28, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  subtitulo: { fontSize: 16, color: '#666', marginBottom: 48, textAlign: 'center' },
  btnPrincipal: { width: 200, height: 200, borderRadius: 100, backgroundColor: '#6C63FF', alignItems: 'center', justifyContent: 'center', shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  btnIcono: { fontSize: 64, marginBottom: 8 },
  btnTexto: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  menu: { flexDirection: 'row', backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  menuItem: { flex: 1, alignItems: 'center', padding: 8 },
  menuIcono: { fontSize: 24, marginBottom: 4 },
  menuTexto: { fontSize: 12, color: '#666' }
});
