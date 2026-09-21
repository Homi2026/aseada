const { get, list, put } = require('@vercel/blob');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'aseada-web-mvp-change-me';
const STORE_FILE = 'aseada-data.json';
const COMISION = 0.2;
const PRECIOS = {
  50: { sin_materiales: 25000, con_materiales: 30000 },
  80: { sin_materiales: 35000, con_materiales: 40000 },
  120: { sin_materiales: 45000, con_materiales: 50000 },
  200: { sin_materiales: 60000, con_materiales: 65000 },
  999: { sin_materiales: 80000, con_materiales: 85000 },
};
const HORAS_EXTRA = [0, 8000, 15000, 21000];
const HORAS_INCLUIDAS = { 50: 3, 80: 4, 120: 4, 200: 5, 999: 6 };
const PRECIOS_FUMIGACION = {
  insectos: { 50: 39900, 100: 49900, 200: 64900, 999: 84900 },
  roedores: { 50: 49900, 100: 59900, 200: 79900, 999: 99900 },
  mixto: { 50: 59900, 100: 69900, 200: 89900, 999: 119900 },
};

function emptyData() {
  return { nextUserId: 1, nextServiceId: 1, users: [], services: [], notifications: [] };
}

async function readData() {
  const result = await list({ prefix: STORE_FILE, mode: 'folded' });
  const file = result.blobs.find((blob) => blob.pathname === STORE_FILE);
  if (!file) return emptyData();
  const response = await get(file.url, { access: 'private' });
  if (response.statusCode !== 200) return emptyData();
  return JSON.parse(await new Response(response.stream).text());
}

async function writeData(data) {
  await put(STORE_FILE, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function getRoute(req) {
  return (req.url || '').split('?')[0].replace(/^\/api\//, '/');
}

function auth(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function hoursFor(metros) {
  const limit = Object.keys(HORAS_INCLUIDAS).map(Number).find((value) => metros <= value) || 999;
  return HORAS_INCLUIDAS[limit];
}

function priceFor({ metros, horas_extra = 0, con_materiales = false, tipo_servicio = 'aseo', tipo_plaga = 'insectos' }) {
  if (tipo_servicio === 'fumigacion') {
    const table = PRECIOS_FUMIGACION[tipo_plaga] || PRECIOS_FUMIGACION.insectos;
    const limit = Object.keys(table).map(Number).find((value) => metros <= value) || 999;
    const base = table[limit];
    return { precio_base: base, extra: 0, subtotal: base, comision: Math.round(base * COMISION), total_cliente: Math.round(base * (1 + COMISION)), worker_recibe: base, horas_incluidas: null };
  }
  const limit = Object.keys(PRECIOS).map(Number).find((value) => metros <= value) || 999;
  const base = PRECIOS[limit][con_materiales ? 'con_materiales' : 'sin_materiales'];
  const extra = HORAS_EXTRA[horas_extra] || 0;
  const subtotal = base + extra;
  return { precio_base: base, extra, subtotal, comision: Math.round(subtotal * COMISION), total_cliente: Math.round(subtotal * (1 + COMISION)), worker_recibe: subtotal, horas_incluidas: hoursFor(metros) };
}

function serviceVisible(service, user) {
  return user.rol === 'worker'
    ? service.estado === 'buscando_worker' || service.estado === 'pendiente_pago' || service.worker_id === user.id
    : service.cliente_id === user.id;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const route = getRoute(req);
  const body = req.body || {};
  const data = await readData();

  try {
    if (req.method === 'POST' && route === '/calcular-precio') return json(res, 200, priceFor(body));

    if (req.method === 'POST' && route === '/auth/registro') {
      const { nombre, email, password, rol, telefono } = body;
      if (!nombre || !email || !password || !['cliente', 'worker'].includes(rol)) return json(res, 400, { error: 'Completa los datos requeridos' });
      if (data.users.some((user) => user.email === email.toLowerCase())) return json(res, 400, { error: 'Email ya registrado' });
      const user = { id: data.nextUserId++, nombre, email: email.toLowerCase(), password: await bcrypt.hash(password, 10), rol, telefono: telefono || '', activo: true, total_servicios: 0 };
      data.users.push(user);
      await writeData(data);
      const token = jwt.sign({ id: user.id, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
      return json(res, 201, { token, usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, telefono: user.telefono } });
    }

    if (req.method === 'POST' && route === '/auth/login') {
      const user = data.users.find((item) => item.email === String(body.email || '').toLowerCase());
      if (!user || !(await bcrypt.compare(body.password || '', user.password))) return json(res, 400, { error: 'Credenciales incorrectas' });
      const token = jwt.sign({ id: user.id, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
      return json(res, 200, { token, usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, telefono: user.telefono } });
    }

    const user = auth(req);
    if (!user) return json(res, 401, { error: 'Token requerido' });

    if (req.method === 'POST' && route === '/servicios') {
      const { metros, horas_extra = 0, con_materiales = false, direccion, fecha_servicio, tipo_servicio = 'aseo', tipo_plaga = null } = body;
      if (!metros || !direccion) return json(res, 400, { error: 'Faltan dirección o tamaño' });
      const price = priceFor({ metros, horas_extra, con_materiales, tipo_servicio, tipo_plaga });
      const service = { id: data.nextServiceId++, cliente_id: user.id, direccion, fecha_servicio, metros, horas_extra, con_materiales, tipo_servicio, tipo_plaga, estado: 'buscando_worker', ...price };
      data.services.unshift(service);
      data.users.filter((item) => item.rol === 'worker' && item.activo).forEach((worker) => data.notifications.unshift({ id: Date.now() + worker.id, usuario_id: worker.id, titulo: 'Nuevo trabajo disponible', mensaje: `Servicio disponible por $${price.worker_recibe.toLocaleString('es-CL')}`, leida: false }));
      await writeData(data);
      return json(res, 201, service);
    }

    if (req.method === 'GET' && route === '/servicios') return json(res, 200, data.services.filter((service) => serviceVisible(service, user)));
    if (req.method === 'GET' && route === '/mis-servicios') return json(res, 200, data.services.filter((service) => service.cliente_id === user.id || service.worker_id === user.id));
    if (req.method === 'GET' && route === '/notificaciones') return json(res, 200, data.notifications.filter((item) => item.usuario_id === user.id));

    const acceptMatch = route.match(/^\/worker\/aceptar\/(\d+)$/);
    if (req.method === 'POST' && acceptMatch) {
      if (user.rol !== 'worker') return json(res, 403, { error: 'Solo aseadores pueden aceptar trabajos' });
      const service = data.services.find((item) => item.id === Number(acceptMatch[1]) && (item.estado === 'buscando_worker' || item.estado === 'pendiente_pago'));
      if (!service) return json(res, 404, { error: 'Servicio no disponible' });
      service.estado = 'en_proceso';
      service.worker_id = user.id;
      await writeData(data);
      return json(res, 200, { mensaje: 'Trabajo aceptado' });
    }

    return json(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'No se pudo completar la operación' });
  }
};
