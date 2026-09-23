import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../constants/api';
import { guardarSesion } from '../constants/auth';
import { avisar } from '../constants/dialogos';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email || !password) return avisar('Faltan datos', 'Ingresa email y contraseña.');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      if (res?.token) {
        await guardarSesion(res.token, res.usuario);
        const inicio: Record<string, string> = { worker: '/worker/home', admin: '/admin' };
        router.replace((inicio[res.usuario.rol] || '/cliente/home') as any);
      } else {
        avisar('No pudimos iniciar sesión', res?.error || 'Credenciales incorrectas.');
      }
    } catch (e: any) {
      // api.post lanza con el mensaje del servidor ("Credenciales incorrectas");
      // sin mensaje, fue la conexion la que fallo.
      avisar('No pudimos iniciar sesión', e?.message || 'No se pudo conectar. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.panel}>
        <TouchableOpacity onPress={() => router.replace('/')}>
          <Text style={styles.brand}>Aseada</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Qué bueno verte.</Text>
        <Text style={styles.subtitle}>Ingresa para solicitar o gestionar tus servicios.</Text>
        <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Contraseña" value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={styles.primaryButton} onPress={login} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Iniciar sesión</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/registro')}>
          <Text style={styles.link}>Crear una cuenta nueva</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#eef3ed', justifyContent: 'center', padding: 24 },
  panel: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 28, padding: 32, shadowColor: '#1f3024', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.12, shadowRadius: 30, elevation: 5 },
  brand: { color: '#1f6b4f', fontSize: 22, fontWeight: '800', marginBottom: 52 },
  title: { color: '#17231b', fontSize: 34, fontWeight: '800', marginBottom: 10 },
  subtitle: { color: '#657066', fontSize: 16, lineHeight: 23, marginBottom: 28 },
  input: { borderWidth: 1, borderColor: '#dce3dc', borderRadius: 14, padding: 16, marginBottom: 12, fontSize: 16, backgroundColor: '#fbfcfb' },
  primaryButton: { backgroundColor: '#1f6b4f', borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 8, marginBottom: 20 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  link: { color: '#1f6b4f', fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
