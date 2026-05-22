const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'aseada_secret_2025';
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY;
const FLOW_API_URL = process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let usuarios = [
  { id: 1, nombre: 'Martina Araya', email: 'martina@email.com', password: '123456', rol: 'client' },
  { id: 2, nombre: 'Carmen Rojas',  email: 'carmen@email.com',  password: '123456', rol: 'worker', tarifa: 16000, rating: 4.9, trabajos: 87, tier: 'Gold' },
  { id: 3, nombre: 'Lorena Paz',    email: 'lorena@email.com',  password: '123456', rol: 'worker', tarifa: 14000, rating: 4.8, trabajos: 124, tier: 'Silver' },
];
let solicitudes = [];
let pagos = [];
let idSolicitud = 1;
let idPago = 1;
const COMISION = 0.23;
const RETENCION = 0.1225;

const firmarFlow = (params) => {
  const keys = Object.keys(params).sort();
  let toSign = '';
  keys.forEach(k => { toSign += k + params[k]; });
  return crypto.createHmac('sha256', FLOW_SECRET_KEY).update(toSign).digest('hex');
};

const crearPagoFlow = async (solicitudId, monto, email, descripcion) => {
  const params = {
    apiKey: FLOW_API_KEY,
    amount: monto,
    commerceOrder: `ASEADA-${solicitudId}-${Date.now()}`,
    currency: 'CLP',
    email: email,
    subject: descripcion,
    urlConfirmation: `http://localhost:${PORT}/pagos/confirmar`,
    urlReturn: `http://localhost:${PORT}/pagos/retorno`,
  };
  params.s = firmarFlow(params);
  try {
    const resp = await axios.post(`${FLOW_API_URL}/payment/create`, new URLSearchParams(params).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return { ok: true, url: `${resp.data.url}?token=${resp.data.token}`, token: resp.data.token };
  } catch (err) {
    return { ok: false, error: err.response?.data || err.message };
  }
};

const verificarPagoFlow = async (token) => {
  const params = { apiKey: FLOW_API_KEY, token };
  params.s = firmarFlow(params);
  try {
    const resp = await axios.get(`${FLOW_API_URL}/payment/getStatus`, { params });
    return { ok: true, datos: resp.data };
  } catch (err) {
    return { ok: false, error: err.response?.data || err.message };
  }
};

const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido' });
  }
};

app.post('/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) return res.status(400).json({ error: 'Faltan campos' });
    if (usuarios.find(u => u.email === email)) return res.status(400).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const u = { id: usuarios.length + 1, nombre, email, password: hash, rol, tarifa: rol === 'worker' ? 12000 : null, rating: 5.0, trabajos: 0, tier: null };
    usuarios.push(u);
    const token = jwt.sign({ id: u.id, email, rol }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ mensaje: 'Cuenta creada', token, usuario: { id: u.id, nombre, email, rol } });
  } catch { res.status(500).json({ error: 'Error al registrar' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = usuarios.find(u => u.email === email);
    if (!u) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const ok = password === u.password || await bcrypt.compare(password, u.password).catch(() => false);
    if (!ok) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign({ id: u.id, email: u.email, rol: u.rol }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...perfil } = u;
    res.json({ mensaje: 'Sesion iniciada', token, usuario: perfil });
  } catch { res.status(500).json({ error: 'Error al iniciar sesion' }); }
});

app.get('/auth/perfil', verificarToken, (req, res) => {
  const u = usuarios.find(u => u.id === req.usuario.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const { password, ...perfil } = u;
  res.json(perfil);
});

app.get('/workers', (req, res) => {
  res.json(usuarios.filter(u => u.rol === 'worker').map(({ password, ...w }) => w));
});

app.post('/solicitudes', verificarToken, (req, res) => {
  try {
    const { tipo, horas, precioHora, cuando, direccion } = req.body;
    if (!tipo || !horas || !precioHora) return res.status(400).json({ error: 'Faltan datos' });
    const montoBase = horas * precioHora;
    const comision = Math.round(montoBase * COMISION);
    const totalCliente = montoBase + comision;
    const s = { id: idSolicitud++, clienteId: req.usuario.id, tipo, horas, precioHora, cuando: cuando || 'Hoy ASAP', direccion: direccion || '', estado: 'buscando', workerId: null, montoBase, comision, totalCliente, retencionWorker: Math.round(montoBase * RETENCION), pagoNetoWorker: Math.round(montoBase * (1 - RETENCION)), pagado: false, flowToken: null, creadaEn: new Date().toISOString() };
    solicitudes.push(s);
    console.log(`\nSOLICITUD #${s.id} - ${tipo} ${horas}hrs - Total: $${totalCliente}`);
    res.json({ mensaje: 'Solicitud creada', solicitud: s });
  } catch { res.status(500).json({ error: 'Error al crear solicitud' }); }
});

app.get('/solicitudes', verificarToken, (req, res) => {
  if (req.usuario.rol === 'client') return res.json(solicitudes.filter(s => s.clienteId === req.usuario.id));
  if (req.usuario.rol === 'worker') return res.json(solicitudes.filter(s => s.estado === 'buscando'));
  res.status(403).json({ error: 'No autorizado' });
});

app.put('/solicitudes/:id/aceptar', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'worker') return res.status(403).json({ error: 'Solo limpiadores' });
  const s = solicitudes.find(s => s.id === parseInt(req.params.id));
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  if (s.estado !== 'buscando') return res.status(400).json({ error: 'Ya tomada' });
  s.estado = 'aceptada';
  s.workerId = req.usuario.id;
  s.aceptadaEn = new Date().toISOString();
  const worker = usuarios.find(u => u.id === req.usuario.id);
  console.log(`\nACEPTADA #${s.id} por ${worker?.nombre}`);
  res.json({ mensaje: `${worker?.nombre} acepto`, solicitud: s });
});

app.post('/pagos/iniciar/:solicitudId', verificarToken, async (req, res) => {
  try {
    const s = solicitudes.find(s => s.id === parseInt(req.params.solicitudId));
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (s.pagado) return res.status(400).json({ error: 'Ya pagada' });
    if (s.clienteId !== req.usuario.id) return res.status(403).json({ error: 'No autorizado' });
    const cliente = usuarios.find(u => u.id === req.usuario.id);
    const resultado = await crearPagoFlow(s.id, s.totalCliente, cliente.email, `Limpieza ${s.tipo} - ${s.horas} hrs`);
    if (!resultado.ok) return res.status(500).json({ error: 'Error Flow', detalle: resultado.error });
    s.flowToken = resultado.token;
    s.estado = 'esperando_pago';
    console.log(`\nPAGO INICIADO #${s.id} - $${s.totalCliente}`);
    res.json({ mensaje: 'Redirigir a Flow', urlPago: resultado.url, token: resultado.token });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar pago', detalle: err.message });
  }
});

app.post('/pagos/confirmar', async (req, res) => {
  try {
    const { token } = req.body;
    const verificacion = await verificarPagoFlow(token);
    if (!verificacion.ok) return res.send('OK');
    if (verificacion.datos.status === 2) {
      const s = solicitudes.find(s => s.flowToken === token);
      if (s && !s.pagado) {
        s.pagado = true;
        s.estado = 'pagado';
        s.pagadoEn = new Date().toISOString();
        console.log(`\nPAGO CONFIRMADO #${s.id} - $${s.totalCliente}`);
      }
    }
    res.send('OK');
  } catch { res.send('OK'); }
});

app.get('/pagos/retorno', (req, res) => {
  res.json({ mensaje: 'Pago procesado. Vuelve a la app Aseada.' });
});

app.get('/pagos/estado/:token', verificarToken, async (req, res) => {
  const resultado = await verificarPagoFlow(req.params.token);
  if (!resultado.ok) return res.status(500).json({ error: 'Error al verificar' });
  const estados = { 1: 'pendiente', 2: 'pagado', 3: 'rechazado', 4: 'anulado' };
  res.json({ estado: estados[resultado.datos.status] || 'desconocido', datos: resultado.datos });
});

app.put('/solicitudes/:id/completar', verificarToken, (req, res) => {
  const s = solicitudes.find(s => s.id === parseInt(req.params.id));
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  if (!s.pagado) return res.status(400).json({ error: 'Pagar primero' });
  s.estado = 'completada';
  s.completadaEn = new Date().toISOString();
  const pago = { id: idPago++, solicitudId: s.id, clienteId: s.clienteId, workerId: s.workerId, montoTotal: s.totalCliente, comisionAseada: s.comision, pagoWorker: s.pagoNetoWorker, retencionSII: s.retencionWorker, estado: 'liquidado', fecha: new Date().toISOString() };
  pagos.push(pago);
  const w = usuarios.find(u => u.id === s.workerId);
  if (w) w.trabajos = (w.trabajos || 0) + 1;
  console.log(`\nCOMPLETADO #${s.id} - Worker ${w?.nombre} recibe: $${pago.pagoWorker}`);
  res.json({ mensaje: 'Completado - pago liberado', pago });
});

app.get('/pagos/mis-ganancias', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'worker') return res.status(403).json({ error: 'Solo limpiadores' });
  const misPagos = pagos.filter(p => p.workerId === req.usuario.id);
  res.json({ pagos: misPagos, resumen: { totalNeto: misPagos.reduce((s,p) => s+p.pagoWorker, 0), totalPPM: misPagos.reduce((s,p) => s+p.retencionSII, 0), totalTrabajos: misPagos.length } });
});

app.get('/', (req, res) => {
  res.json({ mensaje: 'Aseada API con Flow.cl', version: '2.0.0', flow: FLOW_API_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCCION' });
});

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`  Aseada Backend v2.0 - Puerto ${PORT}`);
  console.log(`  Flow: ${FLOW_API_URL.includes('sandbox') ? 'SANDBOX (pruebas)' : 'PRODUCCION'}`);
  console.log('========================================\n');
  console.log('Usuarios de prueba:');
  console.log('  Cliente: martina@email.com / 123456');
  console.log('  Worker:  carmen@email.com  / 123456\n');
});
