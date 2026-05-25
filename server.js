const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'aseada_secret_2024';
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET = process.env.FLOW_SECRET_KEY;
const FLOW_API_URL = process.env.FLOW_API_URL || 'https://www.flow.cl/api';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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

function calcularPrecio(metros, horas_extra, con_materiales) {
  let precio_base = 0;
  for (const limite of Object.keys(PRECIOS).map(Number).sort((a,b)=>a-b)) {
    if (metros <= limite) { precio_base = PRECIOS[limite][con_materiales ? 'con_materiales' : 'sin_materiales']; break; }
  }
  const extra = HORAS_EXTRA[horas_extra] || 0;
  const subtotal = precio_base + extra;
  const comision = Math.round(subtotal * COMISION);
  const total_cliente = subtotal + comision;
  const worker_recibe = subtotal;
  return { precio_base, extra, subtotal, comision, total_cliente, worker_recibe };
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

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ mensaje: 'Aseada API funcionando', version: '3.0.0', db: 'PostgreSQL' }));

// ─── CALCULAR PRECIO (público) ───────────────────────────────────────────────
app.post('/api/calcular-precio', (req, res) => {
  const { metros, horas_extra = 0, con_materiales = false } = req.body;
  if (!metros) return res.status(400).json({ error: 'Faltan metros cuadrados' });
  const precio = calcularPrecio(metros, horas_extra, con_materiales);
  res.json(precio);
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password, rol, telefono } = req.body;
    if (!nombre||!email||!password||!rol) return res.status(400).json({ error: 'Faltan campos' });
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
app.get('/api/usuarios', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT id,nombre,email,rol,telefono,foto_url,calificacion_promedio,total_servicios,activo FROM usuarios'); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/workers', async (req, res) => {
  try { const r = await pool.query("SELECT id,nombre,email,telefono,foto_url,calificacion_promedio,total_servicios,activo FROM usuarios WHERE rol='worker' AND activo=true ORDER BY calificacion_promedio DESC"); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── SERVICIOS ───────────────────────────────────────────────────────────────
app.post('/api/servicios', verificarToken, async (req, res) => {
  try {
    const { metros, horas_extra = 0, con_materiales = false, direccion, fecha_servicio } = req.body;
    if (!metros || !direccion) return res.status(400).json({ error: 'Faltan campos' });
    const precio = calcularPrecio(metros, horas_extra, con_materiales);
    const r = await pool.query(
      `INSERT INTO servicios(cliente_id,direccion,fecha_servicio,metros,horas_extra,con_materiales,precio_base,horas_extra_precio,subtotal,comision,total_cliente,worker_recibe,estado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendiente_pago') RETURNING *`,
      [req.usuario.id, direccion, fecha_servicio, metros, horas_extra, con_materiales,
       precio.precio_base, precio.extra, precio.subtotal, precio.comision, precio.total_cliente, precio.worker_recibe]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/servicios', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM servicios ORDER BY id DESC'); res.json(r.rows); }
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
    if (s.estado !== 'en_proceso') return res.status(400).json({ error: 'El servicio no está en proceso' });
    await pool.query("UPDATE servicios SET estado='completado', completado_en=NOW() WHERE id=$1", [req.params.id]);
    res.json({ mensaje: 'Servicio completado — pago será liberado al worker' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── FLOW PAGOS ───────────────────────────────────────────────────────────────
app.post('/api/pagos/crear', verificarToken, async (req, res) => {
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
      urlConfirmation: `https://aseada-backend-production.up.railway.app/pagos/flow/confirmacion`,
      urlReturn: `https://aseada-backend-production.up.railway.app/pagos/flow/retorno`
    });
    await pool.query(
      'INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_token,flow_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [servicio_id, req.usuario.id, s.total_cliente, s.comision, s.worker_recibe, 'pendiente', flowData.token, comercialId]
    );
    res.json({ url_pago: `${flowData.url}?token=${flowData.token}`, token: flowData.token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/pagos/flow/confirmacion', async (req, res) => {
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

app.get('/pagos/flow/retorno', async (req, res) => {
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

app.post('/api/pagos/liberar/:servicio_id', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT s.*, p.id as pago_id, p.pago_worker, u.email as worker_email FROM servicios s JOIN pagos p ON p.servicio_id=s.id JOIN usuarios u ON u.id=s.worker_id WHERE s.id=$1', [req.params.servicio_id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.estado !== 'completado') return res.status(400).json({ error: 'El servicio no está completado' });
    await pool.query("UPDATE pagos SET estado='liberado', liberado_en=NOW() WHERE id=$1", [s.pago_id]);
    await pool.query("UPDATE servicios SET estado='pagado' WHERE id=$1", [req.params.servicio_id]);
    await pool.query('UPDATE usuarios SET total_servicios=total_servicios+1 WHERE id=$1', [s.worker_id]);
    res.json({ mensaje: 'Pago liberado al worker', monto: s.pago_worker, worker: s.worker_email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pagos', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM pagos ORDER BY id DESC'); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── RESTO DE RUTAS ───────────────────────────────────────────────────────────
app.get('/api/calificaciones', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM calificaciones ORDER BY id DESC'); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notificaciones', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notificaciones WHERE usuario_id=$1 ORDER BY id DESC', [req.usuario.id]); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/disponibilidad', async (req, res) => {
  try { const r = await pool.query("SELECT d.*,u.nombre as worker_nombre,u.calificacion_promedio FROM disponibilidad d JOIN usuarios u ON d.worker_id=u.id WHERE u.activo=true ORDER BY d.id DESC"); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fotos_servicio', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM fotos_servicio ORDER BY id DESC'); res.json(r.rows); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log('Aseada v3.0 PostgreSQL + Flow corriendo en puerto ' + PORT));
