import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../constants/api';
import { obtenerSesion, cerrarSesion } from '../../constants/auth';
import { avisar, confirmar } from '../../constants/dialogos';
import { registrarNotificaciones } from '../../constants/notifications';

export default function HomeWorker() {
  const [usuario, setUsuario] = useState<any>(null);
  const [solicitudes, setSolicitudes] = useState<any[]>([]);
  const [avisos, setAvisos] = useState(0);
  const ultimoAviso = useRef(0);
  const audioContext = useRef<any>(null);
  const alertasActivasRef = useRef(false);
  const [alertasActivas, setAlertasActivas] = useState(false);
  const [loading, setLoading] = useState(false);

  const liquidacion = (servicio: any) => {
    const bruto = Number(servicio.worker_recibe || 0);
    const retencion = Number(servicio.retencion_honorarios || Math.round(bruto * 0.1525));
    const comision = Number(servicio.comision || 0);
    const iva = Number(servicio.iva || Math.round(comision * 0.19));
    const totalCliente = Number(servicio.total_cliente || bruto + comision + iva);
    return { bruto, retencion, liquido: Number(servicio.worker_liquido_estimado || bruto - retencion), comision, iva, totalCliente };
  };

  const activarAlertas = async () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
    const AudioContextClass = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (AudioContextClass) {
      audioContext.current = audioContext.current || new AudioContextClass();
      await audioContext.current.resume();
    }
    setAlertasActivas(true);
    alertasActivasRef.current = true;
  };

  const reproducirAlerta = () => {
    const context = audioContext.current;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
  };

  useEffect(() => {
    obtenerSesion().then(({ usuario, token }) => {
      setUsuario(usuario);
      registrarNotificaciones(token).catch(() => {});
    });
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
    cargarSolicitudes();
    const interval = setInterval(cargarSolicitudes, 5000);
    return () => clearInterval(interval);
  }, []);

  const cargarSolicitudes = async () => {
    try {
      const { token } = await obtenerSesion();
      const res = await api.get('/api/servicios', token!);
      // Solo trabajos ya pagados por el cliente.
      const pendientes = res.filter((s: any) => s.estado === 'buscando_worker');
      setSolicitudes(pendientes);
      setAvisos(pendientes.length);
      if (pendientes.length > ultimoAviso.current) {
        if (alertasActivasRef.current) reproducirAlerta();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Aseada: nuevo trabajo disponible', { body: `${pendientes.length} servicio(s) esperando un aseador.` });
        }
      }
      ultimoAviso.current = pendientes.length;
    } catch (e) {}
  };

  const aceptar = async (servicioId: number, workerRecibe: number) => {
    const servicio = solicitudes.find((item) => item.id === servicioId);
    const detalle = liquidacion(servicio || { worker_recibe: workerRecibe });
    const ok = await confirmar('¿Aceptar trabajo?',
      `Recibirás aproximadamente $${detalle.liquido.toLocaleString('es-CL')} líquidos. El pago se libera cuando el cliente confirma que el servicio quedó bien, o solo a las 24 horas de que lo marques terminado.`,
      'Aceptar');
    if (!ok) return;
    setLoading(true);
    try {
      const { token } = await obtenerSesion();
      await api.post(`/api/worker/aceptar/${servicioId}`, {}, token!);
      cargarSolicitudes();
      avisar('¡Trabajo aceptado!', 'El cliente fue notificado. Cuando termines, márcalo como terminado en tu historial.');
    } catch (e: any) {
      avisar('No se pudo aceptar', e?.message || 'Intenta nuevamente.');
    }
    setLoading(false);
  };

  const salir = async () => {
    await cerrarSesion();
    router.replace('/login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.saludo}>Hola, {usuario?.nombre?.split(' ')[0]} 🧹</Text>
          <Text style={styles.subtitulo}>Aseador profesional</Text>
        </View>
        {typeof window !== 'undefined' && !alertasActivas && (
          <TouchableOpacity style={styles.alertas} onPress={activarAlertas}>
            <Text style={styles.alertasTexto}>🔔 Activar sonido</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={salir}>
          <Text style={styles.salir}>Salir</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.seccion}>Solicitudes disponibles ({avisos})</Text>

      {solicitudes.length === 0 ? (
        <View style={styles.vacio}>
          <Text style={styles.vacioIcono}>⏳</Text>
          <Text style={styles.vacioTexto}>Esperando solicitudes...</Text>
          <Text style={styles.vacioSub}>Te notificaremos cuando haya trabajo</Text>
        </View>
      ) : (
        <FlatList
          data={solicitudes}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.tarjeta}>
              <Text style={styles.tipoServicio}>{item.tipo_servicio === 'fumigacion' ? `🪳 Fumigación · ${item.tipo_plaga || 'plaga por confirmar'}` : '🧹 Aseo del hogar'}</Text>
              <Text style={styles.tarjetaDireccion}>📍 {item.direccion}</Text>
              <Text style={styles.tarjetaDetalle}>🏠 {item.metros}m² · {item.horas_incluidas ? `${item.horas_incluidas} horas incluidas` : 'Duración por confirmar'}</Text>
              <Text style={styles.tarjetaDetalle}>{item.con_materiales ? '🧴 Con materiales' : '🧹 Sin materiales'}</Text>
              <View style={styles.tarjetaPrecio}>
                <View>
                  <Text style={styles.precioTexto}>Tu ganancia bruta estimada</Text>
                  <Text style={styles.precioNota}>Antes de retenciones legales</Text>
                  <Text style={styles.precioLiquido}>Líquido estimado: ${liquidacion(item).liquido.toLocaleString('es-CL')}</Text>
                </View>
                <Text style={styles.precioMonto}>${liquidacion(item).bruto.toLocaleString('es-CL')}</Text>
              </View>
              <View style={styles.liquidacion}>
                <Text style={styles.liquidacionTitulo}>Detalle del pago</Text>
                <View style={styles.detalleFila}><Text>Cliente paga</Text><Text>${liquidacion(item).totalCliente.toLocaleString('es-CL')}</Text></View>
                <View style={styles.detalleFila}><Text>Valor del servicio</Text><Text>${liquidacion(item).bruto.toLocaleString('es-CL')}</Text></View>
                <View style={styles.detalleFila}><Text>Comisión Aseada</Text><Text>-${liquidacion(item).comision.toLocaleString('es-CL')}</Text></View>
                <View style={styles.detalleFila}><Text>IVA sobre comisión</Text><Text>-${liquidacion(item).iva.toLocaleString('es-CL')}</Text></View>
                <View style={styles.detalleFila}><Text>Retención honorarios (15,25%)</Text><Text>-${liquidacion(item).retencion.toLocaleString('es-CL')}</Text></View>
                <View style={[styles.detalleFila, styles.liquidoFila]}><Text style={styles.liquidoLabel}>Recibirías aprox.</Text><Text style={styles.liquidoMonto}>${liquidacion(item).liquido.toLocaleString('es-CL')}</Text></View>
                <Text style={styles.legalNota}>Estimación referencial. El monto final depende de tu situación tributaria y la boleta emitida.</Text>
              </View>
              <TouchableOpacity style={styles.btnAceptar} onPress={() => aceptar(item.id, item.worker_recibe)} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>✅ Aceptar trabajo</Text>}
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <View style={styles.menu}>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/worker/perfil')}>
          <Text style={styles.menuIcono}>🧾</Text>
          <Text style={styles.menuTexto}>Perfil legal</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/worker/ganancias')}>
          <Text style={styles.menuIcono}>💰</Text>
          <Text style={styles.menuTexto}>Ganancias</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/worker/historial')}>
          <Text style={styles.menuIcono}>📋</Text>
          <Text style={styles.menuTexto}>Historial</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8ff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingTop: 60, backgroundColor: '#fff' },
  saludo: { fontSize: 20, fontWeight: 'bold' },
  subtitulo: { fontSize: 14, color: '#6C63FF' },
  alertas: { backgroundColor: '#fff4d6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginLeft: 'auto', marginRight: 12 },
  alertasTexto: { color: '#7c5b00', fontSize: 12, fontWeight: 'bold' },
  salir: { color: '#999', fontSize: 14 },
  seccion: { fontSize: 16, fontWeight: '600', padding: 16, color: '#333' },
  vacio: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vacioIcono: { fontSize: 64, marginBottom: 16 },
  vacioTexto: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  vacioSub: { fontSize: 14, color: '#666' },
  tarjeta: { backgroundColor: '#fff', margin: 12, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  tipoServicio: { color: '#6C63FF', fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  tarjetaDireccion: { fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  tarjetaDetalle: { fontSize: 14, color: '#666', marginBottom: 4 },
  tarjetaPrecio: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 12, backgroundColor: '#f0efff', borderRadius: 8, padding: 12 },
  precioTexto: { fontSize: 14, color: '#666' },
  precioNota: { fontSize: 11, color: '#888', marginTop: 3 },
  precioLiquido: { color: '#1f6b4f', fontSize: 12, fontWeight: '700', marginTop: 5 },
  liquidacion: { backgroundColor: '#fbfcfb', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e6ebe7' },
  liquidacionTitulo: { color: '#17231b', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  detalleFila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  liquidoFila: { borderTopWidth: 1, borderTopColor: '#dce3dc', paddingTop: 8, marginTop: 3 },
  liquidoLabel: { color: '#1f6b4f', fontWeight: '800' },
  liquidoMonto: { color: '#1f6b4f', fontSize: 18, fontWeight: '900' },
  legalNota: { color: '#777', fontSize: 11, lineHeight: 16, marginTop: 4 },
  precioMonto: { fontSize: 24, fontWeight: 'bold', color: '#6C63FF' },
  btnAceptar: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnTexto: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  menu: { flexDirection: 'row', backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  menuItem: { flex: 1, alignItems: 'center', padding: 8 },
  menuIcono: { fontSize: 24, marginBottom: 4 },
  menuTexto: { fontSize: 12, color: '#666' }
});
