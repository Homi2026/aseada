import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api } from '../constants/api';
import { guardarSesion } from '../constants/auth';
import { avisar } from '../constants/dialogos';

export default function Registro() {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('cliente');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const registrar = async () => {
    if (!nombre || !email || !password) {
      setError('Completa nombre, email y contraseña.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/registro', { nombre, email, password, telefono, rol });
      if (res?.token) {
        await guardarSesion(res.token, res.usuario);
        if (rol === 'worker') {
          // La cuenta del aseador nace inactiva: hay que decirlo aca, o la
          // pantalla de "cuenta en revision" llega como sorpresa.
          avisar('Cuenta creada · en revisión',
            'Revisamos a mano cada aseador nuevo antes de mostrarle trabajos. Te avisamos cuando quede activada. Mientras tanto, completa tu perfil para que la revisión sea más rápida.');
          router.replace('/worker/home');
        } else {
          router.replace('/cliente/home');
        }
      } else {
        setError(res?.error || 'No se pudo crear la cuenta.');
      }
    } catch (e: any) {
      // El mensaje del servidor ("Email ya registrado") dice que corregir.
      setError(e?.message || 'No se pudo conectar. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.logo}>🧹 Aseada</Text>
      <Text style={styles.title}>Crear cuenta</Text>
      <View style={styles.rolContainer}>
        <TouchableOpacity style={[styles.rolBtn, rol === 'cliente' && styles.rolActivo]} onPress={() => setRol('cliente')}>
          <Text style={[styles.rolText, rol === 'cliente' && styles.rolTextoActivo]}>👤 Cliente</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.rolBtn, rol === 'worker' && styles.rolActivo]} onPress={() => setRol('worker')}>
          <Text style={[styles.rolText, rol === 'worker' && styles.rolTextoActivo]}>🧹 Aseador</Text>
        </TouchableOpacity>
      </View>
      <TextInput style={styles.input} placeholder="Nombre completo" value={nombre} onChangeText={setNombre} />
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Teléfono" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" />
      <TextInput style={styles.input} placeholder="Contraseña" value={password} onChangeText={setPassword} secureTextEntry />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={registrar} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Crear cuenta</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.link}>¿Ya tienes cuenta? Inicia sesión</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24 },
  rolContainer: { flexDirection: 'row', marginBottom: 24, gap: 12 },
  rolBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#ddd', alignItems: 'center' },
  rolActivo: { borderColor: '#6C63FF', backgroundColor: '#f0efff' },
  rolText: { fontSize: 16, color: '#666' },
  rolTextoActivo: { color: '#6C63FF', fontWeight: 'bold' },
  input: { width: '100%', borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16 },
  btn: { width: '100%', backgroundColor: '#6C63FF', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  link: { color: '#6C63FF', fontSize: 14 },
  error: { color: '#b42318', backgroundColor: '#fff1f0', borderRadius: 8, padding: 10, width: '100%', marginBottom: 12, textAlign: 'center' },
});
