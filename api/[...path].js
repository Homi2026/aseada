const { get, list, put } = require('@vercel/blob');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'aseada-web-mvp-change-me';
const FILE = 'aseada-data.json';
const COMMISSION = 0.2;
const VAT = 0.19;
const HONORARIOS_RETENTION = 0.1525;
const EXTRA = [0, 8000, 15000, 21000];
const HOURS = { 50: 3, 80: 4, 120: 4, 200: 5, 999: 6 };
const CLEANING = { 50: [25000, 30000], 80: [35000, 40000], 120: [45000, 50000], 200: [60000, 65000], 999: [80000, 85000] };
const PESTS = { insectos: [39900, 49900, 64900, 84900], roedores: [49900, 59900, 79900, 99900], mixto: [59900, 69900, 89900, 119900] };

const fresh = () => ({ nextUser: 1, nextService: 1, users: [], services: [], notifications: [] });
async function read() {
  const { blobs } = await list({ prefix: FILE });
  const item = blobs.find((blob) => blob.pathname === FILE);
  if (!item) return fresh();
  const response = await get(item.url, { access: 'private' });
  return response.statusCode === 200 ? JSON.parse(await new Response(response.stream).text()) : fresh();
}
async function write(data) {
  await put(FILE, JSON.stringify(data), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
function send(res, status, body) { res.status(status).json(body); }
function route(req) { return (req.url || '').split('?')[0].replace(/^\/api\//, '/'); }
function session(req) { try { return jwt.verify(req.headers.authorization?.split(' ')[1], SECRET); } catch { return null; } }
function limitFor(table, meters) { return Object.keys(table).map(Number).find((limit) => meters <= limit) || 999; }
function price({ metros, horas_extra = 0, con_materiales = false, tipo_servicio = 'aseo', tipo_plaga = 'insectos' }) {
  if (tipo_servicio === 'fumigacion') {
    const table = PESTS[tipo_plaga] || PESTS.insectos;
    const index = metros <= 50 ? 0 : metros <= 100 ? 1 : metros <= 200 ? 2 : 3;
    const base = table[index];
    const comision = Math.round(base * COMMISSION);
    const iva = Math.round(comision * VAT);
    const retencion_honorarios = Math.round(base * HONORARIOS_RETENTION);
    return { precio_base: base, extra: 0, subtotal: base, comision, iva, total_cliente: base + comision + iva, worker_recibe: base, retencion_honorarios, worker_liquido_estimado: base - retencion_honorarios, horas_incluidas: null };
  }
  const base = CLEANING[limitFor(CLEANING, metros)][con_materiales ? 1 : 0];
  const extra = EXTRA[horas_extra] || 0;
  const subtotal = base + extra;
  const comision = Math.round(subtotal * COMMISSION);
  const iva = Math.round(comision * VAT);
  const retencion_honorarios = Math.round(subtotal * HONORARIOS_RETENTION);
  return { precio_base: base, extra, subtotal, comision, iva, total_cliente: subtotal + comision + iva, worker_recibe: subtotal, retencion_honorarios, worker_liquido_estimado: subtotal - retencion_honorarios, horas_incluidas: HOURS[limitFor(HOURS, metros)] };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const path = route(req);
  const body = req.body || {};
  try {
    if (req.method === 'POST' && path === '/calcular-precio') return send(res, 200, price(body));
    const data = await read();
    if (req.method === 'POST' && path === '/auth/registro') {
      const { nombre, email, password, rol, telefono } = body;
      if (!nombre || !email || !password || !['cliente', 'worker'].includes(rol)) return send(res, 400, { error: 'Completa los datos requeridos' });
      const normalized = email.toLowerCase();
      if (data.users.some((item) => item.email === normalized)) return send(res, 400, { error: 'Email ya registrado' });
      const user = { id: data.nextUser++, nombre, email: normalized, password: await bcrypt.hash(password, 10), telefono: telefono || '', rol, activo: true };
      data.users.push(user); await write(data);
      const token = jwt.sign({ id: user.id, email: user.email, rol: user.rol }, SECRET, { expiresIn: '7d' });
      return send(res, 201, { token, usuario: { id: user.id, nombre, email: normalized, telefono: user.telefono, rol } });
    }
    if (req.method === 'POST' && path === '/auth/login') {
      const user = data.users.find((item) => item.email === String(body.email || '').toLowerCase());
      if (!user || !(await bcrypt.compare(body.password || '', user.password))) return send(res, 400, { error: 'Credenciales incorrectas' });
      const token = jwt.sign({ id: user.id, email: user.email, rol: user.rol }, SECRET, { expiresIn: '7d' });
      return send(res, 200, { token, usuario: { id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono, rol: user.rol } });
    }
    const user = session(req);
    if (!user) return send(res, 401, { error: 'Token requerido' });
    if (req.method === 'POST' && path === '/servicios') {
      const { metros, horas_extra = 0, con_materiales = false, direccion, fecha_servicio, tipo_servicio = 'aseo', tipo_plaga = null } = body;
      if (!metros || !direccion) return send(res, 400, { error: 'Faltan dirección o tamaño' });
      const service = { id: data.nextService++, cliente_id: user.id, metros, horas_extra, con_materiales, direccion, fecha_servicio, tipo_servicio, tipo_plaga, estado: 'buscando_worker', ...price(body) };
      data.services.unshift(service);
      data.users.filter((item) => item.rol === 'worker' && item.activo).forEach((worker) => data.notifications.unshift({ id: Date.now() + worker.id, usuario_id: worker.id, titulo: 'Nuevo trabajo disponible', mensaje: `Servicio disponible por $${service.worker_recibe.toLocaleString('es-CL')}`, leida: false }));
      await write(data); return send(res, 201, service);
    }
    if (req.method === 'GET' && path === '/servicios') return send(res, 200, data.services.filter((item) => user.rol === 'worker' ? item.estado === 'buscando_worker' || item.estado === 'pendiente_pago' || item.worker_id === user.id : item.cliente_id === user.id));
    if (req.method === 'GET' && path === '/mis-servicios') return send(res, 200, data.services.filter((item) => item.cliente_id === user.id || item.worker_id === user.id));
    if (req.method === 'GET' && path === '/notificaciones') return send(res, 200, data.notifications.filter((item) => item.usuario_id === user.id));
    if (req.method === 'POST' && path === '/worker/perfil') {
      if (user.rol !== 'worker') return send(res, 403, { error: 'Solo aseadores pueden configurar este perfil' });
      const worker = data.users.find((item) => item.id === user.id);
      if (!worker) return send(res, 404, { error: 'Trabajador no encontrado' });
      const { modalidad = 'independiente', acepta_boleta = false, comuna, experiencia } = body;
      if (modalidad !== 'independiente' || acepta_boleta !== true) return send(res, 400, { error: 'Debes aceptar trabajar como prestador independiente y emitir boleta de honorarios' });
      worker.modalidad = modalidad;
      worker.acepta_boleta = true;
      worker.comuna = comuna || '';
      worker.experiencia = experiencia || '';
      worker.perfil_pago_completo = true;
      await write(data);
      return send(res, 200, { ok: true, perfil_pago_completo: true });
    }
    const accept = path.match(/^\/worker\/aceptar\/(\d+)$/);
    if (req.method === 'POST' && accept) {
      if (user.rol !== 'worker') return send(res, 403, { error: 'Solo aseadores pueden aceptar trabajos' });
      const service = data.services.find((item) => item.id === Number(accept[1]) && (item.estado === 'buscando_worker' || item.estado === 'pendiente_pago'));
      if (!service) return send(res, 404, { error: 'Servicio no disponible' });
      service.estado = 'en_proceso'; service.worker_id = user.id; await write(data); return send(res, 200, { mensaje: 'Trabajo aceptado' });
    }
    return send(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) { console.error(error); return send(res, 500, { error: error.message || 'No se pudo completar la operación' }); }
};
