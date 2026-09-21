import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';

const TAMANIOS = [
  { label: 'Departamento pequeño', metros: 40, horas: 3, icono: '🏠' },
  { label: 'Departamento mediano', metros: 65, horas: 4, icono: '🏡' },
  { label: 'Casa mediana', metros: 100, horas: 4, icono: '🏘️' },
  { label: 'Casa grande', metros: 150, horas: 5, icono: '🏰' },
  { label: 'Casa muy grande', metros: 250, horas: 6, icono: '🏯' },
];

const PLAGAS = [
  { id: 'insectos', label: 'Insectos', detail: 'Cucarachas, hormigas y arañas', icono: '🪳' },
  { id: 'roedores', label: 'Roedores', detail: 'Ratones y ratas', icono: '🐭' },
  { id: 'mixto', label: 'Insectos y roedores', detail: 'Problema combinado', icono: '🏠' },
];

export default function Solicitar() {
  const [tamanio, setTamanio] = useState<any>(null);
  const [tipoServicio, setTipoServicio] = useState<'aseo' | 'fumigacion'>('aseo');
  const [tipoPlaga, setTipoPlaga] = useState('insectos');
  const [direccion, setDireccion] = useState('');
  const [fechaServicio, setFechaServicio] = useState('');
  const [horasExtra, setHorasExtra] = useState(0);
  const [conMateriales, setConMateriales] = useState(false);
  const [precio, setPrecio] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const calcularLocal = (metros: number, horasExtra: number, materiales: boolean, servicio: 'aseo' | 'fumigacion', plaga: string) => {
    if (servicio === 'fumigacion') {
      const tarifas: Record<string, number[]> = { insectos: [39900, 49900, 64900, 84900], roedores: [49900, 59900, 79900, 99900], mixto: [59900, 69900, 89900, 119900] };
      const base = tarifas[plaga] || tarifas.insectos;
      const index = metros <= 50 ? 0 : metros <= 100 ? 1 : metros <= 200 ? 2 : 3;
      const precioBase = base[index];
      const comision = Math.round(precioBase * 0.2);
      const iva = Math.round(comision * 0.19);
      const retencion_honorarios = Math.round(precioBase * 0.1525);
      return { precio_base: precioBase, extra: 0, comision, iva, total_cliente: precioBase + comision + iva, worker_recibe: precioBase, retencion_honorarios, worker_liquido_estimado: precioBase - retencion_honorarios, horas_incluidas: null };
    }
    const base = metros <= 50 ? (materiales ? 30000 : 25000) : metros <= 80 ? (materiales ? 40000 : 35000) : metros <= 120 ? (materiales ? 50000 : 45000) : metros <= 200 ? (materiales ? 65000 : 60000) : (materiales ? 85000 : 80000);
    const extra = [0, 8000, 15000, 21000][horasExtra] || 0;
    const subtotal = base + extra;
    const comision = Math.round(subtotal * 0.2);
    const iva = Math.round(comision * 0.19);
    const retencion_honorarios = Math.round(subtotal * 0.1525);
    return { precio_base: base, extra, comision, iva, total_cliente: subtotal + comision + iva, worker_recibe: subtotal, retencion_honorarios, worker_liquido_estimado: subtotal - retencion_honorarios, horas_incluidas: metros <= 50 ? 3 : metros <= 120 ? 4 : metros <= 200 ? 5 : 6 };
  };

  const calcular = async (t: any, h: number, m: boolean, servicio = tipoServicio, plaga = tipoPlaga) => {
    try {
      const res = await api.post('/api/calcular-precio', { metros: t.metros, horas_extra: h, con_materiales: m, tipo_servicio: servicio, tipo_plaga: plaga });
      setPrecio(res);
    } catch {
      setPrecio(calcularLocal(t.metros, h, m, servicio, plaga));
    }
  };

  const seleccionarTamanio = (t: any) => {
    setTamanio(t);
    calcular(t, horasExtra, conMateriales);
  };

  const seleccionarServicio = (tipo: 'aseo' | 'fumigacion') => {
    setTipoServicio(tipo);
    if (tamanio) calcular(tamanio, horasExtra, conMateriales, tipo, tipoPlaga);
  };

  const seleccionarPlaga = (plaga: string) => {
    setTipoPlaga(plaga);
    if (tamanio) calcular(tamanio, horasExtra, conMateriales, tipoServicio, plaga);
  };

  const cambiarHoras = (h: number) => {
    setHorasExtra(h);
    if (tamanio) calcular(tamanio, h, conMateriales);
  };

  const cambiarMateriales = (m: boolean) => {
    setConMateriales(m);
    if (tamanio) calcular(tamanio, horasExtra, m);
  };

  const solicitar = async () => {
    if (!tamanio) return Alert.alert('Error', 'Selecciona el tamaño');
    if (!direccion.trim()) return Alert.alert('Error', 'Ingresa la dirección del servicio');
    const fecha = fechaServicio.trim()
      ? new Date(fechaServicio.includes('/') ? fechaServicio.split('/').reverse().join('-') : fechaServicio)
      : new Date();
    if (Number.isNaN(fecha.getTime())) return Alert.alert('Error', 'La fecha no es válida');
    const { token } = await obtenerSesion();
    if (!token) {
      Alert.alert('Inicia sesión para continuar', 'Necesitas una cuenta Aseada para solicitar un servicio.', [
        { text: 'Crear cuenta', onPress: () => router.push('/registro') },
        { text: 'Iniciar sesión', onPress: () => router.push('/login') },
      ]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/api/servicios', {
        metros: tamanio.metros,
        tipo_servicio: tipoServicio,
        tipo_plaga: tipoServicio === 'fumigacion' ? tipoPlaga : null,
        horas_extra: horasExtra,
        con_materiales: conMateriales,
        direccion: direccion.trim(),
        fecha_servicio: fecha.toISOString()
      }, token!);
      if (res.id) {
        router.push({ pathname: '/cliente/buscando', params: { servicioId: res.id, total: precio.total_cliente } });
      } else {
        Alert.alert('Error', res.error || 'Error al crear servicio');
      }
    } catch (e) {
      Alert.alert('Error', 'No se pudo conectar');
    }
    setLoading(false);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.titulo}>¿Qué necesitas resolver?</Text>
      <View style={styles.horas}>
        <TouchableOpacity style={[styles.tipoBtn, tipoServicio === 'aseo' && styles.horaBtnActivo]} onPress={() => seleccionarServicio('aseo')}>
          <Text style={styles.opcionIcono}>🧹</Text><Text style={styles.horaTexto}>Aseo del hogar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tipoBtn, tipoServicio === 'fumigacion' && styles.horaBtnActivo]} onPress={() => seleccionarServicio('fumigacion')}>
          <Text style={styles.opcionIcono}>🪳</Text><Text style={styles.horaTexto}>Fumigación</Text>
        </TouchableOpacity>
      </View>

      {tipoServicio === 'fumigacion' && (
        <>
          <Text style={styles.seccion}>¿Qué problema tienes?</Text>
          {PLAGAS.map((plaga) => (
            <TouchableOpacity key={plaga.id} style={[styles.opcion, tipoPlaga === plaga.id && styles.opcionActiva]} onPress={() => seleccionarPlaga(plaga.id)}>
              <Text style={styles.opcionIcono}>{plaga.icono}</Text>
              <View><Text style={styles.opcionTexto}>{plaga.label}</Text><Text style={styles.detalle}>{plaga.detail}</Text></View>
            </TouchableOpacity>
          ))}
          <Text style={styles.referencial}>Precios referenciales. La visita técnica puede ajustar el valor según la infestación.</Text>
        </>
      )}

      <Text style={styles.seccion}>Tamaño del hogar</Text>
      {TAMANIOS.map((t) => (
        <TouchableOpacity key={t.metros} style={[styles.opcion, tamanio?.metros === t.metros && styles.opcionActiva]} onPress={() => seleccionarTamanio(t)}>
          <Text style={styles.opcionIcono}>{t.icono}</Text>
          <View><Text style={[styles.opcionTexto, tamanio?.metros === t.metros && styles.opcionTextoActivo]}>{t.label}</Text><Text style={styles.detalle}>{t.horas} horas incluidas</Text></View>
        </TouchableOpacity>
      ))}

      {tipoServicio === 'aseo' && <Text style={styles.seccion}>Horas adicionales</Text>}
      {tipoServicio === 'aseo' && (
      <View style={styles.horas}>
        {[0,1,2,3].map((h) => (
          <TouchableOpacity key={h} style={[styles.horaBtn, horasExtra === h && styles.horaBtnActivo]} onPress={() => cambiarHoras(h)}>
            <Text style={[styles.horaTexto, horasExtra === h && styles.horaTextoActivo]}>{h === 0 ? 'Sin extra' : `+${h}h`}</Text>
          </TouchableOpacity>
        ))}
      </View>
      )}

      {tipoServicio === 'aseo' && <Text style={styles.seccion}>Materiales de limpieza</Text>}
      {tipoServicio === 'aseo' && (
      <View style={styles.horas}>
        <TouchableOpacity style={[styles.horaBtn, !conMateriales && styles.horaBtnActivo]} onPress={() => cambiarMateriales(false)}>
          <Text style={[styles.horaTexto, !conMateriales && styles.horaTextoActivo]}>Yo los tengo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.horaBtn, conMateriales && styles.horaBtnActivo]} onPress={() => cambiarMateriales(true)}>
          <Text style={[styles.horaTexto, conMateriales && styles.horaTextoActivo]}>El aseador los trae</Text>
        </TouchableOpacity>
      </View>
      )}

      {precio && (
        <View style={styles.resumen}>
          <Text style={styles.resumenTitulo}>{tipoServicio === 'fumigacion' ? 'Fumigación referencial' : 'Resumen de precio'}</Text>
          <View style={styles.resumenFila}><Text>{tipoServicio === 'fumigacion' ? 'Tratamiento base' : `Servicio base (${tamanio?.horas} hrs)`}</Text><Text>${precio.precio_base?.toLocaleString()}</Text></View>
          {precio.extra > 0 && <View style={styles.resumenFila}><Text>Horas extra</Text><Text>${precio.extra?.toLocaleString()}</Text></View>}
          <View style={styles.resumenFila}><Text>Comisión plataforma</Text><Text>${precio.comision?.toLocaleString()}</Text></View>
          <View style={styles.resumenFila}><Text>IVA (19% comisión)</Text><Text>${precio.iva?.toLocaleString()}</Text></View>
          <View style={[styles.resumenFila, styles.resumenTotal]}><Text style={styles.totalTexto}>Total a pagar</Text><Text style={styles.totalPrecio}>${precio.total_cliente?.toLocaleString()}</Text></View>
        </View>
      )}

      <Text style={styles.seccion}>Dónde y cuándo</Text>
      <TextInput style={styles.input} placeholder="Dirección del servicio" value={direccion} onChangeText={setDireccion} />
      <TextInput style={styles.input} placeholder="Fecha preferida (ej: 25/09/2026)" value={fechaServicio} onChangeText={setFechaServicio} />

      <TouchableOpacity style={[styles.btn, (!tamanio || !direccion.trim()) && styles.btnDesactivado]} onPress={solicitar} disabled={!tamanio || !direccion.trim() || loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>Confirmar y buscar aseador</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff', padding: 24 },
  titulo: { fontSize: 24, fontWeight: 'bold', marginBottom: 24, marginTop: 40 },
  seccion: { fontSize: 16, fontWeight: '600', marginBottom: 12, marginTop: 16, color: '#333' },
  opcion: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#eee', marginBottom: 8, backgroundColor: '#fff' },
  opcionActiva: { borderColor: '#6C63FF', backgroundColor: '#f0efff' },
  opcionIcono: { fontSize: 24, marginRight: 12 },
  opcionTexto: { fontSize: 16, color: '#333' },
  opcionTextoActivo: { color: '#6C63FF', fontWeight: 'bold' },
  detalle: { color: '#777', fontSize: 13, marginTop: 3 },
  referencial: { color: '#777', fontSize: 13, lineHeight: 19, marginTop: 2 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 15, backgroundColor: '#fff', marginBottom: 10, fontSize: 15 },
  horas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tipoBtn: { flex: 1, minWidth: 150, padding: 14, borderRadius: 10, borderWidth: 2, borderColor: '#eee', backgroundColor: '#fff', alignItems: 'center', gap: 5 },
  horaBtn: { padding: 12, borderRadius: 8, borderWidth: 2, borderColor: '#eee', backgroundColor: '#fff' },
  horaBtnActivo: { borderColor: '#6C63FF', backgroundColor: '#f0efff' },
  horaTexto: { color: '#666' },
  horaTextoActivo: { color: '#6C63FF', fontWeight: 'bold' },
  resumen: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 24, marginBottom: 16 },
  resumenTitulo: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  resumenFila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  resumenTotal: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, marginTop: 4 },
  totalTexto: { fontSize: 16, fontWeight: 'bold' },
  totalPrecio: { fontSize: 16, fontWeight: 'bold', color: '#6C63FF' },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 40 },
  btnDesactivado: { backgroundColor: '#ccc' },
  btnTexto: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
