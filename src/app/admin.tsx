import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../constants/api';
import { cerrarSesion, obtenerSesion } from '../constants/auth';
import { avisar, confirmar } from '../constants/dialogos';

const pesos = (n: any) => '$' + Number(n || 0).toLocaleString('es-CL');
const fecha = (f: string) => new Date(f).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MOTIVOS: Record<string, string> = { no_llego: 'No llegó nadie', incompleto: 'Trabajo incompleto', danio: 'Daño o pérdida', otro: 'Otro' };

export default function Admin() {
  const [transferencias, setTransferencias] = useState<any[]>([]);
  const [reclamos, setReclamos] = useState<any[]>([]);
  const [referencias, setReferencias] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const { token, usuario } = await obtenerSesion();
      if (usuario?.rol !== 'admin') return router.replace('/login');
      const [t, r] = await Promise.all([
        api.get('/api/admin/transferencias', token!),
        api.get('/api/admin/reclamos', token!),
      ]);
      setTransferencias(t);
      setReclamos(r);
    } catch (e: any) {
      avisar('No se pudo cargar', e?.message || 'Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (clave: string, fn: (token: string) => Promise<void>) => {
    setOcupado(clave);
    try {
      const { token } = await obtenerSesion();
      await fn(token!);
      await cargar();
    } catch (e: any) {
      avisar('No se pudo completar', e?.message || 'Intenta nuevamente.');
    } finally {
      setOcupado(null);
    }
  };

  const marcarTransferida = async (t: any) => {
    const ok = await confirmar('¿Ya hiciste la transferencia?',
      `${pesos(t.monto_a_transferir)} a ${t.worker_nombre}. Se le avisará que recibió el pago.`, 'Sí, transferí');
    if (!ok) return;
    await accion(`t${t.id}`, (token) =>
      api.post(`/api/admin/transferencias/${t.id}/transferida`, { referencia: referencias[t.id] || '' }, token));
  };

  const resolver = async (s: any, tipo: 'liberar' | 'reembolsar') => {
    const ok = await confirmar(tipo === 'liberar' ? '¿Liberar el pago al trabajador?' : '¿Devolver el dinero al cliente?',
      tipo === 'liberar'
        ? `El reclamo se cierra a favor del trabajador y se le paga el servicio #${s.id}.`
        : `Se registra la devolución de ${pesos(s.total_cliente)}. Después tienes que hacerla en el panel de Flow (orden ${s.flow_order || 's/n'}).`,
      tipo === 'liberar' ? 'Liberar' : 'Devolver');
    if (!ok) return;
    await accion(`r${s.id}`, async (token) => {
      const res = await api.post(`/api/admin/servicios/${s.id}/resolver`, { accion: tipo }, token);
      if (res.pendiente) avisar('Falta un paso', res.pendiente);
    });
  };

  const salir = async () => { await cerrarSesion(); router.replace('/login'); };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1f6b4f" /></View>;

  const listas = transferencias.filter((t) => t.estado === 'por_transferir');
  const esperando = transferencias.filter((t) => t.estado === 'esperando_fondos');
  const totalListas = listas.reduce((suma, t) => suma + t.monto_a_transferir, 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Administración</Text>
        <TouchableOpacity onPress={salir}><Text style={styles.salir}>Salir</Text></TouchableOpacity>
      </View>

      <Text style={styles.seccion}>Por transferir hoy · {pesos(totalListas)}</Text>
      <Text style={styles.ayuda}>Flow ya depositó este dinero. Transfiere desde Mercado Pago y márcalo aquí: al trabajador le llega el aviso.</Text>
      {listas.length === 0 && <Text style={styles.vacio}>No hay pagos pendientes.</Text>}
      {listas.map((t) => (
        <View key={t.id} style={styles.card}>
          <Text style={styles.monto}>{pesos(t.monto_a_transferir)}</Text>
          <Text style={styles.nombre}>{t.worker_nombre} · servicio #{t.servicio_id}</Text>
          {t.datos_bancarios_completos ? (
            <View style={styles.banco}>
              <Text style={styles.bancoTexto}>RUT {t.rut}</Text>
              <Text style={styles.bancoTexto}>{t.banco} · {t.tipo_cuenta || 'tipo no indicado'}</Text>
              <Text style={styles.bancoTexto}>Cuenta {t.numero_cuenta}</Text>
              <Text style={styles.bancoTexto}>{t.worker_email}</Text>
            </View>
          ) : (
            <Text style={styles.alerta}>⚠️ Faltan datos bancarios. Pídele a {t.worker_nombre} ({t.worker_email}) que complete su perfil.</Text>
          )}
          <Text style={styles.detalle}>
            Bruto {pesos(t.bruto)} · retención {Math.round(Number(t.tasa_retencion) * 10000) / 100}% ({pesos(t.retencion)}) ·{' '}
            {t.aseada_retiene ? 'Aseada retiene y paga al SII' : 'el trabajador declara su retención'}
          </Text>
          <TextInput style={styles.input} placeholder="N° de comprobante (opcional)" value={referencias[t.id] || ''}
            onChangeText={(v) => setReferencias((r) => ({ ...r, [t.id]: v }))} />
          <TouchableOpacity style={[styles.btn, !t.datos_bancarios_completos && styles.btnOff]} onPress={() => marcarTransferida(t)}
            disabled={!t.datos_bancarios_completos || ocupado === `t${t.id}`}>
            {ocupado === `t${t.id}` ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTexto}>Ya la transferí</Text>}
          </TouchableOpacity>
        </View>
      ))}

      {esperando.length > 0 && (
        <>
          <Text style={styles.seccion}>Esperando el depósito de Flow</Text>
          {esperando.map((t) => (
            <View key={t.id} style={[styles.card, styles.cardSuave]}>
              <Text style={styles.nombre}>{pesos(t.monto_a_transferir)} · {t.worker_nombre} · servicio #{t.servicio_id}</Text>
              <Text style={styles.detalle}>Disponible desde el {fecha(t.disponible_desde)}</Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.seccion}>Reclamos · {reclamos.length}</Text>
      {reclamos.length === 0 && <Text style={styles.vacio}>Sin reclamos abiertos.</Text>}
      {reclamos.map((s) => (
        <View key={s.id} style={[styles.card, styles.cardReclamo]}>
          <Text style={styles.nombre}>Servicio #{s.id} · {MOTIVOS[s.reclamo_motivo] || s.reclamo_motivo}</Text>
          {!!s.reclamo_detalle && <Text style={styles.cita}>“{s.reclamo_detalle}”</Text>}
          <Text style={styles.detalle}>Cliente: {s.cliente_nombre} · {s.cliente_email} · {s.cliente_telefono || 'sin teléfono'}</Text>
          <Text style={styles.detalle}>Trabajador: {s.worker_nombre || 'sin asignar'} {s.worker_telefono ? `· ${s.worker_telefono}` : ''}</Text>
          <Text style={styles.detalle}>Pagó {pesos(s.total_cliente)} · reportado el {fecha(s.reclamo_en)}</Text>
          <View style={styles.fila}>
            <TouchableOpacity style={[styles.btn, styles.btnMitad]} onPress={() => resolver(s, 'liberar')} disabled={!s.worker_id || ocupado === `r${s.id}`}>
              <Text style={styles.btnTexto}>Pagar al trabajador</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnMitad, styles.btnRojo]} onPress={() => resolver(s, 'reembolsar')} disabled={ocupado === `r${s.id}`}>
              <Text style={styles.btnTexto}>Devolver al cliente</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#f8faf6', padding: 20, maxWidth: 760, width: '100%', alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, marginBottom: 10 },
  title: { fontSize: 28, fontWeight: '900', color: '#17231b' },
  salir: { color: '#888' },
  seccion: { fontSize: 18, fontWeight: '800', color: '#17231b', marginTop: 24, marginBottom: 6 },
  ayuda: { fontSize: 13, color: '#5e6a61', lineHeight: 19, marginBottom: 10 },
  vacio: { color: '#888', fontSize: 14, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#dce3dc' },
  cardSuave: { backgroundColor: '#fbfcfb' },
  cardReclamo: { borderColor: '#f3d0cc' },
  monto: { fontSize: 24, fontWeight: '900', color: '#1f6b4f' },
  nombre: { fontSize: 15, fontWeight: '700', color: '#17231b', marginTop: 2, marginBottom: 6 },
  banco: { backgroundColor: '#f3f6f3', borderRadius: 8, padding: 10, marginBottom: 8 },
  bancoTexto: { fontSize: 14, color: '#344238', marginBottom: 2 },
  alerta: { color: '#b45309', fontSize: 13, marginBottom: 8 },
  detalle: { fontSize: 12, color: '#6b7280', marginBottom: 4, lineHeight: 17 },
  cita: { fontSize: 14, color: '#444', fontStyle: 'italic', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#dce3dc', borderRadius: 8, padding: 10, backgroundColor: '#fff', marginTop: 6 },
  fila: { flexDirection: 'row', gap: 8 },
  btn: { backgroundColor: '#1f6b4f', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  btnMitad: { flex: 1 },
  btnRojo: { backgroundColor: '#b91c1c' },
  btnOff: { backgroundColor: '#aab8ae' },
  btnTexto: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
