import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, esSesionVencida } from '../constants/api';
import { exigirSesion, volverAlLogin } from '../constants/auth';

const fecha = (f: string) => new Date(f).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
const estrellas = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Lo que los clientes calificaron del aseador. Sin quien lo escribio. */
export function MisCalificaciones() {
  const [recibidas, setRecibidas] = useState<any[]>([]);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { token } = await exigirSesion();
        const res = await api.get('/api/calificaciones', token);
        setRecibidas(Array.isArray(res) ? res.filter((c) => c.recibida) : []);
      } catch (e: any) {
        if (esSesionVencida(e)) return volverAlLogin();
      } finally {
        setCargado(true);
      }
    })();
  }, []);

  if (!cargado) return null;

  const promedio = recibidas.length
    ? (recibidas.reduce((suma, c) => suma + c.puntaje, 0) / recibidas.length).toFixed(1)
    : null;

  return (
    <View style={styles.caja}>
      <Text style={styles.titulo}>Mis calificaciones</Text>
      {recibidas.length === 0 ? (
        <Text style={styles.vacio}>Todavía no tienes calificaciones. Aparecen cuando un cliente confirma tu servicio.</Text>
      ) : (
        <>
          <Text style={styles.promedio}>★ {promedio} · {recibidas.length} calificación{recibidas.length === 1 ? '' : 'es'}</Text>
          {recibidas.slice(0, 10).map((c) => (
            <View key={c.id} style={styles.fila}>
              <Text style={styles.puntaje}>{estrellas(c.puntaje)}</Text>
              {!!c.comentario && <Text style={styles.comentario}>“{c.comentario}”</Text>}
              <Text style={styles.fecha}>Servicio #{c.servicio_id} · {fecha(c.creado_en)}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#dce3dc', marginTop: 24 },
  titulo: { fontSize: 16, fontWeight: '800', color: '#17231b', marginBottom: 8 },
  vacio: { fontSize: 14, color: '#6b766d', lineHeight: 20 },
  promedio: { fontSize: 18, fontWeight: '800', color: '#1f6b4f', marginBottom: 8 },
  fila: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f3f0' },
  puntaje: { fontSize: 16, color: '#f5a524' },
  comentario: { fontSize: 14, color: '#34403a', lineHeight: 20, marginTop: 3 },
  fecha: { fontSize: 12, color: '#8b958d', marginTop: 3 },
});
