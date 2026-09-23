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
const pagosTrabajador = require('./pagos-trabajador');
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

// Donde vive la app web, para devolver ahi al cliente despues de pagar. Si no
// esta definida se usa el deep link aseada://, que solo sirve en movil.
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

const FALTA_PARA_FLOW = [
  !FLOW_API_KEY && 'FLOW_API_KEY',
  !FLOW_SECRET && 'FLOW_SECRET_KEY',
  !PUBLIC_URL && 'PUBLIC_URL'
].filter(Boolean);
const FLOW_CONFIGURADO = FALTA_PARA_FLOW.length === 0;
if (!FLOW_CONFIGURADO) console.warn(`[aseada] faltan ${FALTA_PARA_FLOW.join(', ')}: las rutas de pago responderan 503.`);

// Si Aseada retiene el 15,25% de honorarios y lo paga al SII (transfiere el
// liquido) o si el trabajador declara por su cuenta (transfiere el bruto).
// Depende de si Aseada contrata al trabajador o solo intermedia, algo que
// debe definir un contador. Mientras tanto, false: coincide con los precios
// actuales, que cobran IVA solo sobre la comision.
const ASEADA_RETIENE_HONORARIOS = process.env.ASEADA_RETIENE_HONORARIOS === 'true';

// Protege el proceso diario de liberacion. Vercel lo manda como
// "Authorization: Bearer <CRON_SECRET>" en cada ejecucion programada.
const CRON_SECRET = process.env.CRON_SECRET;

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
// Tabla revisada (2026-09): sube el pago base al trabajador ~12% en los 3
// tramos de lista y sube la comision de Aseada para que ambos ganen mas,
// manteniendo el precio final bajo el promedio de mercado (ver desglose
// entregado al dueño). Los tramos 80 y 999, sin precio publicitado, quedan
// igual.
const PRECIOS = {
  50:  { sin_materiales: 28000, con_materiales: 33000 },
  80:  { sin_materiales: 35000, con_materiales: 40000 },
  120: { sin_materiales: 50000, con_materiales: 55000 },
  200: { sin_materiales: 68000, con_materiales: 73000 },
  999: { sin_materiales: 80000, con_materiales: 85000 }
};
const HORAS_EXTRA = { 1: 8000, 2: 15000, 3: 21000 };
const COMISION = 0.20;
const IVA = 0.19;
const RETENCION_HONORARIOS = 0.1525;
// Comision de lista: para los paquetes que se publicitan (sin materiales, sin horas
// extra / tramo base de fumigacion), la comision se fija para que el precio final
// termine en :990 y capture el margen revisado, sin tocar lo que recibe el
// trabajador. Fuera de estos paquetes (con materiales, horas extra, tramos
// superiores) se sigue usando la formula dinamica de COMISION/IVA.
// El tramo 50 (Depto pequeño) quedo con muy poco colchon frente a un CPA que
// varia: con comision=5874 y CPA=5000, un CPA real de 6000 ya deja perdida.
// Se sube a 10076 para que la utilidad aguante un CPA bastante mas alto que
// la estimacion antes de partir en rojo.
const COMISION_LISTA_ASEO = { 50: 10076, 120: 10916, 200: 14277 };
const COMISION_LISTA_FUMIGACION = { insectos: { 50: 15958 }, roedores: { 50: 15958 } };
const PRECIOS_FUMIGACION = {
  insectos: { 50: 46000, 100: 49900, 200: 64900, 999: 84900 },
  roedores: { 50: 56000, 100: 59900, 200: 79900, 999: 99900 },
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
    const comisionLista = COMISION_LISTA_FUMIGACION[tipo_plaga]?.[limite];
    const comision = comisionLista ?? Math.round(precio_base * COMISION);
    const iva = Math.round(comision * IVA);
    const retencion_honorarios = Math.round(precio_base * RETENCION_HONORARIOS);
    return { precio_base, extra: 0, subtotal: precio_base, comision, iva, total_cliente: precio_base + comision + iva, worker_recibe: precio_base, retencion_honorarios, worker_liquido_estimado: precio_base - retencion_honorarios, horas_incluidas: null, tipo_servicio, tipo_plaga };
  }
  let precio_base = 0;
  let limiteUsado = null;
  for (const limite of Object.keys(PRECIOS).map(Number).sort((a,b)=>a-b)) {
    if (metros <= limite) { precio_base = PRECIOS[limite][con_materiales ? 'con_materiales' : 'sin_materiales']; limiteUsado = limite; break; }
  }
  const extra = HORAS_EXTRA[horas_extra] || 0;
  const subtotal = precio_base + extra;
  const comisionLista = (!con_materiales && !extra) ? COMISION_LISTA_ASEO[limiteUsado] : undefined;
  const comision = comisionLista ?? Math.round(subtotal * COMISION);
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

const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CL');

function fechaChile(fecha) {
  return new Date(fecha).toLocaleString('es-CL', {
    timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Deja una notificacion en la app y, si el usuario registro su telefono,
 * la manda como push. Nunca lanza: un aviso que falla no debe tumbar la
 * operacion que lo origino (un pago, una confirmacion).
 */
async function notificar(usuarioIds, tipo, titulo, mensaje, datos = {}) {
  const ids = [].concat(usuarioIds).filter(Boolean);
  if (ids.length === 0) return;
  try {
    await pool.query(
      `INSERT INTO notificaciones(usuario_id, tipo, titulo, mensaje)
       SELECT id, $2, $3, $4 FROM usuarios WHERE id = ANY($1::int[])`, [ids, tipo, titulo, mensaje]);
    const { rows } = await pool.query('SELECT push_token FROM usuarios WHERE id = ANY($1::int[]) AND push_token IS NOT NULL', [ids]);
    await Promise.all(rows.map(({ push_token }) => axios.post('https://exp.host/--/api/v2/push/send',
      { to: push_token, title: titulo, body: mensaje, sound: 'default', data: { tipo, ...datos } }, { timeout: 10000 })
      .catch((error) => console.warn('No se pudo enviar push:', error.message))));
  } catch (error) {
    console.warn(`[aseada] no se pudo notificar (${tipo}):`, error.message);
  }
}

async function idsAdmins() {
  const { rows } = await pool.query("SELECT id FROM usuarios WHERE rol='admin' AND activo=true");
  return rows.map((r) => r.id);
}

/** Aviso al trabajador de que su pago quedo liberado, con la fecha real. */
async function avisarPagoLiberado({ servicio, transferencia }) {
  if (!transferencia) return;
  const cuando = transferencia.estado === 'por_transferir'
    ? 'Te lo transferimos dentro de las próximas 24 horas.'
    : `Flow nos deposita el ${fechaChile(transferencia.disponible_desde)}; te lo transferimos dentro de las 24 horas siguientes.`;
  await notificar(servicio.worker_id, 'pago_liberado', 'Tu pago fue liberado',
    `El servicio #${servicio.id} quedó confirmado. Recibirás ${pesos(transferencia.monto_a_transferir)}. ${cuando}`,
    { servicio_id: servicio.id });
}

// ─── FLOW HELPERS ────────────────────────────────────────────────────────────
function flowSign(params) {
  const keys = Object.keys(params).sort();
  let msg = '';
  for (const k of keys) msg += k + params[k];
  return crypto.createHmac('sha256', FLOW_SECRET).update(msg).digest('hex');
}

// Flow explica sus rechazos en el cuerpo ({ code, message }), pero axios los
// reduce a "Request failed with status code 400". Sin esto un cliente con el
// email mal escrito no sabia que corregir, y en los logs no quedaba el motivo.
class FlowError extends Error {
  constructor(error) {
    const cuerpo = error.response?.data;
    super(cuerpo?.message || error.message);
    this.name = 'FlowError';
    this.codigoFlow = cuerpo?.code;
    // 4xx de Flow = el dato que mandamos esta mal (lo puede corregir quien
    // paga). Cualquier otra cosa = Flow fallo o no respondio.
    const status = error.response?.status;
    this.esDelCliente = status >= 400 && status < 500;
  }
}

async function llamarFlow(peticion) {
  try { return (await peticion()).data; }
  catch (error) { throw new FlowError(error); }
}

async function flowPost(endpoint, params) {
  params.apiKey = FLOW_API_KEY;
  params.s = flowSign(params);
  const form = new URLSearchParams(params);
  return llamarFlow(() => axios.post(`${FLOW_API_URL}${endpoint}`, form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 }));
}

async function flowGet(endpoint, params) {
  params.apiKey = FLOW_API_KEY;
  params.s = flowSign(params);
  return llamarFlow(() => axios.get(`${FLOW_API_URL}${endpoint}`, { params, timeout: 20000 }));
}

/** Respuesta HTTP para un error al hablar con Flow. */
function responderErrorFlow(res, error) {
  if (!(error instanceof FlowError)) return res.status(500).json({ error: error.message });
  console.error(`[aseada] Flow rechazo la operacion (codigo ${error.codigoFlow}):`, error.message);
  // El email invalido es el rechazo mas probable y el unico que el cliente
  // resuelve solo: se lo decimos en su idioma.
  if (error.codigoFlow === 1620) {
    return res.status(400).json({ error: 'Flow no acepta el email de tu cuenta para pagar. Revisa que este bien escrito.' });
  }
  return error.esDelCliente
    ? res.status(400).json({ error: `Flow rechazo el pago: ${error.message}` })
    : res.status(502).json({ error: 'No pudimos comunicarnos con Flow. Intenta de nuevo en unos minutos.' });
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
      // Solo trabajos ya pagados: un servicio en pendiente_pago puede no
      // pagarse nunca, y el trabajador no debe ir a hacer algo sin cobro asegurado.
      ? "SELECT * FROM servicios WHERE estado = 'buscando_worker' OR worker_id=$1 ORDER BY id DESC"
      : 'SELECT * FROM servicios WHERE cliente_id=$1 ORDER BY id DESC';
    const r = await pool.query(query, [req.usuario.id]);
    res.json(r.rows);
  }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mis-servicios', verificarToken, async (req, res) => {
  try {
    const col = req.usuario.rol === 'worker' ? 'worker_id' : 'cliente_id';
    // El trabajador ve tambien en que va su pago de cada servicio.
    const r = await pool.query(
      `SELECT s.*, t.estado AS pago_trabajador_estado, t.monto_a_transferir AS pago_trabajador_monto,
              t.disponible_desde AS pago_trabajador_disponible, t.transferido_en AS pago_trabajador_transferido_en
       FROM servicios s LEFT JOIN transferencias_trabajador t ON t.servicio_id = s.id AND s.worker_id = $1
       WHERE s.${col}=$1 ORDER BY s.id DESC`, [req.usuario.id]);
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
    await notificar(s.cliente_id, 'servicio_terminado', '¿Quedó todo bien?',
      `El trabajador marcó el servicio #${s.id} como terminado. Confírmalo o repórtanos un problema en la app. Si no nos dices nada, lo daremos por conforme en ${pagosTrabajador.HORAS_REVISION} horas.`,
      { servicio_id: s.id });
    res.json({ mensaje: `Servicio terminado. El cliente tiene ${pagosTrabajador.HORAS_REVISION} horas para confirmarlo; después se libera tu pago.` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// El cliente confirma que el servicio quedo bien y libera el pago.
async function confirmarServicio(req, res) {
  try {
    const servicioId = Number(req.params.id || req.params.servicio_id);
    const { rows: [s] } = await pool.query('SELECT cliente_id, estado FROM servicios WHERE id=$1', [servicioId]);
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.cliente_id !== req.usuario.id) return res.status(403).json({ error: 'Solo el cliente del servicio puede confirmarlo' });
    if (s.estado !== 'completado') return res.status(400).json({ error: 'El trabajador todavía no marcó el servicio como terminado' });

    const r = await pagosTrabajador.liberarServicio(pool, servicioId, { origen: 'cliente', aseadaRetiene: ASEADA_RETIENE_HONORARIOS });
    if (!r) return res.status(409).json({ error: 'El pago de este servicio ya fue liberado' });
    await avisarPagoLiberado(r);
    res.json({ mensaje: '¡Gracias! Confirmaste el servicio y liberamos el pago al trabajador.', servicio: r.servicio });
  } catch(e) { res.status(500).json({ error: e.message }); }
}
app.post('/api/servicios/:id/confirmar', verificarToken, exigirRol('cliente'), confirmarServicio);

// El cliente reporta un problema: el pago queda retenido hasta resolverlo.
app.post('/api/servicios/:id/reclamo', verificarToken, exigirRol('cliente'), async (req, res) => {
  try {
    const r = await pagosTrabajador.reclamar(pool, Number(req.params.id), req.usuario.id,
      { motivo: req.body?.motivo, detalle: req.body?.detalle });
    if (r.error) return res.status(r.status).json({ error: r.error });
    await notificar(await idsAdmins(), 'reclamo', `Reclamo en el servicio #${r.servicio.id}`,
      `Motivo: ${r.servicio.reclamo_motivo}. ${r.servicio.reclamo_detalle || ''}`.trim(), { servicio_id: r.servicio.id });
    if (r.servicio.worker_id) {
      await notificar(r.servicio.worker_id, 'reclamo', 'El cliente reportó un problema',
        `El pago del servicio #${r.servicio.id} queda retenido mientras lo revisamos. Te contactaremos.`, { servicio_id: r.servicio.id });
    }
    res.json({ mensaje: 'Recibimos tu reclamo. Tu pago queda retenido y te contactaremos para resolverlo; si el servicio no se realizó, te devolvemos el dinero.', servicio: r.servicio });
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
  } catch(e) { responderErrorFlow(res, e); }
});

app.post('/pagos/flow/confirmacion', exigirFlow, async (req, res) => {
  try {
    const { token } = req.body;
    const flowData = await flowGet('/payment/getStatus', { token });
    if (flowData.status === 2) {
      // Solo la primera confirmacion cambia el estado: Flow puede reintentar
      // el aviso y no debe repetir notificaciones ni volver atras un servicio.
      const { rows: [pago] } = await pool.query(
        "UPDATE pagos SET estado='pagado', pagado_en=NOW() WHERE flow_token=$1 AND estado='pendiente' RETURNING *", [token]);
      // Cuanto cobro Flow, cuanto deposita y cuando: sin esto no se sabria
      // cuando la plata esta de verdad en la cuenta de Aseada.
      await pagosTrabajador.registrarDatosFlow(pool, token, flowData.paymentData);
      if (pago) {
        await pool.query("UPDATE servicios SET estado='buscando_worker' WHERE id=$1 AND estado='pendiente_pago'", [pago.servicio_id]);
        await notificar(pago.cliente_id, 'pago_recibido', 'Recibimos tu pago',
          `Tu pago de ${pesos(pago.monto_total)} quedó retenido por Aseada. El trabajador solo lo recibe cuando confirmes que el servicio se hizo; si no se realiza o hay un problema, te devolvemos el dinero.`,
          { servicio_id: pago.servicio_id });
      }
    } else if (flowData.status === 3) {
      await pool.query("UPDATE pagos SET estado='rechazado' WHERE flow_token=$1", [token]);
    }
    res.json({ ok: true });
  } catch(e) { responderErrorFlow(res, e); }
});

// Adonde vuelve el usuario despues de pagar. Flow trae de vuelta al
// navegador, asi que en web hay que mandarlo a una URL http: el esquema
// aseada:// solo lo entiende la app instalada, y en un navegador deja al
// cliente en una pantalla muerta justo despues de haber pagado.
function destinoTrasPago(resultado, token) {
  const query = `?pago=${resultado}&token=${encodeURIComponent(token || '')}`;
  return APP_URL ? `${APP_URL}/cliente/historial${query}` : `aseada://pago-${resultado}${query}`;
}

// Flow devuelve al navegador con un POST que trae el token en el cuerpo, no
// con un GET: con solo app.get, el cliente terminaba en un 404 justo despues
// de pagar. Se aceptan ambos para no depender de como llegue.
app.all('/pagos/flow/retorno', exigirFlow, async (req, res) => {
  try {
    const token = req.body?.token || req.query.token;
    const flowData = await flowGet('/payment/getStatus', { token });
    // status 2 = pagado, segun la API de Flow.
    res.redirect(destinoTrasPago(flowData.status === 2 ? 'exitoso' : 'rechazado', token));
  } catch (error) {
    console.error('[aseada] no se pudo verificar el pago al volver de Flow:', error.message);
    res.redirect(destinoTrasPago('rechazado', req.body?.token || req.query.token));
  }
});

// Ruta anterior a /api/servicios/:id/confirmar. Se mantiene por
// compatibilidad, pero ahora pasa por la misma liberacion: solo el cliente
// que pago, y la transferencia al trabajador espera el deposito de Flow.
app.post('/api/pagos/liberar/:servicio_id', verificarToken, exigirRol('cliente'), confirmarServicio);

// ─── PROCESO DIARIO ──────────────────────────────────────────────────────────
// Libera los servicios que el cliente no confirmo ni reclamo en 24 h, y marca
// como listas para transferir las que Flow ya deposito. Lo ejecuta Vercel
// Cron (vercel.json); tambien corre cada vez que un administrador abre la
// lista de transferencias, para que nunca vea datos atrasados.
async function procesoDiario() {
  const liberados = await pagosTrabajador.liberarVencidos(pool, { aseadaRetiene: ASEADA_RETIENE_HONORARIOS });
  for (const r of liberados) await avisarPagoLiberado(r);
  const disponibles = await pagosTrabajador.marcarFondosDisponibles(pool);
  if (disponibles.length > 0) {
    const total = disponibles.reduce((suma, t) => suma + t.monto_a_transferir, 0);
    await notificar(await idsAdmins(), 'transferencias_pendientes', 'Hay pagos listos para transferir',
      `${disponibles.length} pago(s) a trabajadores por ${pesos(total)}: Flow ya depositó ese dinero.`);
  }
  return { liberados: liberados.length, disponibles: disponibles.length };
}

app.get('/api/cron/diario', async (req, res) => {
  // Sin secreto configurado no se ejecuta: el proceso mueve estados de pago.
  if (!CRON_SECRET) return res.status(503).json({ error: 'Falta configurar CRON_SECRET en el servidor.' });
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'No autorizado' });
  try { res.json(await procesoDiario()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ADMINISTRACION ──────────────────────────────────────────────────────────
app.get('/api/admin/transferencias', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    await procesoDiario();
    res.json(await pagosTrabajador.listarPendientes(pool));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/transferencias/:id/transferida', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    const t = await pagosTrabajador.marcarTransferida(pool, Number(req.params.id), { referencia: req.body?.referencia });
    if (!t) return res.status(400).json({ error: 'La transferencia no existe, ya se marcó, o Flow todavía no deposita ese dinero' });
    await notificar(t.worker_id, 'pago_transferido', 'Te transferimos tu pago',
      `Te transferimos ${pesos(t.monto_a_transferir)} por el servicio #${t.servicio_id}.`, { servicio_id: t.servicio_id });
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/reclamos', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, c.nombre AS cliente_nombre, c.email AS cliente_email, c.telefono AS cliente_telefono,
              w.nombre AS worker_nombre, w.telefono AS worker_telefono, p.flow_order
       FROM servicios s JOIN usuarios c ON c.id=s.cliente_id LEFT JOIN usuarios w ON w.id=s.worker_id
       LEFT JOIN pagos p ON p.servicio_id=s.id AND p.estado='pagado'
       WHERE s.estado='en_reclamo' ORDER BY s.reclamo_en`);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/servicios/:id/resolver', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    const accion = req.body?.accion;
    const r = await pagosTrabajador.resolverReclamo(pool, Number(req.params.id), accion, { aseadaRetiene: ASEADA_RETIENE_HONORARIOS });
    if (r.error) return res.status(r.status).json({ error: r.error });
    const s = r.resultado.servicio;
    if (accion === 'liberar') {
      await avisarPagoLiberado(r.resultado);
      await notificar(s.cliente_id, 'reclamo_resuelto', 'Revisamos tu reclamo',
        `Resolvimos el reclamo del servicio #${s.id} y liberamos el pago al trabajador.`, { servicio_id: s.id });
    } else {
      await notificar(s.cliente_id, 'reembolso', 'Te devolvemos tu dinero',
        `Aprobamos la devolución de ${pesos(r.resultado.pago.monto_total)} por el servicio #${s.id}. Flow la procesa en los próximos días.`, { servicio_id: s.id });
    }
    res.json({
      ...r.resultado,
      // La devolucion no se hace sola: hay que ejecutarla en el panel de Flow.
      ...(accion === 'reembolsar' && { pendiente: `Haz la devolución en el panel de Flow: orden ${r.resultado.pago.flow_order}.` })
    });
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
    const { modalidad = 'independiente', acepta_boleta = false, comuna, experiencia, rut, banco, tipo_cuenta, numero_cuenta } = req.body;
    if (modalidad !== 'independiente' || acepta_boleta !== true) {
      return res.status(400).json({ error: 'Debes aceptar trabajar como prestador independiente y emitir boleta de honorarios' });
    }
    // Datos para transferirle. Son opcionales al guardar el perfil, pero sin
    // ellos no se le puede pagar: la lista de transferencias lo marca.
    const limpio = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    if (tipo_cuenta && !['corriente', 'vista', 'ahorro'].includes(tipo_cuenta)) {
      return res.status(400).json({ error: 'El tipo de cuenta debe ser corriente, vista o ahorro' });
    }
    if (limpio(rut) && !/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(limpio(rut))) {
      return res.status(400).json({ error: 'El RUT debe tener el formato 12.345.678-9' });
    }
    const r = await pool.query(
      `UPDATE usuarios
       SET modalidad=$1, acepta_boleta=true, comuna=$2, experiencia=$3, perfil_pago_completo=true,
           rut=COALESCE($5, rut), banco=COALESCE($6, banco), tipo_cuenta=COALESCE($7, tipo_cuenta), numero_cuenta=COALESCE($8, numero_cuenta)
       WHERE id=$4 RETURNING perfil_pago_completo`,
      [modalidad, comuna || '', experiencia || '', req.usuario.id, limpio(rut), limpio(banco), tipo_cuenta || null, limpio(numero_cuenta)]
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
// La tarifa es lo que ve el cliente antes de contratar y lo que determina
// cuanto recibe el aseador, asi que se expone aparte para poder probarla sin
// levantar el servidor ni tocar la base.
module.exports.calcularPrecio = calcularPrecio;
// Expuestos para probar como se traducen los rechazos de Flow.
module.exports.FlowError = FlowError;
module.exports.responderErrorFlow = responderErrorFlow;

// Solo al ejecutar `node server.js` directamente. Bajo Vercel el archivo se
// importa como modulo y la plataforma maneja el ciclo de vida del request,
// asi que abrir un puerto ahi no corresponde.
if (require.main === module) {
  prepararEsquema()
    .catch((error) => console.warn('No se pudo actualizar el esquema automáticamente:', error.message))
    .finally(() => app.listen(PORT, '0.0.0.0', () => console.log('Aseada v3.0 PostgreSQL + Flow corriendo en puerto ' + PORT)));
}
