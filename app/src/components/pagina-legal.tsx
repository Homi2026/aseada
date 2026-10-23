import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

export type Seccion = { titulo: string; parrafos: string[] };

export function PaginaLegal({ titulo, actualizado, secciones }: { titulo: string; actualizado: string; secciones: Seccion[] }) {
  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido}>
      <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
        <Text style={styles.volver}>← Volver</Text>
      </TouchableOpacity>
      <Text style={styles.titulo}>{titulo}</Text>
      <Text style={styles.actualizado}>Última actualización: {actualizado}</Text>
      {secciones.map((s) => (
        <View key={s.titulo} style={styles.seccion}>
          <Text style={styles.subtitulo}>{s.titulo}</Text>
          {s.parrafos.map((p, i) => <Text key={i} style={styles.parrafo}>{p}</Text>)}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pagina: { flex: 1, backgroundColor: '#f8faf6' },
  contenido: { padding: 24, paddingBottom: 60, maxWidth: 720, width: '100%', alignSelf: 'center' },
  volver: { color: '#1f6b4f', fontSize: 15, fontWeight: '600', marginTop: 24, marginBottom: 20 },
  titulo: { fontSize: 30, fontWeight: '800', color: '#17231b', marginBottom: 6 },
  actualizado: { fontSize: 13, color: '#6b766d', marginBottom: 24 },
  seccion: { marginBottom: 20 },
  subtitulo: { fontSize: 18, fontWeight: '700', color: '#17231b', marginBottom: 8 },
  parrafo: { fontSize: 15, lineHeight: 23, color: '#34403a', marginBottom: 8 },
});
