import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { api, esSesionVencida } from '../../constants/api';
import { exigirSesion, volverAlLogin } from '../../constants/auth';
import { avisar, confirmar } from '../../constants/dialogos';
import { GARANTIA, abrirPago } from '../../constants/pagos';
import { TAMANIOS } from '../../constants/tamanios';

const TIPOS = [
  { id: 'mensual', label: 'Mensual', detalle: '4 visitas, una por semana' },
  { id: 'trimestral', label: '3 meses', detalle: '12 visitas, una por semana' },
];

const pesos = (n: any) => '$' + Number(n || 0).toLocaleString('es-CL');

export default function Plan() {
  const [tipo, setTipo] = useState<'mensual' | 'trimestral'>('mensual');
  const [tamanio, setTamanio] = useState<any>(null);
  const [conMateriales, setConMateriales] = useState(false);
  const [direccion, setDireccion] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [cotizacion, setCotizacion] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tamanio) { setCotizacion(null); return; }
    let vigente = true;
    (async () => {
      try {
        const { token } = await exigirSesion();
        const res = await api.post('/api/planes/cotizar', { tipo, metros: tamanio.metros, con_materiales: conMateriales }, token);
        if (vigente) setCotizacion(res);
      } catch (e: any) {
        if (esSesionVencida(e)) return volverAlLogin();
        if (vigente) setCotizacion(null);
      }
    })();
    return () => { vigente = false; };
  }, [tipo, tamanio, conMateriales]);

  const pagar = async () => {
    if (!tamanio) return avisar('Falta un dato', 'Selecciona el tamaño del hogar.');
    if (!direccion.trim()) return avisar('Falta un dato', 'Ingresa la dirección del servicio.');
    if (!cotizacion) return avisar('Falta el precio', 'Espera a que se calcule el plan antes de pagar.');
    const inicio = fechaInicio.trim()
      ? (fechaInicio.includes('/') ? fechaInicio.split('/').reverse().join('-') : fechaInicio.trim())
      : undefined;
    const seguir = await confirmar(`Pagar ${pesos(cotizacion.total)}`, `Pagas el plan completo por adelantado. ${GARANTIA}`, 'Ir a pagar');
    if (!seguir) return;

    setLoading(true);
    try {
      const { token } = await exigirSesion();
      const res = await api.post('/api/planes', {
        tipo,
        metros: tamanio.metros,
        con_materiales: conMateriales,
        direccion: direccion.trim(),
        fecha_inicio: inicio
      }, token);
      await abrirPago(res.url_pago);
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
      avisar('No pudimos iniciar el pago', e?.message || 'Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const listo = Boolean(tamanio && direccion.trim() && cotizacion);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.titulo}>Plan de visitas semanales</Text>

      <Text style={styles.seccion}>¿Cuánto tiempo?</Text>
      <View style={styles.fila}>
        {TIPOS.map((t) => (
          <TouchableOpacity key={t.id} style={[styles.tipo, tipo === t.id && styles.activo]} onPress={() => setTipo(t.id as any)}>
            <Text style={[styles.tipoTitulo, tipo === t.id && styles.textoActivo]}>{t.label}</Text>
            <Text style={styles.detalle}>{t.detalle}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.seccion}>Tamaño del hogar</Text>
      {TAMANIOS.map((t) => (
        <TouchableOpacity key={t.metros} style={[styles.opcion, tamanio?.metros === t.metros && styles.activo]} onPress={() => setTamanio(t)}>
          <Text style={styles.icono}>{t.icono}</Text>
          <View><Text style={[styles.opcionTexto, tamanio?.metros === t.metros && styles.textoActivo]}>{t.label}</Text><Text style={styles.detalle}>{t.horas} horas por visita</Text></View>
        </TouchableOpacity>
      ))}

      <Text style={styles.seccion}>Materiales de limpieza</Text>
      <View style={styles.fila}>
        <TouchableOpacity style={[styles.chip, !conMateriales && styles.activo]} onPress={() => setConMateriales(false)}>
          <Text style={[styles.chipTexto, !conMateriales && styles.textoActivo]}>Yo los tengo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chip, conMateriales && styles.activo]} onPress={() => setConMateriales(true)}>
          <Text style={[styles.chipTexto, conMateriales && styles.textoActivo]}>El aseador los trae</Text>
        </TouchableOpacity>
      </View>

      {cotizacion && (
        <View style={styles.resumen}>
          <Text style={styles.resumenTitulo}>Resumen del plan</Text>
          <View style={styles.resumenFila}><Text>Visitas</Text><Text>{cotizacion.visitas}</Text></View>
          <View style={styles.resumenFila}><Text>Precio por visita</Text><Text>{pesos(cotizacion.precio_visita)}</Text></View>
          <View style={styles.resumenFila}><Text>Visita suelta</Text><Text style={styles.tachado}>{pesos(cotizacion.precio_visita_suelta)}</Text></View>
          <View style={styles.resumenFila}><Text style={styles.ahorro}>Ahorras con el plan</Text><Text style={styles.ahorro}>{pesos(cotizacion.ahorro)}</Text></View>
          <View style={[styles.resumenFila, styles.total]}><Text style={styles.totalTexto}>Total del plan</Text><Text style={styles.totalTexto}>{pesos(cotizacion.total)}</Text></View>
        </View>
      )}

      <Text style={styles.seccion}>Dónde y cuándo</Text>
      <TextInput style={styles.input} placeholder="Dirección del servicio" value={direccion} onChangeText={setDireccion} />
      <TextInput style={styles.input} placeholder="Primera visita (ej: 25/09/2026, opcional)" value={fechaInicio} onChangeText={setFechaInicio} />

      <View style={styles.garantia}>
        <Text style={styles.garantiaTitulo}>🛡️ Pago protegido</Text>
        <Text style={styles.garantiaTexto}>Cada visita se publica el día que le toca. Cada pago queda retenido hasta que confirmes esa visita.</Text>
      </View>

      <TouchableOpacity style={[styles.btn, (!listo || loading) && styles.btnDesactivado]} onPress={pagar} disabled={!listo || loading}>
        {loading ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.btnTexto}>{cotizacion ? `Pagar plan ${pesos(cotizacion.total)}` : 'Pagar plan'}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff', padding: 24 },
  titulo: { fontSize: 24, fontWeight: 'bold', marginBottom: 24, marginTop: 40 },
  seccion: { fontSize: 16, fontWeight: '600', marginBottom: 12, marginTop: 16, color: '#333' },
  fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tipo: { flex: 1, minWidth: 140, padding: 14, borderRadius: 12, borderWidth: 2, borderColor: '#eee', backgroundColor: '#fff' },
  tipoTitulo: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  opcion: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#eee', marginBottom: 8, backgroundColor: '#fff' },
  icono: { fontSize: 24, marginRight: 12 },
  opcionTexto: { fontSize: 16, color: '#333' },
  chip: { padding: 12, borderRadius: 8, borderWidth: 2, borderColor: '#eee', backgroundColor: '#fff' },
  chipTexto: { color: '#666' },
  activo: { borderColor: '#6C63FF', backgroundColor: '#f0efff' },
  textoActivo: { color: '#6C63FF', fontWeight: 'bold' },
  detalle: { color: '#777', fontSize: 13, marginTop: 3 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 15, backgroundColor: '#fff', marginBottom: 10, fontSize: 15 },
  resumen: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 24, marginBottom: 8 },
  resumenTitulo: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  resumenFila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  tachado: { textDecorationLine: 'line-through', color: '#999' },
  ahorro: { color: '#15803d', fontWeight: '600' },
  total: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, marginTop: 4 },
  totalTexto: { fontSize: 16, fontWeight: 'bold' },
  garantia: { backgroundColor: '#eef7f0', borderRadius: 12, padding: 14, marginTop: 14, marginBottom: 14, borderWidth: 1, borderColor: '#cfe6d6' },
  garantiaTitulo: { color: '#1f6b4f', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  garantiaTexto: { color: '#344238', fontSize: 13, lineHeight: 19 },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 40 },
  btnDesactivado: { backgroundColor: '#ccc' },
  btnTexto: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
