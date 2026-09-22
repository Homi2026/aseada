import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../constants/api';
import { obtenerSesion } from '../../constants/auth';
import { avisar, confirmar } from '../../constants/dialogos';
import { GARANTIA, irAPagar } from '../../constants/pagos';

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

  // El precio lo calcula siempre el servidor, que es el mismo que despues
  // cobra. Antes habia un calculo local de respaldo con tarifas antiguas: si
  // la API fallaba, el cliente veia un total y se le cobraba otro.
  const calcular = async (t: any, h: number, m: boolean, servicio = tipoServicio, plaga = tipoPlaga) => {
    try {
      const res = await api.post('/api/calcular-precio', { metros: t.metros, horas_extra: h, con_materiales: m, tipo_servicio: servicio, tipo_plaga: plaga });
      setPrecio(res);
    } catch {
      setPrecio(null);
      avisar('No pudimos calcular el precio', 'Revisa tu conexión e intenta nuevamente.');
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
    if (!tamanio) return avisar('Falta un dato', 'Selecciona el tamaño del hogar.');
    if (!direccion.trim()) return avisar('Falta un dato', 'Ingresa la dirección del servicio.');
    if (!precio) return avisar('Falta el precio', 'Espera a que se calcule el precio antes de pagar.');
    const fecha = fechaServicio.trim()
      ? new Date(fechaServicio.includes('/') ? fechaServicio.split('/').reverse().join('-') : fechaServicio)
      : new Date();
    if (Number.isNaN(fecha.getTime())) return avisar('Fecha inválida', 'Escríbela como 25/09/2026.');
    const { token } = await obtenerSesion();
    if (!token) {
      const crear = await confirmar('Inicia sesión para continuar', 'Necesitas una cuenta Aseada para solicitar un servicio. ¿Quieres crear una ahora?', 'Crear cuenta');
      router.push(crear ? '/registro' : '/login');
      return;
    }
    // La garantia se muestra justo antes de cobrar, que es cuando pesa la duda.
    const seguir = await confirmar(`Pagar $${precio.total_cliente.toLocaleString('es-CL')}`, GARANTIA, 'Ir a pagar');
    if (!seguir) return;

    setLoading(true);
    let servicioId: number | null = null;
    try {
      const res = await api.post('/api/servicios', {
        metros: tamanio.metros,
        tipo_servicio: tipoServicio,
        tipo_plaga: tipoServicio === 'fumigacion' ? tipoPlaga : null,
        horas_extra: horasExtra,
        con_materiales: conMateriales,
        direccion: direccion.trim(),
        fecha_servicio: fecha.toISOString()
      }, token);
      servicioId = res.id;
      await irAPagar(res.id, token);
    } catch (e: any) {
      // Si el servicio se creo pero el cobro fallo, queda pendiente de pago y
      // se puede reintentar desde el historial.
      avisar('No pudimos iniciar el pago', servicioId
        ? `${e?.message || 'Intenta nuevamente.'}\n\nTu solicitud quedó guardada: puedes pagarla desde tu historial.`
        : e?.message || 'No se pudo conectar. Intenta nuevamente.');
      if (servicioId) router.replace('/cliente/historial');
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

      <View style={styles.garantia}>
        <Text style={styles.garantiaTitulo}>🛡️ Pago protegido</Text>
        <Text style={styles.garantiaTexto}>{GARANTIA}</Text>
      </View>

      <TouchableOpacity style={[styles.btn, (!tamanio || !direccion.trim() || !precio) && styles.btnDesactivado]} onPress={solicitar} disabled={!tamanio || !direccion.trim() || !precio || loading}>
        {loading ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.btnTexto}>{precio ? `Pagar $${precio.total_cliente.toLocaleString('es-CL')} y buscar aseador` : 'Pagar y buscar aseador'}</Text>
        )}
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
  garantia: { backgroundColor: '#eef7f0', borderRadius: 12, padding: 14, marginTop: 14, marginBottom: 14, borderWidth: 1, borderColor: '#cfe6d6' },
  garantiaTitulo: { color: '#1f6b4f', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  garantiaTexto: { color: '#344238', fontSize: 13, lineHeight: 19 },
  btn: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 40 },
  btnDesactivado: { backgroundColor: '#ccc' },
  btnTexto: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
