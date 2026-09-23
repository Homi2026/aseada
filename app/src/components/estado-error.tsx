import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  titulo?: string;
  mensaje?: string;
  textoBoton?: string;
  onReintentar: () => void;
  color?: string;
};

/**
 * Pantalla de "no pudimos cargar". Existe para que un fallo de red o del
 * servidor no se vea igual que un vacio legitimo: antes ambos terminaban en
 * "todavia no tienes servicios" y la persona creia que perdio sus datos.
 */
export function EstadoError({
  titulo = 'No pudimos cargar esto',
  mensaje = 'Revisa tu conexión e intenta nuevamente.',
  textoBoton = 'Reintentar',
  onReintentar,
  color = '#6C63FF',
}: Props) {
  return (
    <View style={styles.contenedor}>
      <Text style={styles.icono}>⚠️</Text>
      <Text style={styles.titulo}>{titulo}</Text>
      <Text style={styles.mensaje}>{mensaje}</Text>
      <TouchableOpacity style={[styles.boton, { backgroundColor: color }]} onPress={onReintentar}>
        <Text style={styles.botonTexto}>{textoBoton}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icono: { fontSize: 46, marginBottom: 12 },
  titulo: { fontSize: 18, fontWeight: 'bold', color: '#17231b', marginBottom: 6, textAlign: 'center' },
  mensaje: { fontSize: 14, color: '#666', lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  boton: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 26, alignItems: 'center' },
  botonTexto: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
