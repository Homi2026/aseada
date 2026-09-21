// .env.local primero porque es lo que escribe `vercel env pull`, y tiene
// precedencia sobre .env. En Vercel las variables vienen de la plataforma y
// estos archivos no existen, asi que esto solo aplica en local.
require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
function requerida(nombre, motivo) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}. ${motivo}`);
  return valor;
}

const JWT_SECRET = requerida('JWT_SECRET', 'Sin ella cualquiera podria firmar tokens validos, asi que el servidor no arranca.');
requerida('DATABASE_URL', 'Sin ella ninguna ruta puede consultar la base de datos.');

// Flow es opcional al arrancar: solo las rutas de pago lo necesitan.
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET = process.env.FLOW_SECRET_KEY;
const FLOW_API_URL = process.env.FLOW_API_URL || 'https://www.flow.cl/api';

// Flow necesita una URL publica a la que volver despues del pago. Estaba
// escrita a mano apuntando a Railway, que ya no existe, asi que ninguna
// confirmacion podia llegar. VERCEL_URL sirve de respaldo, pero cambia en
// cada deploy: para produccion hay que fijar PUBLIC_URL al dominio estable.
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) || '').replace(/\/$/, '');

const FALTA_PARA_FLOW = [
  !FLOW_API_KEY && 'FLOW_API_KEY',
  !FLOW_SECRET && 'FLOW_SECRET_KEY',
  !PUBLIC_URL && 'PUBLIC_URL'
].filter(Boolean);
const FLOW_CONFIGURADO = FALTA_PARA_FLOW.length === 0;
if (!FLOW_CONFIGURADO) console.warn(`[aseada] faltan ${FALTA_PARA_FLOW.join(', ')}: las rutas de pago responderan 503.`);

const exigirFlow = (req, res, next) => {
  // Nombrar solo lo que falta de verdad: una lista fija manda a revisar
  // variables que ya estaban bien puestas.
  if (!FLOW_CONFIGURADO) return res.status(503).json({ error: `Los pagos no estan disponibles: falta configurar ${FALTA_PARA_FLOW.join(', ')} en el servidor.` });
  next();
};
// En Vercel cada invocacion corre en su propia instancia, asi que un pool
// grande multiplica conexiones contra Postgres hasta agotarlas. Con una
// conexion por instancia y cierre rapido de las ociosas, el pooler de Neon
// absorbe la concurrencia.
const EN_SERVERLESS = Boolean(process.env.VERCEL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: EN_SERVERLESS ? 1 : 10,
  idleTimeoutMillis: EN_SERVERLESS ? 10000 : 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', (error) => console.error('[aseada] error inesperado en el pool de Postgres:', error.message));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── PRECIOS ────────────────────────────────────────────────────────────────
const PRECIOS = {
  50:  { sin_materiales: 25000, con_materiales: 30000 },
  80:  { sin_materiales: 35000, con_materiales: 40000 },
  120: { sin_materiales: 45000, con_materiales: 50000 },
  200: { sin_materiales: 60000, con_materiales: 65000 },
  999: { sin_materiales: 80000, con_materiales: 85000 }
};
const HORAS_EXTRA = { 1: 8000, 2: 15000, 3: 21000 };
const COMISION = 0.20;
const IVA = 0.19;
const RETENCION_HONORARIOS = 0.1525;
const PRECIOS_FUMIGACION = {
  insectos: { 50: 39900, 100: 49900, 200: 64900, 999: 84900 },
  roedores: { 50: 49900, 100: 59900, 200: 79900, 999: 99900 },
  mixto: { 50: 59900, 100: 69900, 200: 89900, 999: 119900 }
};
const HORAS_INCLUIDAS = { 50: 3, 80: 4, 120: 4, 200: 5, 999: 6 };

function horasIncluidas(metros) {
  const limite = Object.keys(HORAS_INCLUIDAS).map(Number).sort((a, b) => a - b).find((valor) => metros <= valor) || 999;
  return HORAS_INCLUIDAS[limite];
}

function calcularPrecio(metros, horas_extra, con_materiales, tipo_servicio = 'aseo', tipo_plaga = 'insectos') {
  if (tipo_servicio === 'fumigacion') {
    const tabla = PRECIOS_FUMIGACION[tipo_plaga] || PRECIOS_FUMIGACION.insectos;
    const limite = Object.keys(tabla).map(Number).sort((a, b) => a - b).find((valor) => metros <= valor) || 999;
    const precio_base = tabla[limite];
    const comision = Math.round(precio_base * COMISION);
    const iva = Math.round(comision * IVA);
    const retencion_honorarios = Math.round(precio_base * RETENCION_HONORARIOS);
    return { precio_base, extra: 0, subtotal: precio_base, comision, iva, total_cliente: precio_base + comision + iva, worker_recibe: precio_base, retencion_honorarios, worker_liquido_estimado: precio_base - retencion_honorarios, horas_incluidas: null, tipo_servicio, tipo_plaga };
  }
  let precio_base = 0;
  for (const limite of Object.keys(PRECIOS).map(Number).sort((a,b)=>a-b)) {
    if (metros <= limite) { precio_base = PRECIOS[limite][con_materiales ? 'con_materiales' : 'sin_materiales']; break; }
  }
  const extra = HORAS_EXTRA[horas_extra] || 0;
  const subtotal = precio_base + extra;
  const comision = Math.round(subtotal * COMISION);
  const iva = Math.round(comision * IVA);
  const total_cliente = subtotal + comision + iva;
  const worker_recibe = subtotal;
  const retencion_honorarios = Math.round(subtotal * RETENCION_HONORARIOS);
  return { precio_base, extra, subtotal, comision, iva, total_cliente, worker_recibe, retencion_honorarios, worker_liquido_estimado: subtotal - retencion_honorarios, horas_incluidas: horasIncluidas(metros), tipo_servicio };
}

async function prepararEsquema() {
  await pool.query("ALTER TABLE servicios ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(40) DEFAULT 'aseo'");
  await pool.query("ALTER TABLE servicios ADD COLUMN IF NOT EXISTS tipo_plaga VARCHAR(40)");
  await pool.query("ALTER TABLE servicios ADD COLUMN IF NOT EXISTS horas_incluidas INTEGER");
  await pool.query("ALTER TABLE servicios ADD COLUMN IF NOT EXISTS iva INTEGER DEFAULT 0");
  await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS push_token TEXT");
  await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS modalidad VARCHAR(30)");
  await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS acepta_boleta BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS comuna TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS experiencia TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_pago_completo BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query(`CREATE TABLE IF NOT EXISTS notificaciones (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo VARCHAR(80) NOT NULL,
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
}

async function notificarWorkers(servicio) {
  try {
    const result = await pool.query(
      `INSERT INTO notificaciones(usuario_id, tipo, titulo, mensaje, leida, creado_en)
       SELECT id, 'nuevo_servicio', $1, $2, false, NOW() FROM usuarios WHERE rol='worker' AND activo=true`,
      ['Nuevo trabajo disponible', `Hay un servicio de ${servicio.tipo_servicio === 'fumigacion' ? 'fumigación' : 'aseo'} disponible por $${Number(servicio.worker_recibe).toLocaleString('es-CL')}.`]
    );
    const workers = await pool.query("SELECT push_token FROM usuarios WHERE rol='worker' AND activo=true AND push_token IS NOT NULL");
    await Promise.all(workers.rows.map(({ push_token }) => axios.post('https://exp.host/--/api/v2/push/send', {
      to: push_token,
      title: 'Aseada: nuevo trabajo disponible',
      body: `Hay un servicio disponible por $${Number(servicio.worker_recibe).toLocaleString('es-CL')}.`,
      sound: 'default',
      channelId: 'trabajos',
      data: { servicio_id: servicio.id },
    }).catch((error) => console.warn('No se pudo enviar push:', error.message))));
  } catch (error) {
    console.warn('No se pudieron crear notificaciones; el polling de trabajos sigue activo:', error.message);
  }
}

// ─── FLOW HELPERS ────────────────────────────────────────────────────────────
function flowSign(params) {
  const keys = Object.keys(params).sort();
  let msg = '';
  for (const k of keys) msg += k + params[k];
  return crypto.createHmac('sha256', FLOW_SECRET).update(msg).digest('hex');
}

async function flowPost(endpoint, params) {
  params.apiKey = FLOW_API_KEY;
  params.s = flowSign(params);
  const form = new URLSearchParams(params);
  const r = await axios.post(`${FLOW_API_URL}${endpoint}`, form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return r.data;
}

async function flowGet(endpoint, params) {
  params.apiKey = FLOW_API_KEY;
  params.s = flowSign(params);
  const r = await axios.get(`${FLOW_API_URL}${endpoint}`, { params });
  return r.data;
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try { req.usuario = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalido' }); }
};

const exigirRol = (...roles) => (req, res, next) => {
  if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  next();
};

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ mensaje: 'Aseada API funcionando', version: '3.0.0', db: 'PostgreSQL' }));

// ─── CALCULAR PRECIO (público) ───────────────────────────────────────────────
app.post('/api/calcular-precio', (req, res) => {
  const { metros, horas_extra = 0, con_materiales = false, tipo_servicio = 'aseo', tipo_plaga = 'insectos' } = req.body;
  if (!metros) return res.status(400).json({ error: 'Faltan metros cuadrados' });
  const precio = calcularPrecio(metros, horas_extra, con_materiales, tipo_servicio, tipo_plaga);
  res.json(precio);
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password, rol, telefono } = req.body;
    if (!nombre||!email||!password||!rol) return res.status(400).json({ error: 'Faltan campos' });
    if (!['cliente', 'worker'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    const ex = await pool.query('SELECT id FROM usuarios WHERE email=$1', [email]);
    if (ex.rows.length > 0) return res.status(400).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO usuarios(nombre,email,password,rol,telefono,calificacion_promedio,total_servicios,activo) VALUES($1,$2,$3,$4,$5,5.0,0,true) RETURNING id,nombre,email,rol',
      [nombre, email, hash, rol, telefono || null]
    );
    const token = jwt.sign({ id: r.rows[0].id, email: r.rows[0].email, rol: r.rows[0].rol }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ mensaje: 'Cuenta creada', token, usuario: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    if (!r.rows[0]) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const valid = await bcrypt.compare(password, r.rows[0].password);
    if (!valid) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign({ id: r.rows[0].id, email: r.rows[0].email, rol: r.rows[0].rol }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, usuario: { id: r.rows[0].id, nombre: r.rows[0].nombre, email: r.rows[0].email, rol: r.rows[0].rol, telefono: r.rows[0].telefono, calificacion_promedio: r.rows[0].calificacion_promedio } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── USUARIOS ────────────────────────────────────────────────────────────────
// Devuelve la propia cuenta. Antes listaba a todos los usuarios con su email
// y telefono; no existe rol de administrador que justifique ese acceso.
app.get('/api/usuarios', verificarToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,nombre,email,rol,telefono,foto_url,calificacion_promedio,total_servicios,activo FROM usuarios WHERE id=$1', [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vitrina publica de aseadores. Sin email ni telefono: son datos de contacto
// personales y esta ruta no pide sesion.
app.get('/api/workers', async (req, res) => {
  try { const r = await pool.query("SELECT id,nombre,foto_url,calificacion_promedio,total_servicios,comuna FROM usuarios WHERE rol='worker' AND activo=true ORDER BY calificacion_promedio DESC"); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── SERVICIOS ───────────────────────────────────────────────────────────────
app.post('/api/servicios', verificarToken, async (req, res) => {
  try {
    const { metros, horas_extra = 0, con_materiales = false, direccion, fecha_servicio, tipo_servicio = 'aseo', tipo_plaga = null } = req.body;
    if (!metros || !direccion) return res.status(400).json({ error: 'Faltan campos' });
    if (!['aseo', 'fumigacion'].includes(tipo_servicio)) return res.status(400).json({ error: 'Tipo de servicio inválido' });
    const precio = calcularPrecio(metros, horas_extra, con_materiales, tipo_servicio, tipo_plaga);
    const r = await pool.query(
      `INSERT INTO servicios(cliente_id,direccion,fecha_servicio,metros,horas_extra,con_materiales,precio_base,horas_extra_precio,subtotal,comision,iva,total_cliente,worker_recibe,retencion_honorarios,estado,tipo_servicio,tipo_plaga,horas_incluidas)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pendiente_pago',$15,$16,$17) RETURNING *`,
      [req.usuario.id, direccion, fecha_servicio, metros, horas_extra, con_materiales,
       precio.precio_base, precio.extra, precio.subtotal, precio.comision, precio.iva, precio.total_cliente, precio.worker_recibe, precio.retencion_honorarios, tipo_servicio, tipo_plaga, precio.horas_incluidas]
    );
    await notificarWorkers(r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/servicios', verificarToken, async (req, res) => {
  try {
    const query = req.usuario.rol === 'worker'
      ? "SELECT * FROM servicios WHERE estado IN ('buscando_worker', 'pendiente_pago') OR worker_id=$1 ORDER BY id DESC"
      : 'SELECT * FROM servicios WHERE cliente_id=$1 ORDER BY id DESC';
    const r = await pool.query(query, [req.usuario.id]);
    res.json(r.rows);
  }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mis-servicios', verificarToken, async (req, res) => {
  try {
    const col = req.usuario.rol === 'worker' ? 'worker_id' : 'cliente_id';
    const r = await pool.query(`SELECT * FROM servicios WHERE ${col}=$1 ORDER BY id DESC`, [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/servicios/:id/completar', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM servicios WHERE id=$1', [req.params.id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    // Solo el aseador asignado da por terminado su propio trabajo: completar
    // es la condicion previa para que se libere el pago.
    if (s.worker_id !== req.usuario.id) return res.status(403).json({ error: 'Solo el aseador asignado puede completar este servicio' });
    if (s.estado !== 'en_proceso') return res.status(400).json({ error: 'El servicio no está en proceso' });
    await pool.query("UPDATE servicios SET estado='completado', completado_en=NOW() WHERE id=$1", [req.params.id]);
    res.json({ mensaje: 'Servicio completado — pago será liberado al worker' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── FLOW PAGOS ───────────────────────────────────────────────────────────────
app.post('/api/pagos/crear', exigirFlow, verificarToken, async (req, res) => {
  try {
    const { servicio_id } = req.body;
    const { rows } = await pool.query('SELECT * FROM servicios WHERE id=$1 AND cliente_id=$2', [servicio_id, req.usuario.id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.estado !== 'pendiente_pago') return res.status(400).json({ error: 'El servicio no está pendiente de pago' });
    const comercialId = `ASEADA-${servicio_id}-${Date.now()}`;
    const flowData = await flowPost('/payment/create', {
      commerceOrder: comercialId,
      subject: `Servicio de limpieza Aseada #${servicio_id}`,
      currency: 'CLP',
      amount: s.total_cliente,
      email: req.usuario.email,
      urlConfirmation: `${PUBLIC_URL}/pagos/flow/confirmacion`,
      urlReturn: `${PUBLIC_URL}/pagos/flow/retorno`
    });
    await pool.query(
      'INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [servicio_id, req.usuario.id, s.total_cliente, s.comision, s.worker_recibe, 'pendiente', flowData.token, comercialId]
    );
    res.json({ url_pago: `${flowData.url}?token=${flowData.token}`, token: flowData.token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/pagos/flow/confirmacion', exigirFlow, async (req, res) => {
  try {
    const { token } = req.body;
    const flowData = await flowGet('/payment/getStatus', { token });
    if (flowData.status === 2) {
      await pool.query("UPDATE pagos SET estado='pagado', pagado_en=NOW() WHERE flow_token=$1", [token]);
      const { rows } = await pool.query('SELECT * FROM pagos WHERE flow_token=$1', [token]);
      if (rows[0]) {
        await pool.query("UPDATE servicios SET estado='buscando_worker' WHERE id=$1", [rows[0].servicio_id]);
      }
    } else if (flowData.status === 3) {
      await pool.query("UPDATE pagos SET estado='rechazado' WHERE flow_token=$1", [token]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/pagos/flow/retorno', exigirFlow, async (req, res) => {
  try {
    const { token } = req.query;
    const flowData = await flowGet('/payment/getStatus', { token });
    if (flowData.status === 2) {
      res.redirect('aseada://pago-exitoso?token=' + token);
    } else {
      res.redirect('aseada://pago-rechazado?token=' + token);
    }
  } catch(e) { res.redirect('aseada://pago-rechazado'); }
});

app.post('/api/pagos/liberar/:servicio_id', exigirFlow, verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT s.*, p.id as pago_id, p.pago_worker, u.email as worker_email FROM servicios s JOIN pagos p ON p.servicio_id=s.id JOIN usuarios u ON u.id=s.worker_id WHERE s.id=$1', [req.params.servicio_id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    // Por aca sale el dinero del escrow. Solo el cliente que pago puede
    // liberarlo; sin esta comprobacion cualquier sesion valida podia cobrar
    // el servicio de otra persona.
    if (s.cliente_id !== req.usuario.id) return res.status(403).json({ error: 'Solo el cliente del servicio puede liberar el pago' });
    if (s.estado !== 'completado') return res.status(400).json({ error: 'El servicio no está completado' });
    await pool.query("UPDATE pagos SET estado='liberado', liberado_en=NOW() WHERE id=$1", [s.pago_id]);
    await pool.query("UPDATE servicios SET estado='pagado' WHERE id=$1", [req.params.servicio_id]);
    await pool.query('UPDATE usuarios SET total_servicios=total_servicios+1 WHERE id=$1', [s.worker_id]);
    res.json({ mensaje: 'Pago liberado al worker', monto: s.pago_worker, worker: s.worker_email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Cada parte ve solo los pagos que le incumben: el cliente los suyos, el
// aseador los de los servicios que atendio. Antes devolvia la tabla entera,
// con los montos y los tokens de Flow de todo el mundo.
app.get('/api/pagos', verificarToken, async (req, res) => {
  try {
    const r = req.usuario.rol === 'worker'
      ? await pool.query('SELECT p.* FROM pagos p JOIN servicios s ON s.id=p.servicio_id WHERE s.worker_id=$1 ORDER BY p.id DESC', [req.usuario.id])
      : await pool.query('SELECT * FROM pagos WHERE cliente_id=$1 ORDER BY id DESC', [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── RESTO DE RUTAS ───────────────────────────────────────────────────────────
// Las calificaciones que el usuario escribio o recibio. Antes era publica y
// sin sesion: exponia los comentarios de todos.
app.get('/api/calificaciones', verificarToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM calificaciones WHERE autor_id=$1 OR destinatario_id=$1 ORDER BY id DESC', [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notificaciones', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notificaciones WHERE usuario_id=$1 ORDER BY id DESC', [req.usuario.id]); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// El aseador declara bajo que modalidad presta el servicio. Hoy la unica
// aceptada es prestador independiente con boleta de honorarios: mientras no
// se defina la relacion juridica, la plataforma no puede ofrecer otra.
app.post('/api/worker/perfil', verificarToken, exigirRol('worker'), async (req, res) => {
  try {
    const { modalidad = 'independiente', acepta_boleta = false, comuna, experiencia } = req.body;
    if (modalidad !== 'independiente' || acepta_boleta !== true) {
      return res.status(400).json({ error: 'Debes aceptar trabajar como prestador independiente y emitir boleta de honorarios' });
    }
    const r = await pool.query(
      `UPDATE usuarios
       SET modalidad=$1, acepta_boleta=true, comuna=$2, experiencia=$3, perfil_pago_completo=true
       WHERE id=$4 RETURNING perfil_pago_completo`,
      [modalidad, comuna || '', experiencia || '', req.usuario.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });
    res.json({ ok: true, perfil_pago_completo: r.rows[0].perfil_pago_completo });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/push-token', verificarToken, exigirRol('worker'), async (req, res) => {
  try {
    const { push_token } = req.body;
    if (!push_token) return res.status(400).json({ error: 'Falta push_token' });
    await pool.query('UPDATE usuarios SET push_token=$1 WHERE id=$2', [push_token, req.usuario.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/disponibilidad', async (req, res) => {
  try { const r = await pool.query("SELECT d.*,u.nombre as worker_nombre,u.calificacion_promedio FROM disponibilidad d JOIN usuarios u ON d.worker_id=u.id WHERE u.activo=true ORDER BY d.id DESC"); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Fotos de los servicios en que el usuario participa. Son imagenes del
// interior de casas ajenas: antes cualquier sesion las veia todas.
app.get('/api/fotos_servicio', verificarToken, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.* FROM fotos_servicio f JOIN servicios s ON s.id=f.servicio_id
       WHERE s.cliente_id=$1 OR s.worker_id=$1 ORDER BY f.id DESC`, [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ─── WORKER RUTAS ────────────────────────────────────────────────────────────
app.get('/api/worker/disponibles', verificarToken, exigirRol('worker'), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM servicios WHERE estado='buscando_worker' ORDER BY id DESC"
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/worker/aceptar/:id', verificarToken, exigirRol('worker'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM servicios WHERE id=$1', [req.params.id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.estado !== 'buscando_worker') return res.status(400).json({ error: 'Servicio no disponible' });
    await pool.query(
      "UPDATE servicios SET estado='en_proceso', worker_id=$1 WHERE id=$2",
      [req.usuario.id, req.params.id]
    );
    res.json({ mensaje: 'Trabajo aceptado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ruta no encontrada: responder JSON, no el HTML por defecto de Express, para
// que el cliente siempre pueda parsear la respuesta.
app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` }));

// Cualquier error que llegue hasta aca tambien sale como JSON. Sin esto
// Express responde su pagina HTML por defecto, que incluye el stack trace con
// las rutas absolutas del servidor: el cliente no puede parsearla y ademas
// expone la estructura interna.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  // body-parser marca asi un JSON malformado en el cuerpo del request.
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud no es JSON válido' });
  }
  console.error('[aseada] error no controlado:', error.stack || error.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;

// Solo al ejecutar `node server.js` directamente. Bajo Vercel el archivo se
// importa como modulo y la plataforma maneja el ciclo de vida del request,
// asi que abrir un puerto ahi no corresponde.
if (require.main === module) {
  prepararEsquema()
    .catch((error) => console.warn('No se pudo actualizar el esquema automáticamente:', error.message))
    .finally(() => app.listen(PORT, '0.0.0.0', () => console.log('Aseada v3.0 PostgreSQL + Flow corriendo en puerto ' + PORT)));
}
