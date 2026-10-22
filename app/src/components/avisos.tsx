import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { api, esSesionVencida } from '../constants/api';
import { exigirSesion, volverAlLogin } from '../constants/auth';

const fecha = (f: string) => new Date(f).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Los avisos sin leer del usuario. En web no hay push, asi que si esta lista no
 * se muestra, avisos como "nadie llego" o "reembolso sin confirmar" no los ve
 * nadie. Sin avisos nuevos no dibuja nada.
 */
export function Avisos({ color = '#6C63FF' }: { color?: string }) {
  const [avisos, setAvisos] = useState<any[]>([]);
  const [marcando, setMarcando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const { token } = await exigirSesion();
      const res = await api.get('/api/notificaciones', token);
      setAvisos(Array.isArray(res) ? res.filter((a) => !a.leida) : []);
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
    }
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 60000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  const marcarLeidos = async () => {
    setMarcando(true);
    try {
      const { token } = await exigirSesion();
      await api.post('/api/notificaciones/leidas', {}, token);
      setAvisos([]);
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
    } finally {
      setMarcando(false);
    }
  };

  if (avisos.length === 0) return null;

  return (
    <View style={styles.caja}>
      <View style={styles.encabezado}>
        <Text style={styles.titulo}>Avisos · {avisos.length}</Text>
        <TouchableOpacity onPress={marcarLeidos} disabled={marcando}>
          <Text style={[styles.marcar, { color }]}>{marcando ? 'Marcando…' : 'Marcar como leídos'}</Text>
        </TouchableOpacity>
      </View>
      {avisos.slice(0, 5).map((a) => (
        <View key={a.id} style={styles.aviso}>
          <Text style={styles.avisoTitulo}>{a.titulo}</Text>
          <Text style={styles.avisoTexto}>{a.mensaje}</Text>
          <Text style={styles.avisoFecha}>{fecha(a.creado_en)}</Text>
        </View>
      ))}
      {avisos.length > 5 && <Text style={styles.mas}>y {avisos.length - 5} más</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { backgroundColor: '#fff', borderRadius: 14, padding: 14, margin: 16, marginBottom: 0, borderWidth: 1, borderColor: '#e8e6f5' },
  encabezado: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  titulo: { fontSize: 15, fontWeight: 'bold', color: '#222' },
  marcar: { fontSize: 13, fontWeight: '600' },
  aviso: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0eff7' },
  avisoTitulo: { fontSize: 14, fontWeight: '600', color: '#222', marginBottom: 2 },
  avisoTexto: { fontSize: 13, color: '#555', lineHeight: 18 },
  avisoFecha: { fontSize: 11, color: '#999', marginTop: 3 },
  mas: { fontSize: 12, color: '#777', marginTop: 6 },
});
