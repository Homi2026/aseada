import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, esSesionVencida } from '../constants/api';
import { exigirSesion, volverAlLogin } from '../constants/auth';
import { avisar } from '../constants/dialogos';

/** Cambiar la contraseña sabiendo la actual. Sirve tambien para reemplazar una clave temporal que entrego soporte. */
export function CambiarClave({ color = '#6C63FF' }: { color?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!actual || !nueva) return avisar('Faltan datos', 'Escribe tu contraseña actual y la nueva.');
    setGuardando(true);
    try {
      const { token } = await exigirSesion();
      const res = await api.post('/api/usuarios/cambiar-clave', { actual, nueva }, token);
      avisar('Listo', res?.mensaje || 'Cambiamos tu contraseña.');
      setActual('');
      setNueva('');
      setAbierto(false);
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
      avisar('No se pudo cambiar', e?.message || 'Intenta nuevamente.');
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) {
    return (
      <TouchableOpacity style={[styles.boton, { backgroundColor: color }]} onPress={() => setAbierto(true)}>
        <Text style={styles.botonTexto}>Cambiar contraseña</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.caja}>
      <TextInput style={styles.input} placeholder="Contraseña actual o temporal" value={actual} onChangeText={setActual} secureTextEntry />
      <TextInput style={styles.input} placeholder="Contraseña nueva (mínimo 8 caracteres)" value={nueva} onChangeText={setNueva} secureTextEntry />
      <TouchableOpacity style={[styles.boton, { backgroundColor: color }]} onPress={guardar} disabled={guardando}>
        {guardando ? <ActivityIndicator color="#fff" /> : <Text style={styles.botonTexto}>Guardar contraseña</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setAbierto(false); setActual(''); setNueva(''); }}>
        <Text style={styles.cancelar}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#eee', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 13, backgroundColor: '#fff', marginBottom: 10, fontSize: 15 },
  boton: { borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  botonTexto: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelar: { color: '#777', textAlign: 'center', marginTop: 2 },
});
