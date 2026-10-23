import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { api, esSesionVencida } from '../constants/api';
import { cerrarSesion, exigirSesion, volverAlLogin } from '../constants/auth';
import { avisar, confirmar } from '../constants/dialogos';
import { EstadoError } from '../components/estado-error';
import { Avisos } from '../components/avisos';

const pesos = (n: any) => '$' + Number(n || 0).toLocaleString('es-CL');
const fecha = (f: string) => new Date(f).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dia = (f: string) => (f ? new Date(f).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'sin fecha');
const MOTIVOS: Record<string, string> = { no_llego: 'No llegó nadie', incompleto: 'Trabajo incompleto', danio: 'Daño o pérdida', otro: 'Otro' };

export default function Admin() {
  const [transferencias, setTransferencias] = useState<any[]>([]);
  const [reclamos, setReclamos] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [referencias, setReferencias] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [errorWorkers, setErrorWorkers] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [planes, setPlanes] = useState<any[]>([]);
  const [emailClave, setEmailClave] = useState('');

  const cancelarPlan = async (p: any) => {
    const ok = await confirmar('¿Cancelar el plan?',
      `Se cancelan las ${p.visitas_pendientes} visitas que aún no tienen aseador y se le devuelven ${pesos(p.monto_pendiente)} a ${p.cliente_nombre} por Flow. Las visitas en curso o hechas no cambian.`,
      'Cancelar plan');
    if (!ok) return;
    await accion(`p${p.id}`, async (token) => {
      const res = await api.post(`/api/admin/planes/${p.id}/cancelar`, {}, token);
      avisar(res.pendiente ? 'Plan cancelado, falta el reembolso' : 'Plan cancelado',
        res.pendiente || `Se pidió a Flow devolver ${pesos(res.monto)}.`);
    });
  };
  const [claveTemporal, setClaveTemporal] = useState<{ email: string; clave: string } | null>(null);

  const restablecerClave = async () => {
    if (!emailClave.trim()) return avisar('Falta el email', 'Escribe el email de la cuenta.');
    const ok = await confirmar('¿Generar clave temporal?', `La contraseña actual de ${emailClave.trim()} deja de servir.`, 'Generar');
    if (!ok) return;
    setOcupado('clave');
    try {
      const { token } = await exigirSesion();
      const res = await api.post('/api/admin/usuarios/restablecer-clave', { email: emailClave.trim() }, token);
      setClaveTemporal({ email: res.email, clave: res.clave_temporal });
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
      avisar('No se pudo restablecer', e?.message || 'Intenta nuevamente.');
    } finally {
      setOcupado(null);
    }
  };

  const cargar = useCallback(async () => {
    try {
      const { token, usuario } = await exigirSesion();
      if (usuario?.rol !== 'admin') return router.replace('/login');
      const [t, r] = await Promise.all([
        api.get('/api/admin/transferencias', token),
        api.get('/api/admin/reclamos', token),
      ]);
      setTransferencias(Array.isArray(t) ? t : []);
      setReclamos(Array.isArray(r) ? r : []);
      setErrorCarga('');
      // El listado de aseadores va aparte a proposito: si esa ruta todavia no
      // esta desplegada, transferencias y reclamos igual tienen que abrirse.
      try {
        const w = await api.get('/api/admin/workers', token);
        setWorkers(Array.isArray(w) ? w : []);
        setErrorWorkers('');
      } catch (error: any) {
        if (esSesionVencida(error)) return volverAlLogin();
        setWorkers([]);
        setErrorWorkers(error?.message || 'No pudimos cargar los aseadores.');
      }
      try {
        const p = await api.get('/api/admin/planes', token);
        setPlanes(Array.isArray(p) ? p : []);
      } catch (error: any) {
        if (esSesionVencida(error)) return volverAlLogin();
        setPlanes([]);
      }
    } catch (e: any) {
      // Una sesion vencida no es "no hay nada que administrar": manda al login.
      if (esSesionVencida(e)) return volverAlLogin();
      setErrorCarga(e?.message || 'Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (clave: string, fn: (token: string) => Promise<void>) => {
    setOcupado(clave);
    try {
      const { token } = await exigirSesion();
      await fn(token);
      await cargar();
    } catch (e: any) {
      if (esSesionVencida(e)) return volverAlLogin();
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

  const cambiarActivacion = async (w: any) => {
    const activar = !w.activo;
    const ok = await confirmar(
      activar ? '¿Activar a este aseador?' : '¿Desactivar a este aseador?',
      activar
        ? `${w.nombre} va a ver la bolsa de trabajos y podrá aceptar servicios.`
        : `${w.nombre} dejará de ver la bolsa. Los trabajos que ya aceptó siguen a su nombre.`,
      activar ? 'Activar' : 'Desactivar');
    if (!ok) return;
    await accion(`w${w.id}`, (token) => api.post(`/api/admin/workers/${w.id}/activar`, { activo: activar }, token));
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
      if (res?.pendiente) avisar('Falta un paso', res.pendiente);
    });
  };

  const salir = async () => { await cerrarSesion(); router.replace('/login'); };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1f6b4f" /></View>;

  if (errorCarga) {
    return (
      <EstadoError
        titulo="No pudimos cargar la administración"
        mensaje={errorCarga}
        color="#1f6b4f"
        onReintentar={() => { setLoading(true); cargar(); }}
      />
    );
  }

  const listas = transferencias.filter((t) => t.estado === 'por_transferir');
  const esperando = transferencias.filter((t) => t.estado === 'esperando_fondos');
  const totalListas = listas.reduce((suma, t) => suma + t.monto_a_transferir, 0);
  const porActivar = workers.filter((w) => !w.activo);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Administración</Text>
        <TouchableOpacity onPress={salir}><Text style={styles.salir}>Salir</Text></TouchableOpacity>
      </View>

      <Avisos color="#1f6b4f" />

      <Text style={styles.seccion}>Aseadores por activar · {porActivar.length}</Text>
      <Text style={styles.ayuda}>
        Un aseador nuevo entra en revisión y no ve la bolsa de trabajos hasta que lo actives. Revisa que tenga comuna,
        experiencia y datos de pago antes de darle acceso.
      </Text>
      {!!errorWorkers && <Text style={styles.alerta}>⚠️ No pudimos cargar los aseadores: {errorWorkers}</Text>}
      {!errorWorkers && workers.length === 0 && <Text style={styles.vacio}>Todavía no hay aseadores registrados.</Text>}
      {workers.map((w) => (
        <View key={w.id} style={[styles.card, w.activo && styles.cardSuave]}>
          <View style={styles.filaTitulo}>
            <Text style={styles.nombre}>{w.nombre}</Text>
            <Text style={[styles.pill, w.activo ? styles.pillActivo : styles.pillRevision]}>
              {w.activo ? 'Activo' : 'En revisión'}
            </Text>
          </View>
          <Text style={styles.detalle}>{w.email} · {w.telefono || 'sin teléfono'}</Text>
          <Text style={styles.detalle}>Comuna: {w.comuna || 'sin indicar'}</Text>
          <Text style={styles.detalle}>Experiencia: {w.experiencia || 'sin indicar'}</Text>
          <Text style={styles.detalle}>
            Datos de pago: {w.perfil_pago_completo ? 'completos' : 'incompletos'} · se registró el {dia(w.creado_en)}
          </Text>
          {!w.activo && !w.perfil_pago_completo && (
            <Text style={styles.alerta}>⚠️ Sin datos bancarios no vamos a poder transferirle cuando cobre.</Text>
          )}
          <TouchableOpacity
            style={[styles.btn, w.activo && styles.btnGris]}
            onPress={() => cambiarActivacion(w)}
            disabled={ocupado === `w${w.id}`}>
            {ocupado === `w${w.id}`
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnTexto}>{w.activo ? 'Desactivar' : 'Activar cuenta'}</Text>}
          </TouchableOpacity>
        </View>
      ))}

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

      <Text style={styles.seccion}>Planes activos · {planes.length}</Text>
      {planes.length === 0 && <Text style={styles.vacio}>Sin planes activos.</Text>}
      {planes.map((p) => (
        <View key={p.id} style={styles.card}>
          <Text style={styles.nombre}>Plan #{p.id} · {p.tipo === 'trimestral' ? '3 meses' : 'mensual'} · {p.cliente_nombre}</Text>
          <Text style={styles.detalle}>{p.cliente_email} · {p.direccion} · {p.metros} m²</Text>
          <Text style={styles.detalle}>Pagó {pesos(p.total)} · {p.visitas_hechas} de {p.visitas} visitas hechas · {p.visitas_pendientes} sin aseador ({pesos(p.monto_pendiente)})</Text>
          {p.visitas_pendientes > 0 && (
            <TouchableOpacity style={[styles.btn, styles.btnRojo]} onPress={() => cancelarPlan(p)} disabled={ocupado === `p${p.id}`}>
              <Text style={styles.btnTexto}>Cancelar visitas pendientes y devolver</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      <Text style={styles.seccion}>Restablecer contraseña</Text>
      <Text style={styles.ayuda}>
        Cuando alguien escribe a soporte porque olvidó su contraseña: verifica que el correo venga de la misma cuenta,
        genera una clave temporal y envíasela. La puede cambiar desde su perfil.
      </Text>
      <View style={styles.card}>
        <TextInput style={styles.input} placeholder="Email de la cuenta" value={emailClave} onChangeText={setEmailClave} autoCapitalize="none" keyboardType="email-address" />
        <TouchableOpacity style={styles.btn} onPress={restablecerClave} disabled={ocupado === 'clave'}>
          <Text style={styles.btnTexto}>Generar clave temporal</Text>
        </TouchableOpacity>
        {!!claveTemporal && (
          <Text selectable style={styles.detalle}>Clave temporal de {claveTemporal.email}: {claveTemporal.clave}</Text>
        )}
      </View>
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
  filaTitulo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pill: { fontSize: 12, fontWeight: '800', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  pillActivo: { backgroundColor: '#eef7f0', color: '#1f6b4f' },
  pillRevision: { backgroundColor: '#fff4d6', color: '#7c5b00' },
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
  btnGris: { backgroundColor: '#8a978e' },
  btnOff: { backgroundColor: '#aab8ae' },
  btnTexto: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
