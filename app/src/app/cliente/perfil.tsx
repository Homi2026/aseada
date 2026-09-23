import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { avisar } from '../../constants/dialogos';
import { router } from 'expo-router';
import { cerrarSesion, obtenerSesion, volverAlLogin } from '../../constants/auth';

export default function PerfilCliente() {
  const [usuario, setUsuario] = useState<any>(null);

  useEffect(() => {
    obtenerSesion().then(({ token, usuario }) => {
      // Sin sesion el perfil mostraba "Sin nombre / Sin email" como si la
      // cuenta estuviera vacia.
      if (!token) return volverAlLogin();
      setUsuario(usuario);
    });
  }, []);

  const salir = async () => {
    await cerrarSesion();
    router.replace('/login');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mi perfil</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Nombre</Text>
        <Text style={styles.value}>{usuario?.nombre || 'Sin nombre'}</Text>

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{usuario?.email || 'Sin email'}</Text>

        <Text style={styles.label}>Rol</Text>
        <Text style={styles.value}>{usuario?.rol === 'worker' ? 'Aseador' : 'Cliente'}</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={() => avisar('Perfil', 'La edición de perfil estará disponible pronto.')}>
        <Text style={styles.buttonText}>Editar perfil</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonSecondary} onPress={salir}>
        <Text style={styles.buttonSecondaryText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginTop: 48, marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 20,
  },
  label: { fontSize: 12, color: '#666', marginBottom: 6, textTransform: 'uppercase' },
  value: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  button: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  buttonSecondaryText: { color: '#333', fontWeight: 'bold', fontSize: 16 },
});
