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
const salud = require('./salud');
const { sslPostgres, avisarSiNoVerifica } = require('./ssl-postgres');
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
// Flow entrega la URL de pago solo al crear la orden. Para devolver una orden
// ya creada (y no cobrar dos veces) hay que reconstruirla: es siempre el
// mismo endpoint del ambiente al que apunta FLOW_API_URL, con el token.
const FLOW_URL_PAGO = `${FLOW_API_URL.replace(/\/api\/?$/, '')}/app/web/pay.php`;
const urlDePago = (token) => `${FLOW_URL_PAGO}?token=${token}`;
// Cuanto vive una orden de Flow. Pasado ese rato, una orden que sigue
// 'pendiente' en nuestra base ya no se va a pagar nunca: si el cliente
// hubiera pagado, la confirmacion habria llegado hace rato. Se usa para no
// dejar al cliente pegado con un link muerto cuando Flow no nos contesta.
const MINUTOS_ORDEN_FLOW = 90;

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
// `let` y no `const` porque las pruebas lo reemplazan por un PostgreSQL en
// memoria (ver usarPool al final del archivo): las rutas del dinero se
// prueban contra una base real, que es la unica que hace cumplir los CHECK y
// los indices unicos.
// Neon presenta un certificado valido, asi que el servidor se verifica de
// verdad. Con rejectUnauthorized en false cualquiera que se meta en el camino
// puede presentar el suyo y leer -- o cambiar -- todo lo que viaja a la base,
// contrasenas y datos de los clientes incluidos.
// DB_SSL_NO_VERIFY=true es la marcha atras en un solo paso por si algun
// ambiente usa un certificado propio: un fallo aca deja sin base a TODAS las
// rutas, asi que conviene saber como revertirlo antes de necesitarlo.
// La decision vive en ssl-postgres.js porque los scripts de migracion y de
// alta de admin se conectan a la misma base y tienen que seguir la misma
// regla.
avisarSiNoVerifica();

let pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslPostgres(),
  max: EN_SERVERLESS ? 1 : 10,
  idleTimeoutMillis: EN_SERVERLESS ? 10000 : 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', (error) => console.error('[aseada] error inesperado en el pool de Postgres:', error.message));

// Express anuncia "X-Powered-By: Express" en cada respuesta. No es un agujero
// por si solo, pero le regala a quien busca victimas la mitad del trabajo de
// saber contra que framework esta.
app.disable('x-powered-by');

// El CORS estaba en `*`: cualquier sitio podia llamar esta API desde el
// navegador de alguien con la sesion abierta. La lista blanca va en
// CORS_ORIGINS, separada por comas. Si no esta definida se mantiene el
// comportamiento permisivo para no dejar sin frontend al deploy que ya
// esta arriba; el aviso queda en el log para que se defina.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((origen) => origen.trim()).filter(Boolean);
if (CORS_ORIGINS.length === 0) console.warn('[aseada] CORS_ORIGINS no esta definida: la API acepta peticiones de cualquier origen. Definila en produccion.');
app.use(cors({
  origin: CORS_ORIGINS.length === 0 ? true : (origen, responder) => {
    // Sin cabecera Origin no hay peticion cruzada de navegador: es la app
    // movil, curl, o el aviso de pago que manda Flow. CORS no aplica ahi.
    responder(null, !origen || CORS_ORIGINS.includes(origen));
  },
  credentials: true
}));
// Lo que /health necesita saber del ambiente. Se arma aca, donde las
// variables ya estan resueltas, para que el modulo de salud no tenga que
// volver a leer process.env ni repetir la logica de que cuenta como "bien
// configurado".
const CONFIG_PARA_SALUD = {
  faltaParaFlow: FALTA_PARA_FLOW,
  corsRestringido: CORS_ORIGINS.length > 0,
  cronProtegido: Boolean(CRON_SECRET),
  appUrlDefinida: Boolean(APP_URL)
};

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
// El tramo 50 de fumigacion llevaba una comision de 15958 (un 32% del base)
// mientras el resto de los tramos usa el 20% dinamico, y eso daba vuelta la
// escalera: un depto de 40 m2 pagaba $64.990 y una casa de 100 m2 $61.776.
// Estos valores dejan el final en :990, una comision de ~25,5% (antes 32%) y
// la tabla estrictamente creciente. Si el dueno prefiere recuperar ese margen,
// la alternativa es subir los tramos superiores en vez de bajar este -- pero
// la escalera tiene que quedar SIEMPRE creciente: cobrar mas por menos metros
// es lo primero que ve el cliente y no hay forma de explicarlo.
const COMISION_LISTA_FUMIGACION = { insectos: { 50: 11756 }, roedores: { 50: 14277 } };
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
  // Sobre el ultimo tramo (999) no caia en ninguno y el precio quedaba en 0:
  // el cliente veia "Pagar $0" y el aseador un trabajo sin pago. Ahora se cobra
  // el tramo mas alto, igual que ya hacia la tabla de fumigacion.
  const tramosAseo = Object.keys(PRECIOS).map(Number).sort((a, b) => a - b);
  const limiteUsado = tramosAseo.find((limite) => metros <= limite) ?? tramosAseo[tramosAseo.length - 1];
  const precio_base = PRECIOS[limiteUsado][con_materiales ? 'con_materiales' : 'sin_materiales'];
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

// El esquema lo llevan las migraciones (`npm run migrate`, carpeta
// migrations/). Aca vivia un prepararEsquema() que repetia esas mismas
// columnas con ALTER TABLE en cada arranque local: dos fuentes de verdad para
// la misma estructura, y la de aca no dejaba rastro en _migraciones.

// ─── ERRORES ────────────────────────────────────────────────────────────────
/**
 * Un 500 no puede contar por que fallo. El mensaje de Postgres trae nombres de
 * constraints, de columnas y a veces el dato que iba en la consulta: eso le
 * dibuja el esquema completo a cualquiera que sepa provocar el error. Al log
 * del servidor va todo; al cliente, solo que fallo y que reintente.
 *
 * Los 400/403/404 con mensaje en espanol NO pasan por aca: esos si dicen algo
 * util a quien esta del otro lado y son deliberados.
 */
function fallo(res, error, contexto) {
  console.error(`[aseada] fallo al ${contexto}:`, error.stack || error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Algo fallo de nuestro lado. Intenta de nuevo en unos minutos.' });
}

// ─── VALIDACION DE ENTRADA ──────────────────────────────────────────────────
const METROS_MIN = 1;
const METROS_MAX = 1000;
const HORAS_EXTRA_MAX = 3;
const PLAGAS = ['insectos', 'roedores', 'mixto'];
const TIPOS_SERVICIO = ['aseo', 'fumigacion'];

/** Numero entero de verdad, venga como numero o como texto. Si no, null. */
function entero(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor : null;
  if (typeof valor !== 'string' || valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) ? n : null;
}

/**
 * El dia calendario chileno de una fecha, como 'AAAA-MM-DD'.
 * Una fecha sola ("2026-09-23") la lee JavaScript como medianoche UTC, que en
 * Chile todavia es el dia anterior: si viene asi se compara tal cual, o un
 * servicio agendado para hoy se rechazaria por estar "en el pasado".
 */
function diaEnChile(valor) {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return new Date(valor).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

/**
 * Revisa lo que manda el cliente antes de cotizar o de guardar un servicio.
 * Sin esto, 0 o -5 metros cotizaban como el tramo de 50; "abc" o 5000 metros
 * no caian en ningun tramo y devolvian total $0, o sea "Pagar $0" en la app y
 * un trabajo sin pago para el aseador. Y una fumigacion sin plaga reventaba
 * contra el CHECK de la base, devolviendo un 500 con texto de Postgres.
 *
 * Devuelve el mensaje del primer problema, o null si esta todo bien.
 */
function revisarSolicitud({ metros, horas_extra, tipo_servicio, tipo_plaga, fecha_servicio }) {
  const m = entero(metros);
  if (m === null || m < METROS_MIN || m > METROS_MAX) {
    return `Los metros cuadrados deben ser un numero entero entre ${METROS_MIN} y ${METROS_MAX}.`;
  }
  const horas = entero(horas_extra ?? 0);
  if (horas === null || horas < 0 || horas > HORAS_EXTRA_MAX) {
    return `Las horas extra deben ser un numero entero entre 0 y ${HORAS_EXTRA_MAX}.`;
  }
  if (!TIPOS_SERVICIO.includes(tipo_servicio)) {
    return 'Tipo de servicio invalido: debe ser aseo o fumigacion.';
  }
  if (tipo_servicio === 'fumigacion' && !PLAGAS.includes(tipo_plaga)) {
    return `Para fumigar hay que indicar que plaga tratar: ${PLAGAS.join(', ')}.`;
  }
  if (fecha_servicio !== undefined && fecha_servicio !== null && fecha_servicio !== '') {
    const dia = diaEnChile(fecha_servicio);
    if (Number.isNaN(new Date(fecha_servicio).getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return 'La fecha del servicio no es una fecha valida.';
    }
    // Se compara por dia y no por hora: agendar para hoy mas tarde es normal,
    // y el minuto exacto depende del reloj del telefono.
    if (dia < diaEnChile(new Date())) return 'La fecha del servicio no puede ser en el pasado.';
  }
  return null;
}

// ─── CUENTAS ────────────────────────────────────────────────────────────────
const LARGO_MINIMO_PASSWORD = 8;

/**
 * Postgres compara texto con mayusculas y minusculas distintas, asi que
 * c@t.cl y C@T.CL eran dos cuentas: la persona se registraba, escribia su
 * correo de otra forma al entrar y no existia. Se guarda y se busca siempre
 * en minusculas y sin espacios (lo mismo que hace scripts/hacer-admin.mjs).
 */
const emailNormalizado = (valor) => (typeof valor === 'string' ? valor.trim().toLowerCase() : '');

/**
 * El token vive 7 dias y no hay forma de revocarlo: cambiarle el rol o darle
 * de baja a alguien no invalida el que ya tiene en el telefono. Por eso
 * `activo` viaja adentro solo para que la app sepa que pantalla mostrar, y
 * las rutas que de verdad importan lo vuelven a leer de la base.
 */
const firmarToken = (u) => jwt.sign({ id: u.id, email: u.email, rol: u.rol, activo: u.activo }, JWT_SECRET, { expiresIn: '7d' });

// ─── LIMITE DE INTENTOS ─────────────────────────────────────────────────────
// Frena la fuerza bruta contra las rutas de credenciales. Vive en memoria del
// proceso: en serverless cada instancia lleva su propia cuenta, asi que esto
// es una mitigacion parcial -- corta el goteo de un script suelto, no a quien
// reparte los intentos entre muchas instancias. Lo definitivo es un store
// compartido (Redis o una tabla), y eso pide infraestructura que hoy no hay.
const INTENTOS_MAX = 10;
const VENTANA_INTENTOS_MS = 10 * 60 * 1000;
const intentosPorIp = new Map();

// En Vercel la peticion llega por el proxy de la plataforma: req.ip seria
// siempre el del proxy y el limite caeria sobre todos los usuarios juntos.
// Ahi la plataforma reescribe x-forwarded-for, asi que ese es el dato fiable;
// fuera de Vercel se usa el socket, que nadie puede falsear desde afuera.
function ipDelCliente(req) {
  if (EN_SERVERLESS) {
    const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (reenviada) return reenviada;
  }
  return req.ip || req.socket?.remoteAddress || 'desconocida';
}

const limitarIntentos = (req, res, next) => {
  const ahora = Date.now();
  // Limpieza oportunista: sin esto el Map crece con cada IP que pasa alguna
  // vez por el login y no se vacia nunca.
  for (const [clave, marca] of intentosPorIp) {
    if (ahora - marca.desde > VENTANA_INTENTOS_MS) intentosPorIp.delete(clave);
  }
  const ip = ipDelCliente(req);
  const marca = intentosPorIp.get(ip) || { desde: ahora, cuenta: 0 };
  if (ahora - marca.desde > VENTANA_INTENTOS_MS) { marca.desde = ahora; marca.cuenta = 0; }
  marca.cuenta += 1;
  intentosPorIp.set(ip, marca);
  if (marca.cuenta > INTENTOS_MAX) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' });
  }
  next();
};

// ─── DIRECCIONES ────────────────────────────────────────────────────────────
/**
 * La direccion es el dato mas sensible de un servicio a domicilio. Cualquiera
 * que se registrara como aseador veia, al instante y sin revision, donde viven
 * todos los clientes con un servicio pagado.
 *
 * Mientras nadie tomo el trabajo, la direccion no se manda: no se manda vacia,
 * se quita la clave entera para que ninguna pantalla la muestre por descuido.
 * El aseador la recibe cuando el trabajo ya es suyo. `direccion_visible` dice
 * en cual de los dos casos esta cada servicio.
 */
function ocultarDireccionAjena(servicios, workerId) {
  return servicios.map((servicio) => {
    if (servicio.worker_id === workerId) return { ...servicio, direccion_visible: true };
    const { direccion, ...sinDireccion } = servicio;
    return { ...sinDireccion, direccion_visible: false };
  });
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

/**
 * En que va una orden de Flow: 1 pendiente, 2 pagada, 3 rechazada, 4 anulada.
 * Devuelve null si Flow no contesta, para que quien pregunta decida.
 */
async function estadoEnFlow(token) {
  try { return (await flowGet('/payment/getStatus', { token })).status; }
  catch (error) {
    console.error('[aseada] no se pudo consultar el estado de la orden en Flow:', error.message);
    return null;
  }
}

/** Respuesta HTTP para un error al hablar con Flow. */
function responderErrorFlow(res, error) {
  if (!(error instanceof FlowError)) return fallo(res, error, 'procesar el pago');
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

// Un aseador recien registrado nace inactivo y un administrador lo revisa
// antes de dejarlo entrar. Hasta entonces no ve la bolsa de trabajos, que es
// donde estan las direcciones de los clientes, ni puede tomar ninguno.
const EN_REVISION = 'Tu cuenta todavía está en revisión. Te avisamos cuando quede activada.';

// El flag se lee de la base y no del token: el token dura 7 dias, asi que una
// activacion (o una baja) tiene que valer de inmediato, sin volver a entrar.
async function aseadorEstaActivo(usuarioId) {
  const { rows: [u] } = await pool.query("SELECT activo FROM usuarios WHERE id=$1 AND rol='worker'", [usuarioId]);
  return Boolean(u && u.activo === true);
}

const exigirAseadorActivo = async (req, res, next) => {
  try {
    if (await aseadorEstaActivo(req.usuario.id)) return next();
    res.status(403).json({ error: EN_REVISION });
  } catch (error) { fallo(res, error, 'revisar si la cuenta del aseador esta activa'); }
};

// ─── HEALTH ──────────────────────────────────────────────────────────────────
// Esta ruta es la que se mira despues de cada deploy. Devuelve el commit vivo,
// si Neon contesta, si el esquema esta al dia con este codigo y que quedo sin
// configurar. Responde 503 cuando la base no contesta o faltan migraciones:
// un 200 tiene que significar "se puede operar", no "el proceso arranco".
//
// Antes aca habia un texto fijo que decia "Aseada API funcionando" pasara lo
// que pasara. Con eso, verificar un deploy obligaba a entrar a la base de
// produccion con la contraseña a mano.
app.get('/health', async (req, res) => {
  try {
    const { ok, cuerpo } = await salud.estado({ db: pool, config: CONFIG_PARA_SALUD });
    res.status(ok ? 200 : 503).json(cuerpo);
  } catch (error) {
    // Si el propio chequeo falla, el servicio no esta sano: decirlo, no
    // devolver 200 por omision.
    console.error('[aseada] el chequeo de salud fallo:', error.stack || error.message);
    res.status(503).json({ ok: false, servicio: 'aseada-backend', error: 'No se pudo determinar el estado del servicio.' });
  }
});

// La raiz deja de mentir: no dice que todo funciona, dice donde mirar.
app.get('/', (req, res) => res.json({ servicio: 'aseada-backend', salud: '/health' }));

// ─── CALCULAR PRECIO (público) ───────────────────────────────────────────────
app.post('/api/calcular-precio', (req, res) => {
  // `|| {}` porque un POST sin cuerpo deja req.body en undefined y
  // desestructurarlo reventaria antes de poder responder un 400 decente.
  const { metros, horas_extra = 0, con_materiales = false, tipo_servicio = 'aseo', tipo_plaga = 'insectos' } = req.body || {};
  const problema = revisarSolicitud({ metros, horas_extra, tipo_servicio, tipo_plaga });
  if (problema) return res.status(400).json({ error: problema });
  const precio = calcularPrecio(Number(metros), Number(horas_extra), con_materiales, tipo_servicio, tipo_plaga);
  res.json(precio);
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/auth/registro', limitarIntentos, async (req, res) => {
  try {
    const { nombre, password, rol, telefono } = req.body || {};
    const email = emailNormalizado(req.body?.email);
    if (!nombre||!email||!password||!rol) return res.status(400).json({ error: 'Faltan campos' });
    if (!['cliente', 'worker'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    if (String(password).length < LARGO_MINIMO_PASSWORD) {
      return res.status(400).json({ error: `La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.` });
    }
    const ex = await pool.query('SELECT id FROM usuarios WHERE LOWER(email)=$1', [email]);
    if (ex.rows.length > 0) return res.status(400).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    // El aseador nace inactivo: hasta que un administrador lo revisa no ve la
    // bolsa ni las direcciones. Clientes y administradores entran activos, por
    // eso el DEFAULT de la columna sigue siendo TRUE y la decision es de aca.
    const r = await pool.query(
      'INSERT INTO usuarios(nombre,email,password,rol,telefono,calificacion_promedio,total_servicios,activo) VALUES($1,$2,$3,$4,$5,5.0,0,$6) RETURNING id,nombre,email,rol,activo',
      // La columna telefono es NOT NULL DEFAULT '': mandarle null explicito la
      // viola y el registro sin telefono terminaba en un 500. Cadena vacia.
      [nombre, email, hash, rol, telefono || '', rol !== 'worker']
    );
    const token = firmarToken(r.rows[0]);
    const mensaje = r.rows[0].activo
      ? 'Cuenta creada'
      : 'Cuenta creada. Revisamos tu perfil de aseador y te avisamos cuando quede activada.';
    res.json({ mensaje, token, usuario: r.rows[0] });
  } catch(e) { fallo(res, e, 'crear la cuenta'); }
});

app.post('/auth/login', limitarIntentos, async (req, res) => {
  try {
    const { password } = req.body || {};
    const email = emailNormalizado(req.body?.email);
    if (!email || !password) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const r = await pool.query('SELECT * FROM usuarios WHERE LOWER(email)=$1', [email]);
    if (!r.rows[0]) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const valid = await bcrypt.compare(password, r.rows[0].password);
    if (!valid) return res.status(400).json({ error: 'Credenciales incorrectas' });
    const token = firmarToken(r.rows[0]);
    res.json({ token, usuario: { id: r.rows[0].id, nombre: r.rows[0].nombre, email: r.rows[0].email, rol: r.rows[0].rol, telefono: r.rows[0].telefono, calificacion_promedio: r.rows[0].calificacion_promedio, activo: r.rows[0].activo } });
  } catch(e) { fallo(res, e, 'iniciar sesion'); }
});

// ─── USUARIOS ────────────────────────────────────────────────────────────────
// Devuelve la propia cuenta. Antes listaba a todos los usuarios con su email
// y telefono; no existe rol de administrador que justifique ese acceso.
app.get('/api/usuarios', verificarToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,nombre,email,rol,telefono,foto_url,calificacion_promedio,total_servicios,activo FROM usuarios WHERE id=$1', [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { fallo(res, e, 'leer la cuenta'); }
});

// Vitrina publica de aseadores. Sin email ni telefono: son datos de contacto
// personales y esta ruta no pide sesion.
app.get('/api/workers', async (req, res) => {
  try { const r = await pool.query("SELECT id,nombre,foto_url,calificacion_promedio,total_servicios,comuna FROM usuarios WHERE rol='worker' AND activo=true ORDER BY calificacion_promedio DESC"); res.json(r.rows); }
  catch(e) { fallo(res, e, 'listar los aseadores de la vitrina'); }
});

// ─── SERVICIOS ───────────────────────────────────────────────────────────────
app.post('/api/servicios', verificarToken, async (req, res) => {
  try {
    const { metros, horas_extra = 0, con_materiales = false, direccion, fecha_servicio, tipo_servicio = 'aseo', tipo_plaga = null } = req.body || {};
    if (!direccion || String(direccion).trim() === '') return res.status(400).json({ error: 'Falta la dirección del servicio' });
    const problema = revisarSolicitud({ metros, horas_extra, tipo_servicio, tipo_plaga, fecha_servicio });
    if (problema) return res.status(400).json({ error: problema });
    const precio = calcularPrecio(Number(metros), Number(horas_extra), con_materiales, tipo_servicio, tipo_plaga);
    const r = await pool.query(
      `INSERT INTO servicios(cliente_id,direccion,fecha_servicio,metros,horas_extra,con_materiales,precio_base,horas_extra_precio,subtotal,comision,iva,total_cliente,worker_recibe,retencion_honorarios,estado,tipo_servicio,tipo_plaga,horas_incluidas)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pendiente_pago',$15,$16,$17) RETURNING *`,
      [req.usuario.id, direccion, fecha_servicio, metros, horas_extra, con_materiales,
       precio.precio_base, precio.extra, precio.subtotal, precio.comision, precio.iva, precio.total_cliente, precio.worker_recibe, precio.retencion_honorarios, tipo_servicio, tipo_plaga, precio.horas_incluidas]
    );
    await notificarWorkers(r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch(e) { fallo(res, e, 'crear el servicio'); }
});

app.get('/api/servicios', verificarToken, async (req, res) => {
  try {
    if (req.usuario.rol !== 'worker') {
      const r = await pool.query('SELECT * FROM servicios WHERE cliente_id=$1 ORDER BY id DESC', [req.usuario.id]);
      return res.json(r.rows);
    }
    // Solo trabajos ya pagados: un servicio en pendiente_pago puede no
    // pagarse nunca, y el trabajador no debe ir a hacer algo sin cobro asegurado.
    //
    // Al aseador en revision no se le devuelve la bolsa, solo lo suyo (que
    // recien registrado es nada). Aca no se responde 403 como en las rutas de
    // worker: esta misma pantalla es su historial y dejarlo sin historial no
    // protege nada.
    const query = await aseadorEstaActivo(req.usuario.id)
      ? "SELECT * FROM servicios WHERE estado = 'buscando_worker' OR worker_id=$1 ORDER BY id DESC"
      : 'SELECT * FROM servicios WHERE worker_id=$1 ORDER BY id DESC';
    const r = await pool.query(query, [req.usuario.id]);
    res.json(ocultarDireccionAjena(r.rows, req.usuario.id));
  }
  catch(e) { fallo(res, e, 'listar los servicios'); }
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
  } catch(e) { fallo(res, e, 'listar mis servicios'); }
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
    // La condicion del SELECT se repite al escribir. Entre uno y otro el
    // cliente puede apretar "Reportar problema": sin esa condicion el UPDATE
    // pisa el 'en_reclamo', el reclamo desaparece de la lista del admin y a
    // las 24 h se le libera el pago al trabajador igual.
    const { rows: [terminado] } = await pool.query(
      "UPDATE servicios SET estado='completado', completado_en=NOW() WHERE id=$1 AND worker_id=$2 AND estado='en_proceso' RETURNING id",
      [req.params.id, req.usuario.id]);
    if (!terminado) return res.status(409).json({ error: 'El servicio ya no está en proceso; puede que el cliente haya reportado un problema.' });
    // Avisar despues de comprobar que la fila se escribio: si no se escribio,
    // el cliente no tiene por que recibir un "¿quedó todo bien?".
    await notificar(s.cliente_id, 'servicio_terminado', '¿Quedó todo bien?',
      `El trabajador marcó el servicio #${s.id} como terminado. Confírmalo o repórtanos un problema en la app. Si no nos dices nada, lo daremos por conforme en ${pagosTrabajador.HORAS_REVISION} horas.`,
      { servicio_id: s.id });
    res.json({ mensaje: `Servicio terminado. El cliente tiene ${pagosTrabajador.HORAS_REVISION} horas para confirmarlo; después se libera tu pago.` });
  } catch(e) { fallo(res, e, 'dar por terminado el servicio'); }
});

// El cliente confirma que el servicio quedo bien y libera el pago.
async function confirmarServicio(req, res) {
  try {
    const servicioId = Number(req.params.id || req.params.servicio_id);
    const { rows: [s] } = await pool.query('SELECT cliente_id, estado FROM servicios WHERE id=$1', [servicioId]);
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.cliente_id !== req.usuario.id) return res.status(403).json({ error: 'Solo el cliente del servicio puede confirmarlo' });
    if (s.estado !== 'completado') return res.status(400).json({ error: 'El trabajador todavía no marcó el servicio como terminado' });

    // Liberar toca pagos, servicios, transferencias y usuarios: o quedan los
    // cuatro cambios o no queda ninguno. Avisar va despues del COMMIT, porque
    // una notificacion que falla no debe deshacer un pago ya liberado.
    const r = await pagosTrabajador.enTransaccion(pool, (db) =>
      pagosTrabajador.liberarServicio(db, servicioId, { origen: 'cliente', aseadaRetiene: ASEADA_RETIENE_HONORARIOS }));
    if (!r) return res.status(409).json({ error: 'El pago de este servicio ya fue liberado' });
    await avisarPagoLiberado(r);
    res.json({ mensaje: '¡Gracias! Confirmaste el servicio y liberamos el pago al trabajador.', servicio: r.servicio });
  } catch(e) { fallo(res, e, 'confirmar el servicio y liberar el pago'); }
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
  } catch(e) { fallo(res, e, 'registrar el reclamo'); }
});

// ─── FLOW PAGOS ───────────────────────────────────────────────────────────────
app.post('/api/pagos/crear', exigirFlow, verificarToken, async (req, res) => {
  try {
    const { servicio_id } = req.body;
    const { rows } = await pool.query('SELECT * FROM servicios WHERE id=$1 AND cliente_id=$2', [servicio_id, req.usuario.id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.estado !== 'pendiente_pago') return res.status(400).json({ error: 'El servicio no está pendiente de pago' });

    // Tocar "Pagar" dos veces no puede terminar en dos ordenes de Flow: el
    // cliente pagaria dos veces el mismo servicio y la segunda plata queda
    // huerfana (nadie la ve, nadie la devuelve). Si ya hay una orden
    // pendiente y Flow la sigue aceptando, se devuelve esa misma.
    const { rows: [pendiente] } = await pool.query(
      "SELECT flow_token, creado_en FROM pagos WHERE servicio_id=$1 AND estado='pendiente' AND flow_token IS NOT NULL ORDER BY id DESC LIMIT 1",
      [servicio_id]);
    if (pendiente) {
      const vencida = Date.now() - new Date(pendiente.creado_en).getTime() > MINUTOS_ORDEN_FLOW * 60 * 1000;
      const estadoFlow = await estadoEnFlow(pendiente.flow_token);
      if (estadoFlow === 2) {
        // Ya la pago: la confirmacion todavia no llega, pero crear otra orden
        // seria cobrarle de nuevo.
        return res.status(409).json({ error: 'Ya recibimos el pago de este servicio. Dale unos segundos y revisa tu historial.' });
      }
      // 1 = Flow la sigue esperando: ese link sirve, se devuelve el mismo.
      if (estadoFlow === 1) {
        return res.json({ url_pago: urlDePago(pendiente.flow_token), token: pendiente.flow_token, reutilizada: true });
      }
      // Flow no contesto (null) y la orden todavia es reciente: no se sabe si
      // esta pagada. Devolverle el link viejo lo dejaba pegado —si Flow ya no
      // reconoce ese token, cada clic en Pagar entrega el mismo link muerto
      // para siempre—, y crear otra arriesga el cobro doble. Que reintente.
      if (estadoFlow === null && !vencida) {
        return res.status(502).json({ error: 'No pudimos verificar tu orden de pago con Flow. Intenta de nuevo en unos minutos.' });
      }
      // 3 rechazada, 4 anulada, o una orden tan vieja que ya no se va a pagar
      // aunque Flow no lo confirme: esa orden no sirve para pagar, se cierra
      // y recien ahi se crea una nueva. Si contra todo pronostico esa orden
      // igual se cobra, el indice unico de la 003 y el camino 'duplicado' de
      // la confirmacion son la red de abajo.
      await pool.query("UPDATE pagos SET estado='rechazado' WHERE flow_token=$1 AND estado='pendiente'", [pendiente.flow_token]);
    }

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
      let pago = null;
      let duplicado = null;
      try {
        ({ rows: [pago] } = await pool.query(
          "UPDATE pagos SET estado='pagado', pagado_en=NOW() WHERE flow_token=$1 AND estado='pendiente' RETURNING *", [token]));
      } catch (error) {
        // 23505 = el indice unico que deja un solo cobro vivo por servicio
        // (migracion 003). Pasa cuando el cliente alcanzo a pagar dos ordenes
        // del mismo servicio. No es motivo para reventar: este cobro se marca
        // como duplicado y un administrador lo devuelve en el panel de Flow.
        if (error.code !== '23505') throw error;
        ({ rows: [duplicado] } = await pool.query(
          "UPDATE pagos SET estado='duplicado', duplicado_en=NOW() WHERE flow_token=$1 AND estado='pendiente' RETURNING *", [token]));
      }
      // Cuanto cobro Flow, cuanto deposita y cuando: sin esto no se sabria
      // cuando la plata esta de verdad en la cuenta de Aseada.
      await pagosTrabajador.registrarDatosFlow(pool, token, flowData.paymentData);
      if (duplicado) {
        console.error(`[aseada] cobro duplicado del servicio #${duplicado.servicio_id}: hay que devolver la orden ${duplicado.flow_order} en el panel de Flow.`);
        await notificar(await idsAdmins(), 'pago_duplicado', 'Hay que devolver un cobro duplicado',
          `El servicio #${duplicado.servicio_id} se cobró dos veces. Devuelve ${pesos(duplicado.monto_total)} en el panel de Flow: orden ${duplicado.flow_order}.`,
          { servicio_id: duplicado.servicio_id });
        await notificar(duplicado.cliente_id, 'pago_duplicado', 'Te cobramos dos veces',
          `Recibimos dos pagos del servicio #${duplicado.servicio_id}. Te devolvemos ${pesos(duplicado.monto_total)}; Flow procesa la devolución en los próximos días.`,
          { servicio_id: duplicado.servicio_id });
      } else if (pago) {
        await pool.query("UPDATE servicios SET estado='buscando_worker' WHERE id=$1 AND estado='pendiente_pago'", [pago.servicio_id]);
        await notificar(pago.cliente_id, 'pago_recibido', 'Recibimos tu pago',
          `Tu pago de ${pesos(pago.monto_total)} quedó retenido por Aseada. El trabajador solo lo recibe cuando confirmes que el servicio se hizo; si no se realiza o hay un problema, te devolvemos el dinero.`,
          { servicio_id: pago.servicio_id });
      }
    } else if (flowData.status === 3) {
      await pool.query("UPDATE pagos SET estado='rechazado' WHERE flow_token=$1", [token]);
    }
    // Siempre 200: si se responde error, Flow reintenta el aviso para siempre.
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
  catch(e) { fallo(res, e, 'correr el proceso diario'); }
});

// ─── ADMINISTRACION ──────────────────────────────────────────────────────────
// La lista de altas de aseadores. Antes cualquiera se registraba como aseador
// y entraba a la bolsa al instante: nadie revisaba nada y no habia pantalla
// donde revisarlo.
app.get('/api/admin/workers', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    // Los inactivos primero (false ordena antes que true) y dentro de ellos
    // los que llevan mas tiempo esperando: la lista es una cola de revision.
    const { rows } = await pool.query(
      `SELECT id, nombre, email, telefono, comuna, experiencia, activo, perfil_pago_completo, creado_en
       FROM usuarios WHERE rol='worker' ORDER BY activo ASC, creado_en ASC, id ASC`);
    res.json(rows);
  } catch(e) { fallo(res, e, 'listar los aseadores'); }
});

app.post('/api/admin/workers/:id/activar', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    const activo = req.body?.activo;
    if (typeof activo !== 'boolean') return res.status(400).json({ error: 'Indica activo: true o false' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'El id del aseador debe ser un número' });
    const { rows: [u] } = await pool.query(
      "UPDATE usuarios SET activo=$1 WHERE id=$2 AND rol='worker' RETURNING id, activo", [activo, id]);
    if (!u) return res.status(404).json({ error: 'Aseador no encontrado' });
    if (u.activo) {
      await notificar(u.id, 'cuenta_activada', 'Tu cuenta quedó activada',
        'Tu cuenta quedó activada, ya puedes tomar trabajos.');
    }
    res.json({ ok: true, activo: u.activo });
  } catch(e) { fallo(res, e, 'activar o desactivar al aseador'); }
});

app.get('/api/admin/transferencias', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    await procesoDiario();
    res.json(await pagosTrabajador.listarPendientes(pool));
  } catch(e) { fallo(res, e, 'listar las transferencias pendientes'); }
});

app.post('/api/admin/transferencias/:id/transferida', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    const t = await pagosTrabajador.marcarTransferida(pool, Number(req.params.id), { referencia: req.body?.referencia });
    if (!t) return res.status(400).json({ error: 'La transferencia no existe, ya se marcó, o Flow todavía no deposita ese dinero' });
    await notificar(t.worker_id, 'pago_transferido', 'Te transferimos tu pago',
      `Te transferimos ${pesos(t.monto_a_transferir)} por el servicio #${t.servicio_id}.`, { servicio_id: t.servicio_id });
    res.json(t);
  } catch(e) { fallo(res, e, 'marcar la transferencia como hecha'); }
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
  } catch(e) { fallo(res, e, 'listar los reclamos'); }
});

app.post('/api/admin/servicios/:id/resolver', verificarToken, exigirRol('admin'), async (req, res) => {
  try {
    const accion = req.body?.accion;
    // Tanto liberar como reembolsar escriben en dos tablas: van juntas o no
    // van. Los caminos de error no escriben nada, asi que cerrar la
    // transaccion con ellos no deja rastro.
    const r = await pagosTrabajador.enTransaccion(pool, (db) =>
      pagosTrabajador.resolverReclamo(db, Number(req.params.id), accion, { aseadaRetiene: ASEADA_RETIENE_HONORARIOS }));
    if (r.error) return res.status(r.status).json({ error: r.error });
    // Cinturon: si por lo que sea no volvio el servicio, responder en
    // castellano en vez de reventar mas abajo en s.cliente_id y dejarle al
    // admin un 500 generico sin saber que paso con la plata.
    if (!r.resultado?.servicio) return res.status(409).json({ error: 'El servicio cambió de estado mientras se resolvía el reclamo. Vuelve a abrirlo para ver cómo quedó.' });
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
  } catch(e) { fallo(res, e, 'resolver el reclamo'); }
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
  } catch(e) { fallo(res, e, 'listar los pagos'); }
});

// ─── RESTO DE RUTAS ───────────────────────────────────────────────────────────
// Las calificaciones que el usuario escribio o recibio. Antes era publica y
// sin sesion: exponia los comentarios de todos.
app.get('/api/calificaciones', verificarToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM calificaciones WHERE autor_id=$1 OR destinatario_id=$1 ORDER BY id DESC', [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { fallo(res, e, 'listar las calificaciones'); }
});

app.get('/api/notificaciones', verificarToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notificaciones WHERE usuario_id=$1 ORDER BY id DESC', [req.usuario.id]); res.json(r.rows); }
  catch(e) { fallo(res, e, 'listar las notificaciones'); }
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
    // perfil_pago_completo es lo que mira el administrador para saber si al
    // aseador se le puede transferir; se ponia en true por el solo hecho de
    // guardar el formulario, aunque el RUT y la cuenta vinieran vacios. Se
    // calcula con la misma regla que usa la lista de transferencias
    // (pagos-trabajador.js: rut, banco y numero_cuenta presentes), para que no
    // haya dos definiciones distintas de "datos de pago completos".
    // Las expresiones del SET ven los valores viejos de la fila, asi que
    // COALESCE($n, columna) es el valor que va a quedar.
    const r = await pool.query(
      `UPDATE usuarios
       SET modalidad=$1, acepta_boleta=true, comuna=$2, experiencia=$3,
           rut=COALESCE($5, rut), banco=COALESCE($6, banco), tipo_cuenta=COALESCE($7, tipo_cuenta), numero_cuenta=COALESCE($8, numero_cuenta),
           perfil_pago_completo = (COALESCE($5, rut) IS NOT NULL AND COALESCE($6, banco) IS NOT NULL AND COALESCE($8, numero_cuenta) IS NOT NULL)
       WHERE id=$4 RETURNING perfil_pago_completo`,
      [modalidad, comuna || '', experiencia || '', req.usuario.id, limpio(rut), limpio(banco), tipo_cuenta || null, limpio(numero_cuenta)]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });
    res.json({ ok: true, perfil_pago_completo: r.rows[0].perfil_pago_completo });
  } catch(e) { fallo(res, e, 'guardar el perfil del aseador'); }
});

app.post('/api/push-token', verificarToken, exigirRol('worker'), async (req, res) => {
  try {
    const { push_token } = req.body;
    if (!push_token) return res.status(400).json({ error: 'Falta push_token' });
    await pool.query('UPDATE usuarios SET push_token=$1 WHERE id=$2', [push_token, req.usuario.id]);
    res.json({ ok: true });
  } catch(e) { fallo(res, e, 'guardar el token de notificaciones'); }
});

app.get('/api/disponibilidad', async (req, res) => {
  try { const r = await pool.query("SELECT d.*,u.nombre as worker_nombre,u.calificacion_promedio FROM disponibilidad d JOIN usuarios u ON d.worker_id=u.id WHERE u.activo=true ORDER BY d.id DESC"); res.json(r.rows); }
  catch(e) { fallo(res, e, 'listar la disponibilidad'); }
});

// Fotos de los servicios en que el usuario participa. Son imagenes del
// interior de casas ajenas: antes cualquier sesion las veia todas.
app.get('/api/fotos_servicio', verificarToken, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.* FROM fotos_servicio f JOIN servicios s ON s.id=f.servicio_id
       WHERE s.cliente_id=$1 OR s.worker_id=$1 ORDER BY f.id DESC`, [req.usuario.id]);
    res.json(r.rows);
  } catch(e) { fallo(res, e, 'listar las fotos del servicio'); }
});
// ─── WORKER RUTAS ────────────────────────────────────────────────────────────
app.get('/api/worker/disponibles', verificarToken, exigirRol('worker'), exigirAseadorActivo, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM servicios WHERE estado='buscando_worker' ORDER BY id DESC"
    );
    // Ninguno de estos tiene aseador todavia, asi que todos salen sin
    // direccion: el aseador la recibe cuando el trabajo ya es suyo.
    res.json(ocultarDireccionAjena(r.rows, req.usuario.id));
  } catch(e) { fallo(res, e, 'listar los trabajos disponibles'); }
});

// exigirAseadorActivo ya corto a quien todavia esta en revision o fue dado de
// baja: el rol por si solo no alcanza, porque el token sigue valido hasta que
// expira.
app.post('/api/worker/aceptar/:id', verificarToken, exigirRol('worker'), exigirAseadorActivo, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM servicios WHERE id=$1', [req.params.id]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (s.estado !== 'buscando_worker') return res.status(400).json({ error: 'Servicio no disponible' });

    // La condicion del SELECT se repite al escribir. Entre uno y otro pasan
    // milisegundos, y los aseadores consultan la bolsa cada 5 segundos: sin
    // esa condicion, dos aseadores que vieron el mismo trabajo lo escriben
    // los dos, ambos reciben "Trabajo aceptado" y gana el ultimo. Con ella,
    // el segundo no alcanza ninguna fila y se entera de que ya no esta.
    const { rows: [asignado] } = await pool.query(
      "UPDATE servicios SET estado='en_proceso', worker_id=$1 WHERE id=$2 AND estado='buscando_worker' RETURNING id",
      [req.usuario.id, req.params.id]
    );
    if (!asignado) return res.status(400).json({ error: 'Este trabajo ya lo tomó otro aseador' });
    res.json({ mensaje: 'Trabajo aceptado' });
  } catch(e) { fallo(res, e, 'aceptar el trabajo'); }
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
// Las rutas que mueven plata (aceptar un trabajo, crear un pago, confirmar)
// solo se pueden probar de verdad contra PostgreSQL: los indices unicos y las
// carreras entre dos peticiones no existen en un doble de prueba. Esto deja
// cambiar la base por un PGlite en memoria. En produccion no se llama nunca.
module.exports.usarPool = (otro) => { pool = otro; };
// El limitador cuenta intentos por IP en memoria del proceso, y en las
// pruebas todas las peticiones salen de 127.0.0.1: sin esto, una prueba que
// prueba el limite le deja la cuenta llena a la siguiente.
module.exports.reiniciarLimiteIntentos = () => intentosPorIp.clear();
// Lo que la app puede esperar del limitador, para no tenerlo escrito dos veces.
module.exports.INTENTOS_MAX = INTENTOS_MAX;
// La validacion de entrada se prueba sin levantar el servidor ni tocar la base.
module.exports.revisarSolicitud = revisarSolicitud;

// Solo al ejecutar `node server.js` directamente. Bajo Vercel el archivo se
// importa como modulo y la plataforma maneja el ciclo de vida del request,
// asi que abrir un puerto ahi no corresponde.
//
// El esquema ya no se toca al arrancar: las migraciones se aplican aparte con
// `npm run migrate`, que lleva registro de lo aplicado en _migraciones.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log('Aseada v3.0 PostgreSQL + Flow corriendo en puerto ' + PORT));
}
