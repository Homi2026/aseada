import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';

export default function PerfilWorker() {
  const [comuna, setComuna] = useState('');
  const [experiencia, setExperiencia] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [loading, setLoading] = useState(false);

  const guardar = async () => {
    if (!acepta) return Alert.alert('Falta confirmar', 'Debes aceptar la modalidad de prestador independiente.');
    setLoading(true);
    try {
      const { token } = await obtenerSesion();
      await api.post('/api/worker/perfil', { modalidad: 'independiente', acepta_boleta: true, comuna, experiencia }, token!);
      Alert.alert('Perfil guardado', 'Ya puedes recibir trabajos como prestador independiente.', [{ text: 'Continuar', onPress: () => router.replace('/worker/home') }]);
    } catch (error: any) {
      Alert.alert('No se pudo guardar', error?.message || 'Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Perfil profesional</Text>
      <Text style={styles.title}>Trabaja con claridad</Text>
      <Text style={styles.copy}>Aseada opera inicialmente con prestadores independientes. Recibirás una ganancia bruta por servicio y una estimación líquida después de la retención referencial de honorarios.</Text>
      <Text style={styles.label}>Comuna o comunas donde trabajas</Text>
      <TextInput style={styles.input} placeholder="Ej: Ñuñoa, Macul, Providencia" value={comuna} onChangeText={setComuna} />
      <Text style={styles.label}>Experiencia</Text>
      <TextInput style={[styles.input, styles.multiline]} placeholder="Cuéntanos brevemente tu experiencia" value={experiencia} onChangeText={setExperiencia} multiline />
      <TouchableOpacity style={[styles.check, acepta && styles.checkActive]} onPress={() => setAcepta((value) => !value)}>
        <Text style={styles.checkMark}>{acepta ? '✓' : ''}</Text>
        <Text style={styles.checkText}>Acepto trabajar como prestador independiente y emitir boleta de honorarios por los servicios realizados.</Text>
      </TouchableOpacity>
      <Text style={styles.legal}>Antes de comenzar a trabajar, revisa tus obligaciones tributarias con un contador. La retención mostrada en Aseada es referencial.</Text>
      <TouchableOpacity style={[styles.button, !acepta && styles.disabled]} onPress={guardar} disabled={!acepta || loading}>
        <Text style={styles.buttonText}>{loading ? 'Guardando...' : 'Guardar perfil profesional'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#f8faf6', padding: 24, maxWidth: 680, width: '100%', alignSelf: 'center' },
  eyebrow: { color: '#d06b4d', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: 30, marginBottom: 10 },
  title: { color: '#17231b', fontSize: 32, fontWeight: '900', marginBottom: 12 },
  copy: { color: '#5e6a61', fontSize: 16, lineHeight: 24, marginBottom: 26 },
  label: { color: '#17231b', fontSize: 14, fontWeight: '800', marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dce3dc', borderRadius: 12, padding: 15, fontSize: 15 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 1, borderColor: '#dce3dc', borderRadius: 12, padding: 14, marginTop: 24, backgroundColor: '#fff' },
  checkActive: { borderColor: '#1f6b4f', backgroundColor: '#eef7f0' },
  checkMark: { width: 22, height: 22, borderWidth: 1, borderColor: '#1f6b4f', color: '#1f6b4f', textAlign: 'center', fontWeight: '900' },
  checkText: { flex: 1, color: '#344238', fontSize: 14, lineHeight: 20 },
  legal: { color: '#777', fontSize: 12, lineHeight: 18, marginTop: 12 },
  button: { backgroundColor: '#1f6b4f', borderRadius: 12, padding: 17, alignItems: 'center', marginTop: 26 },
  disabled: { backgroundColor: '#aab8ae' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
