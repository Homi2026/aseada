import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, esSesionVencida } from '../constants/api';
import { exigirSesion, guardarSesion, volverAlLogin } from '../constants/auth';
import { avisar } from '../constants/dialogos';

/** Corregir el propio nombre y telefono. El email no se cambia. */
export function EditarPerfil({ usuario, onGuardado, color = '#6C63FF' }: { usuario: any; onGuardado?: (u: any) => void; color?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(usuario?.nombre || '');
  const [telefono, setTelefono] = useState(usuario?.telefono || '');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      const { token } = await exigirSesion();
      const res = await api.post('/api/usuarios/perfil', { nombre, telefono }, token);
      // La sesion guardada local tambien trae el nombre: sin esto, el saludo
      // del inicio seguia mostrando el anterior hasta volver a entrar.
      await guardarSesion(token, res.usuario);
      onGuardado?.(res.usuario);
      avisar('Listo', res.mensaje);
      setAbierto(false);
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
      avisar('No se pudo guardar', e?.message || 'Intenta nuevamente.');
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) {
    return (
      <TouchableOpacity style={[styles.boton, { backgroundColor: color }]} onPress={() => setAbierto(true)}>
        <Text style={styles.botonTexto}>Editar mis datos</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.caja}>
      <TextInput style={styles.input} placeholder="Nombre" value={nombre} onChangeText={setNombre} />
      <TextInput style={styles.input} placeholder="Teléfono (ej: +56 9 1234 5678)" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" />
      <Text style={styles.nota}>Tu teléfono lo ve el aseador que toma tu servicio, para coordinar la llegada.</Text>
      <TouchableOpacity style={[styles.boton, { backgroundColor: color }]} onPress={guardar} disabled={guardando}>
        {guardando ? <ActivityIndicator color="#fff" /> : <Text style={styles.botonTexto}>Guardar datos</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setAbierto(false); setNombre(usuario?.nombre || ''); setTelefono(usuario?.telefono || ''); }}>
        <Text style={styles.cancelar}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#eee', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 13, backgroundColor: '#fff', marginBottom: 10, fontSize: 15 },
  nota: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  boton: { borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  botonTexto: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelar: { color: '#777', textAlign: 'center', marginTop: 2 },
});
