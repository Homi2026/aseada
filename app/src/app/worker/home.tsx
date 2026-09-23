import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api, esAccesoDenegado, esSesionVencida } from '../../constants/api';
import { exigirSesion, obtenerSesion, guardarSesion, cerrarSesion, volverAlLogin } from '../../constants/auth';
import { avisar, confirmar } from '../../constants/dialogos';
import { registrarNotificaciones } from '../../constants/notifications';
import { EstadoError } from '../../components/estado-error';

// Mismo texto que responde el servidor cuando la cuenta todavia no esta activa.
const MENSAJE_REVISION = 'Tu cuenta todavía está en revisión. Te avisamos cuando quede activada.';

type EstadoPantalla = 'cargando' | 'listo' | 'error' | 'en_revision';

/**
 * La bolsa de trabajos llega sin direccion mientras el servicio no es tuyo:
 * el servidor manda direccion_visible=false y omite el campo.
 */
const direccionDe = (item: any) =>
  item.direccion_visible === false || !item.direccion ? 'Dirección visible al aceptar' : item.direccion;

export default function HomeWorker() {
  const [usuario, setUsuario] = useState<any>(null);
  const [solicitudes, setSolicitudes] = useState<any[]>([]);
  const [avisos, setAvisos] = useState(0);
  const ultimoAviso = useRef(0);
  const audioContext = useRef<any>(null);
  const alertasActivasRef = useRef(false);
  const seguirConsultando = useRef(true);
  const [alertasActivas, setAlertasActivas] = useState(false);
  const [loading, setLoading] = useState(false);
  const [estado, setEstado] = useState<EstadoPantalla>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [mensajeRevision, setMensajeRevision] = useState(MENSAJE_REVISION);
  // null = todavia no le preguntamos al servidor si la cuenta esta activa.
  const [cuentaActiva, setCuentaActiva] = useState<boolean | null>(null);
  const [intentoRevision, setIntentoRevision] = useState(0);
  const [revisando, setRevisando] = useState(false);
  const [avisoConsulta, setAvisoConsulta] = useState('');
  const pushRegistrado = useRef(false);

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

  const pasarARevision = useCallback((mensaje?: string) => {
    seguirConsultando.current = false;
    setCuentaActiva(false);
    setMensajeRevision(mensaje || MENSAJE_REVISION);
    setEstado('en_revision');
  }, []);

  const cargarSolicitudes = useCallback(async () => {
    try {
      const { token } = await exigirSesion();
      const res = await api.get('/api/servicios', token);
      // Si mientras esperabamos esta respuesta la cuenta paso a revision, la
      // lista ya no manda: pintarla taparia la pantalla que corresponde.
      if (!seguirConsultando.current) return;
      // Solo trabajos ya pagados por el cliente.
      const pendientes = (Array.isArray(res) ? res : []).filter((s: any) => s.estado === 'buscando_worker');
      setSolicitudes(pendientes);
      setAvisos(pendientes.length);
      if (pendientes.length > ultimoAviso.current) {
        if (alertasActivasRef.current) reproducirAlerta();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Aseada: nuevo trabajo disponible', { body: `${pendientes.length} servicio(s) esperando un aseador.` });
        }
      }
      ultimoAviso.current = pendientes.length;
      setEstado('listo');
    } catch (e: any) {
      if (esSesionVencida(e)) {
        seguirConsultando.current = false;
        await volverAlLogin();
        return;
      }
      // El servidor corta las rutas del aseador mientras la cuenta esta en revision.
      if (esAccesoDenegado(e)) return pasarARevision(e?.message);
      setMensajeError(e?.message || 'Revisa tu conexión e intenta nuevamente.');
      // Si ya habia lista en pantalla, un fallo suelto del sondeo no la borra.
      setEstado((actual) => (actual === 'listo' ? actual : 'error'));
    }
  }, [pasarARevision]);

  /**
   * Si la cuenta esta activa se lo preguntamos al servidor, no a la copia
   * guardada en el telefono: esa copia se escribe una sola vez al iniciar
   * sesion y nadie la actualiza despues. Sin esta consulta, al aseador que un
   * administrador activa mientras tiene la app instalada le seguiria saliendo
   * "tu cuenta esta en revision" hasta que cerrara sesion, y la bolsa tampoco
   * lo corrige: /api/servicios no responde 403, le devuelve su lista vacia.
   */
  useEffect(() => {
    let montado = true;

    const revisarCuenta = async () => {
      const { token, usuario: guardado } = await obtenerSesion();
      if (!montado) return;
      if (!token) return volverAlLogin();
      setUsuario(guardado);
      // El token push se registra una vez, no en cada reintento.
      if (!pushRegistrado.current) {
        pushRegistrado.current = true;
        registrarNotificaciones(token).catch(() => {});
      }
      setRevisando(true);
      let cuenta = guardado;
      let aviso = '';
      try {
        // /api/usuarios devuelve la propia cuenta, en una lista de una fila.
        const filas = await api.get('/api/usuarios', token);
        const fresco = Array.isArray(filas) ? filas[0] : filas;
        if (fresco) {
          cuenta = fresco;
          await guardarSesion(token, fresco);
        }
      } catch (e: any) {
        if (esSesionVencida(e)) {
          seguirConsultando.current = false;
          await volverAlLogin();
          return;
        }
        // Sin respuesta seguimos con la copia local, pero se lo decimos: si su
        // cuenta ya quedo activada, el aviso explica por que no cambio nada.
        aviso = 'No pudimos confirmar el estado de tu cuenta con el servidor. Revisa tu conexión e intenta de nuevo.';
      }
      if (!montado) return;
      setRevisando(false);
      setAvisoConsulta(aviso);
      setUsuario(cuenta);
      const activa = cuenta?.activo !== false;
      if (activa) setCuentaActiva(true);
      else pasarARevision();
    };

    revisarCuenta();
    return () => {
      montado = false;
    };
  }, [intentoRevision, pasarARevision]);

  // La bolsa se sondea solo con la cuenta confirmada como activa. Como
  // pasarARevision apaga cuentaActiva, este efecto se vuelve a montar solo
  // cuando la consulta al servidor confirma que la activacion ya ocurrio.
  useEffect(() => {
    if (cuentaActiva !== true) return;
    let intervalo: ReturnType<typeof setInterval> | null = null;
    let montado = true;
    seguirConsultando.current = true;

    const detener = () => {
      if (intervalo) clearInterval(intervalo);
      intervalo = null;
    };

    const partir = async () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
      await cargarSolicitudes();
      if (!montado || !seguirConsultando.current) return;
      intervalo = setInterval(() => {
        if (!seguirConsultando.current) return detener();
        cargarSolicitudes();
      }, 5000);
    };

    partir();
    return () => {
      montado = false;
      detener();
    };
  }, [cuentaActiva, cargarSolicitudes]);

  /**
   * Vuelve a preguntarle al servidor si la cuenta ya quedo activada, sin salir
   * de la pantalla: la activacion puede llegar con la app abierta.
   */
  const revisarDeNuevo = useCallback(() => {
    setAvisoConsulta('');
    setIntentoRevision((n) => n + 1);
  }, []);

  const aceptar = async (servicioId: number, workerRecibe: number) => {
    const servicio = solicitudes.find((item) => item.id === servicioId);
    const detalle = liquidacion(servicio || { worker_recibe: workerRecibe });
    const ok = await confirmar('¿Aceptar trabajo?',
      `Recibirás aproximadamente $${detalle.liquido.toLocaleString('es-CL')} líquidos. El pago se libera cuando el cliente confirma que el servicio quedó bien, o solo a las 24 horas de que lo marques terminado.`,
      'Aceptar');
    if (!ok) return;
    setLoading(true);
    try {
      const { token } = await exigirSesion();
      await api.post(`/api/worker/aceptar/${servicioId}`, {}, token);
      cargarSolicitudes();
      avisar('¡Trabajo aceptado!', 'El cliente fue notificado. Cuando termines, márcalo como terminado en tu historial.');
    } catch (e: any) {
      if (esSesionVencida(e)) {
        setLoading(false);
        return volverAlLogin();
      }
      if (esAccesoDenegado(e)) {
        setLoading(false);
        return pasarARevision(e?.message);
      }
      avisar('No se pudo aceptar', e?.message || 'Intenta nuevamente.');
    }
    setLoading(false);
  };

  const salir = async () => {
    await cerrarSesion();
    router.replace('/login');
  };

  const encabezado = (
    <View style={styles.header}>
      <View>
        <Text style={styles.saludo}>Hola, {usuario?.nombre?.split(' ')[0]} 🧹</Text>
        <Text style={styles.subtitulo}>Aseador profesional</Text>
      </View>
      {estado === 'listo' && typeof window !== 'undefined' && !alertasActivas && (
        <TouchableOpacity style={styles.alertas} onPress={activarAlertas}>
          <Text style={styles.alertasTexto}>🔔 Activar sonido</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={salir}>
        <Text style={styles.salir}>Salir</Text>
      </TouchableOpacity>
    </View>
  );

  const menu = (
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
  );

  if (estado === 'en_revision') {
    return (
      <View style={styles.container}>
        {encabezado}
        <ScrollView contentContainerStyle={styles.revisionScroll}>
          <View style={styles.revisionTarjeta}>
            <Text style={styles.revisionIcono}>🕐</Text>
            <Text style={styles.revisionTitulo}>Tu cuenta está en revisión</Text>
            <Text style={styles.revisionTexto}>{mensajeRevision}</Text>
            <Text style={styles.revisionTexto}>
              Revisamos a mano cada aseador nuevo antes de mostrarle trabajos, para que el cliente reciba a alguien
              de confianza. Mientras tanto no verás la bolsa de trabajos.
            </Text>
            <Text style={styles.revisionSubtitulo}>Lo que puedes adelantar</Text>
            <Text style={styles.revisionItem}>· Comuna donde trabajas y tu experiencia.</Text>
            <Text style={styles.revisionItem}>· RUT y datos bancarios, para que podamos transferirte.</Text>
            <Text style={styles.revisionItem}>· Aceptar la modalidad de prestador independiente.</Text>
            {avisoConsulta ? <Text style={styles.revisionAviso}>{avisoConsulta}</Text> : null}
            <TouchableOpacity style={styles.revisionBoton} onPress={() => router.push('/worker/perfil')}>
              <Text style={styles.btnTexto}>Completar mi perfil</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.revisionBotonSecundario} onPress={revisarDeNuevo} disabled={revisando}>
              {revisando ? <ActivityIndicator color="#6C63FF" /> : <Text style={styles.revisionBotonSecundarioTexto}>Revisar de nuevo</Text>}
            </TouchableOpacity>
            <Text style={styles.revisionNota}>
              Si ya te avisamos que tu cuenta quedó activada, toca “Revisar de nuevo”. No necesitas cerrar sesión.
            </Text>
          </View>
        </ScrollView>
        {menu}
      </View>
    );
  }

  if (estado === 'cargando') {
    return (
      <View style={styles.container}>
        {encabezado}
        <View style={styles.centro}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
        {menu}
      </View>
    );
  }

  if (estado === 'error') {
    return (
      <View style={styles.container}>
        {encabezado}
        <EstadoError
          titulo="No pudimos cargar los trabajos"
          mensaje={mensajeError}
          onReintentar={() => {
            setEstado('cargando');
            cargarSolicitudes();
          }}
        />
        {menu}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {encabezado}

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
              <Text style={styles.tarjetaDireccion}>📍 {direccionDe(item)}</Text>
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

      {menu}
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
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vacio: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vacioIcono: { fontSize: 64, marginBottom: 16 },
  vacioTexto: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  vacioSub: { fontSize: 14, color: '#666' },
  revisionScroll: { padding: 16, paddingBottom: 24 },
  revisionTarjeta: { backgroundColor: '#fff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#e6e6f0' },
  revisionIcono: { fontSize: 44, marginBottom: 10 },
  revisionTitulo: { fontSize: 20, fontWeight: 'bold', color: '#17231b', marginBottom: 10 },
  revisionTexto: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 10 },
  revisionSubtitulo: { fontSize: 15, fontWeight: '800', color: '#17231b', marginTop: 6, marginBottom: 8 },
  revisionItem: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 4 },
  revisionBoton: { backgroundColor: '#6C63FF', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16 },
  revisionBotonSecundario: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#6C63FF' },
  revisionBotonSecundarioTexto: { color: '#6C63FF', fontSize: 16, fontWeight: 'bold' },
  revisionAviso: { backgroundColor: '#fff4d6', color: '#7c5b00', borderRadius: 10, padding: 10, fontSize: 13, lineHeight: 19, marginTop: 10 },
  revisionNota: { color: '#777', fontSize: 12, lineHeight: 18, marginTop: 10, textAlign: 'center' },
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
