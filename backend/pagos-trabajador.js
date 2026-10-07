// Garantia al cliente y pago a los trabajadores.
//
// El dinero del cliente queda retenido hasta que se cumplen dos condiciones:
//
//   1. el servicio esta confirmado: el cliente dijo "quedo todo bien", o
//      pasaron HORAS_REVISION desde que el trabajador lo marco terminado sin
//      que el cliente reclamara;
//   2. Flow ya deposito ese pago en la cuenta de Aseada.
//
// Con eso Aseada nunca le adelanta al trabajador dinero que no recibio. Si el
// cliente reclama, el pago no se libera hasta que un administrador lo resuelva.
//
// Cada funcion recibe la conexion (`db`, cualquier objeto con .query) para
// poder probarla contra PostgreSQL real sin levantar el servidor.

const HORAS_REVISION = 24;
const MOTIVOS_RECLAMO = ['no_llego', 'incompleto', 'danio', 'otro'];
// Mientras el servicio no se completa ni se libera, el cliente puede reclamar.
const ESTADOS_RECLAMABLES = ['buscando_worker', 'en_proceso', 'completado'];

const HORA_MS = 60 * 60 * 1000;

// Si el aseador no marca que llego dentro de esta ventana desde que acepto,
// el sistema levanta el reclamo solo: nadie tiene que darse cuenta ni
// reportarlo a mano. No es un reembolso automatico -- el pago del cliente
// queda retenido, pero la decision de pagarle al trabajador o devolver la
// sigue tomando un administrador, igual que cualquier otro reclamo. Un
// aseador que si llego pero se olvido de tocar el boton no deberia perder su
// pago sin que nadie lo revise primero.
const HORAS_TOLERANCIA_LLEGADA = 2;

/**
 * Corre `fn` dentro de una transaccion y devuelve lo que ella devuelva. Si
 * algo revienta a mitad, no queda nada escrito a medias.
 *
 * `pool` puede ser un Pool de pg —ahi hay que pedirle un cliente, porque
 * BEGIN y COMMIT solo valen dentro de la misma conexion— o cualquier objeto
 * con .query() que hable el mismo SQL, como el PGlite de las pruebas, que
 * tiene una sola conexion y no expone .connect(). Por eso la eleccion se
 * hace mirando si existe .connect(), y no por configuracion.
 */
async function enTransaccion(pool, fn) {
  const db = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await db.query('BEGIN');
    const resultado = await fn(db);
    await db.query('COMMIT');
    return resultado;
  } catch (error) {
    // Si la conexion se cayo, el ROLLBACK tambien falla; el error que hay
    // que propagar es el original, no el del rollback.
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (typeof db.release === 'function') db.release();
  }
}

async function tasaRetencion(db, fecha) {
  // La vigente es la del año mas reciente que no sea posterior a la fecha.
  const { rows } = await db.query(
    'SELECT tasa FROM tasas_retencion WHERE anio <= $1 ORDER BY anio DESC LIMIT 1',
    [fecha.getFullYear()]);
  if (!rows[0]) throw new Error(`No hay tasa de retencion configurada para ${fecha.getFullYear()}`);
  return Number(rows[0].tasa);
}

function calcularLiquidacion(bruto, tasa, aseadaRetiene) {
  const retencion = Math.round(bruto * tasa);
  const liquido = bruto - retencion;
  return { bruto, tasa, retencion, liquido, aseadaRetiene, montoATransferir: aseadaRetiene ? liquido : bruto };
}

/**
 * Guarda lo que Flow informa del deposito de un pago confirmado. Flow manda
 * la fecha como texto en hora de Chile ("2026-09-22 00:00:00").
 */
async function registrarDatosFlow(db, flowToken, paymentData = {}) {
  const entero = (v) => (v === undefined || v === null || v === '' ? null : Math.round(Number(v)));
  await db.query(
    `UPDATE pagos SET flow_comision=$2, flow_impuestos=$3, flow_deposito=$4,
       flow_fecha_deposito = CASE WHEN $5::text IS NULL THEN NULL
                                  ELSE ($5::timestamp AT TIME ZONE 'America/Santiago') END
     WHERE flow_token=$1`,
    [flowToken, entero(paymentData.fee), entero(paymentData.taxes), entero(paymentData.balance),
     paymentData.transferDate || null]);
}

/**
 * Libera el pago de un servicio al trabajador y deja lista su transferencia.
 * Es segura ante llamadas repetidas o simultaneas: el cambio de estado del
 * pago de 'pagado' a 'liberado' solo lo gana una, y la transferencia tiene
 * UNIQUE por pago.
 *
 * Escribe en cuatro tablas, asi que quien la llama debe pasarle un `db` que
 * este dentro de una transaccion (enTransaccion). Sin eso, una falla a mitad
 * —no hay tasa de retencion cargada para el año, se corta la conexion— deja
 * el pago 'liberado' y el servicio 'pagado' pero sin transferencia: el
 * trabajador no cobra nunca y no aparece en ninguna lista del admin.
 *
 * @returns {Promise<null|{servicio, transferencia}>} null si no correspondia liberar.
 */
async function liberarServicio(db, servicioId, { origen, aseadaRetiene = false, ahora = new Date(), estadosPermitidos = ['completado'] }) {
  const { rows: [actual] } = await db.query('SELECT estado FROM servicios WHERE id=$1', [servicioId]);
  if (!actual || !estadosPermitidos.includes(actual.estado)) return null;

  const { rows: [pago] } = await db.query(
    "UPDATE pagos SET estado='liberado', liberado_en=$2 WHERE servicio_id=$1 AND estado='pagado' RETURNING *",
    [servicioId, ahora]);
  if (!pago) return null;

  const { rows: [servicio] } = await db.query(
    "UPDATE servicios SET estado='pagado', confirmado_en=$2, confirmacion_origen=$3 WHERE id=$1 RETURNING *",
    [servicioId, ahora, origen]);

  const liq = calcularLiquidacion(Number(servicio.worker_recibe), await tasaRetencion(db, ahora), aseadaRetiene);

  // El dinero esta disponible cuando Flow lo deposita. Si Flow no informo la
  // fecha, se asume un dia despues: es preferible esperar que adelantar.
  const deposito = pago.flow_fecha_deposito ? new Date(pago.flow_fecha_deposito) : new Date(ahora.getTime() + 24 * HORA_MS);
  const disponible = deposito > ahora ? deposito : ahora;

  const { rows: [transferencia] } = await db.query(
    `INSERT INTO transferencias_trabajador
       (pago_id, servicio_id, worker_id, bruto, tasa_retencion, retencion, liquido, aseada_retiene, monto_a_transferir, estado, disponible_desde)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (pago_id) DO NOTHING RETURNING *`,
    [pago.id, servicio.id, servicio.worker_id, liq.bruto, liq.tasa, liq.retencion, liq.liquido,
     liq.aseadaRetiene, liq.montoATransferir, deposito <= ahora ? 'por_transferir' : 'esperando_fondos', disponible]);

  if (transferencia) {
    await db.query('UPDATE usuarios SET total_servicios=total_servicios+1 WHERE id=$1', [servicio.worker_id]);
  }
  return { servicio, transferencia };
}

/** Libera los servicios terminados hace mas de HORAS_REVISION sin reclamo. */
async function liberarVencidos(db, { aseadaRetiene = false, ahora = new Date() } = {}) {
  const limite = new Date(ahora.getTime() - HORAS_REVISION * HORA_MS);
  const { rows } = await db.query(
    "SELECT id FROM servicios WHERE estado='completado' AND completado_en <= $1 ORDER BY id", [limite]);
  const liberados = [];
  for (const { id } of rows) {
    // Cada servicio en su propia transaccion: si uno falla, se deshace solo
    // ese y los demas igual se liberan. Con una transaccion para todo el
    // bucle, un servicio con datos malos dejaria sin pago a los demas.
    try {
      const r = await enTransaccion(db, (tx) => liberarServicio(tx, id, { origen: 'automatica', aseadaRetiene, ahora }));
      if (r) liberados.push(r);
    } catch (error) {
      console.error(`[aseada] no se pudo liberar el servicio #${id}, queda pendiente: ${error.message}`);
    }
  }
  return liberados;
}

/** Pasa a 'por_transferir' las transferencias cuyo dinero Flow ya deposito. */
async function marcarFondosDisponibles(db, { ahora = new Date() } = {}) {
  const { rows } = await db.query(
    `UPDATE transferencias_trabajador SET estado='por_transferir'
     WHERE estado='esperando_fondos' AND disponible_desde <= $1 RETURNING *`, [ahora]);
  return rows;
}

/**
 * El cliente reporta un problema. El pago queda retenido: ni el proceso
 * automatico ni el trabajador pueden liberarlo mientras dure el reclamo.
 */
async function reclamar(db, servicioId, clienteId, { motivo, detalle = '', ahora = new Date() }) {
  if (!MOTIVOS_RECLAMO.includes(motivo)) return { error: 'Motivo de reclamo inválido', status: 400 };
  const { rows: [s] } = await db.query('SELECT cliente_id, estado FROM servicios WHERE id=$1', [servicioId]);
  if (!s) return { error: 'Servicio no encontrado', status: 404 };
  if (s.cliente_id !== clienteId) return { error: 'Solo el cliente del servicio puede reportar un problema', status: 403 };
  if (!ESTADOS_RECLAMABLES.includes(s.estado)) return { error: 'Este servicio ya no admite reclamos', status: 400 };
  // El estado se vuelve a exigir al escribir. El SELECT de arriba solo sirve
  // para distinguir el 404 del 403: entre una consulta y la otra el cliente
  // puede haber confirmado desde otro dispositivo, o puede haber corrido la
  // liberacion automatica. Sin esta condicion el UPDATE devolvia a
  // 'en_reclamo' un servicio ya pagado y liberado, y quedaba un reclamo del
  // que no se sale (el admin no puede ni liberar ni reembolsar) mientras al
  // cliente se le respondia "tu pago queda retenido" con la plata ya girada.
  const { rows: [servicio] } = await db.query(
    `UPDATE servicios SET estado='en_reclamo', reclamo_en=$2, reclamo_motivo=$3, reclamo_detalle=$4
     WHERE id=$1 AND estado = ANY($5::text[]) RETURNING *`,
    [servicioId, ahora, motivo, String(detalle).slice(0, 2000), ESTADOS_RECLAMABLES]);
  if (!servicio) return { error: 'Este servicio ya no admite reclamos', status: 409 };
  return { servicio };
}

/**
 * El aseador marca que llego a la direccion. Solo el asignado, solo mientras
 * el servicio sigue en_proceso, y una sola vez.
 */
async function marcarLlegada(db, servicioId, workerId, { ahora = new Date() } = {}) {
  const { rows: [actual] } = await db.query('SELECT worker_id, estado, llegada_en FROM servicios WHERE id=$1', [servicioId]);
  if (!actual) return { error: 'Servicio no encontrado', status: 404 };
  if (actual.worker_id !== workerId) return { error: 'Solo el aseador asignado puede marcar que llegó', status: 403 };
  if (actual.estado !== 'en_proceso') return { error: 'Este servicio no está en proceso', status: 400 };
  if (actual.llegada_en) return { error: 'Ya habías marcado que llegaste', status: 409 };
  // La condicion se repite al escribir por la misma razon que en reclamar():
  // entre el SELECT y el UPDATE el proceso periodico pudo haber levantado el
  // reclamo automatico por demora, y esta carrera no debe pisarlo.
  const { rows: [servicio] } = await db.query(
    `UPDATE servicios SET llegada_en=$2
     WHERE id=$1 AND worker_id=$3 AND estado='en_proceso' AND llegada_en IS NULL RETURNING *`,
    [servicioId, ahora, workerId]);
  if (!servicio) return { error: 'No se pudo marcar la llegada', status: 409 };
  return { servicio };
}

/**
 * Levanta el reclamo solo cuando el aseador no marco su llegada a tiempo.
 * Misma forma que liberarVencidos(): recorre los vencidos y actua uno por
 * uno, para que un servicio con datos raros no le impida avanzar a los demas.
 */
async function marcarNoLlegadas(db, { ahora = new Date(), horasTolerancia = HORAS_TOLERANCIA_LLEGADA } = {}) {
  const limite = new Date(ahora.getTime() - horasTolerancia * HORA_MS);
  const { rows } = await db.query(
    `SELECT id FROM servicios
     WHERE estado='en_proceso' AND llegada_en IS NULL AND aceptado_en IS NOT NULL AND aceptado_en <= $1
     ORDER BY id`, [limite]);
  const reclamados = [];
  for (const { id } of rows) {
    // La condicion se repite al escribir: entre el SELECT y este UPDATE el
    // aseador pudo haber marcado su llegada recien, y esta carrera no debe
    // levantarle un reclamo a un servicio que ya esta al dia.
    const { rows: [servicio] } = await db.query(
      `UPDATE servicios SET estado='en_reclamo', reclamo_en=$2, reclamo_motivo='no_llego', reclamo_detalle=$3
       WHERE id=$1 AND estado='en_proceso' AND llegada_en IS NULL RETURNING *`,
      [id, ahora, `Generado automáticamente: el aseador no marcó su llegada dentro de ${horasTolerancia} horas desde que aceptó.`]);
    if (servicio) reclamados.push(servicio);
  }
  return reclamados;
}

const CUANDO_REAGENDAR = ['hoy', 'manana'];

/**
 * El cliente reagenda un servicio que quedo en_reclamo por 'no_llego': vuelve
 * a la bolsa de trabajos para que lo tome otro aseador, excluyendo al que no
 * llego (no puede volver a tomar este mismo servicio). El pago sigue
 * retenido exactamente igual que antes: reagendar no lo toca.
 *
 * Solo sirve para 'no_llego' porque ahi el sistema ya verifico objetivamente
 * que nadie marco su llegada; otros motivos de reclamo (incompleto, danio,
 * otro) son disputas que un admin tiene que revisar, no algo que el cliente
 * resuelva solo reagendando.
 */
async function reagendarPorNoLlegada(db, servicioId, clienteId, { cuando, ahora = new Date() } = {}) {
  if (!CUANDO_REAGENDAR.includes(cuando)) return { error: "'cuando' debe ser 'hoy' o 'manana'", status: 400 };
  const { rows: [actual] } = await db.query('SELECT cliente_id, estado, reclamo_motivo FROM servicios WHERE id=$1', [servicioId]);
  if (!actual) return { error: 'Servicio no encontrado', status: 404 };
  if (actual.cliente_id !== clienteId) return { error: 'Solo el cliente del servicio puede reagendarlo', status: 403 };
  if (actual.estado !== 'en_reclamo' || actual.reclamo_motivo !== 'no_llego') {
    return { error: 'Este servicio no está esperando una decisión por falta de aseador', status: 400 };
  }
  const fecha = new Date(ahora.getTime() + (cuando === 'manana' ? HORA_MS * 24 : 0));
  // array_append(workers_excluidos, worker_id) lee el worker_id de ANTES de
  // este mismo UPDATE: no hace falta guardarlo aparte ni arriesgar una
  // carrera entre el SELECT de arriba y este escritura.
  const { rows: [servicio] } = await db.query(
    `UPDATE servicios SET
       estado='buscando_worker',
       workers_excluidos = CASE WHEN worker_id IS NULL THEN workers_excluidos ELSE array_append(workers_excluidos, worker_id) END,
       worker_id=NULL, aceptado_en=NULL, llegada_en=NULL,
       fecha_servicio=$2,
       reclamo_en=NULL, reclamo_motivo=NULL, reclamo_detalle=NULL
     WHERE id=$1 AND estado='en_reclamo' AND reclamo_motivo='no_llego'
     RETURNING *`,
    [servicioId, fecha]);
  if (!servicio) return { error: 'No se pudo reagendar', status: 409 };
  return { servicio };
}

/**
 * Un administrador cierra un reclamo. 'reembolsar' deja registrado el
 * reembolso; la devolucion en si se hace desde el panel de Flow.
 *
 * Igual que liberarServicio: toca pagos y servicios, asi que el `db` que
 * recibe tiene que venir dentro de una transaccion. Si no, un reembolso a
 * medias deja el pago 'reembolsado' con el servicio todavia 'en_reclamo'.
 */
async function resolverReclamo(db, servicioId, accion, { aseadaRetiene = false, ahora = new Date() } = {}) {
  if (accion === 'liberar') {
    const r = await liberarServicio(db, servicioId, { origen: 'admin', aseadaRetiene, ahora, estadosPermitidos: ['en_reclamo'] });
    return r ? { resultado: r } : { error: 'El servicio no está en reclamo o su pago no está retenido', status: 400 };
  }
  if (accion === 'reembolsar') {
    // El estado del servicio se mira ANTES de tocar la plata, igual que hace
    // 'liberar' con estadosPermitidos. Sin esto, reembolsar un servicio que no
    // estaba en reclamo dejaba el pago en 'reembolsado' —fuera del indice
    // unico y fuera del alcance de liberarServicio, o sea imposible de pagarle
    // nunca al trabajador— mientras el servicio seguia como estaba y el admin
    // solo veia un 500. FOR UPDATE toma la fila hasta el COMMIT: nadie la
    // mueve entre la comprobacion y las dos escrituras.
    const { rows: [actual] } = await db.query('SELECT estado FROM servicios WHERE id=$1 FOR UPDATE', [servicioId]);
    if (!actual) return { error: 'Servicio no encontrado', status: 404 };
    if (actual.estado !== 'en_reclamo') return { error: 'El servicio no está en reclamo', status: 400 };

    const { rows: [pago] } = await db.query(
      "UPDATE pagos SET estado='reembolsado', reembolsado_en=$2 WHERE servicio_id=$1 AND estado='pagado' RETURNING *",
      [servicioId, ahora]);
    if (!pago) return { error: 'No hay un pago retenido que reembolsar', status: 400 };
    const { rows: [servicio] } = await db.query(
      "UPDATE servicios SET estado='reembolsado' WHERE id=$1 AND estado='en_reclamo' RETURNING *", [servicioId]);
    // No deberia pasar teniendo la fila tomada; si pasa, se deshace todo en
    // vez de dejar el pago 'reembolsado' con el servicio en otro estado.
    if (!servicio) throw new Error(`El servicio #${servicioId} cambio de estado mientras se reembolsaba`);
    return { resultado: { servicio, pago } };
  }
  return { error: "La acción debe ser 'liberar' o 'reembolsar'", status: 400 };
}

async function marcarTransferida(db, transferenciaId, { referencia = '', ahora = new Date() } = {}) {
  const { rows: [t] } = await db.query(
    `UPDATE transferencias_trabajador SET estado='transferido', transferido_en=$2, referencia=$3
     WHERE id=$1 AND estado='por_transferir' RETURNING *`,
    [transferenciaId, ahora, String(referencia).slice(0, 200)]);
  return t || null;
}

/** Transferencias pendientes con los datos que hacen falta para pagarlas. */
async function listarPendientes(db) {
  const { rows } = await db.query(
    `SELECT t.*, u.nombre AS worker_nombre, u.email AS worker_email, u.rut, u.banco, u.tipo_cuenta, u.numero_cuenta,
            (u.banco IS NOT NULL AND u.numero_cuenta IS NOT NULL AND u.rut IS NOT NULL) AS datos_bancarios_completos
     FROM transferencias_trabajador t JOIN usuarios u ON u.id = t.worker_id
     WHERE t.estado IN ('por_transferir', 'esperando_fondos')
     ORDER BY t.estado DESC, t.disponible_desde, t.id`);
  return rows;
}

const VISITAS_POR_PLAN = { mensual: 4, trimestral: 12 };

/**
 * Comision que, sumada al subtotal y su IVA, da exactamente el precio final.
 * Prueba los valores vecinos porque no todo total es alcanzable con enteros.
 */
function comisionParaPrecio(precioFinal, subtotal, tasaIva) {
  const objetivo = precioFinal - subtotal;
  const aproximada = Math.round(objetivo / (1 + tasaIva));
  let mejor = aproximada;
  for (let c = aproximada - 2; c <= aproximada + 2; c++) {
    const error = Math.abs(c + Math.round(c * tasaIva) - objetivo);
    if (error < Math.abs(mejor + Math.round(mejor * tasaIva) - objetivo)) mejor = c;
  }
  return mejor;
}

/**
 * Precio de cada visita de un plan: el precio de lista de la visita suelta
 * menos el descuento del plan. El aseador cobra lo mismo que en una visita
 * suelta; el descuento sale de la comision de Aseada.
 */
function precioVisitaPlan(lista, { tasaIva, descuento }) {
  const total = Math.round(lista.total_cliente * (1 - descuento) / 10) * 10;
  const comision = comisionParaPrecio(total, lista.subtotal, tasaIva);
  const iva = Math.round(comision * tasaIva);
  const total_cliente = lista.subtotal + comision + iva;
  return { ...lista, comision, iva, total_cliente, descuento_clp: lista.total_cliente - total_cliente };
}

/** Reparte un monto de Flow entre las visitas en proporcion a lo que paga cada una. La ultima recibe el resto. */
function repartirEntre(valor, partes, total) {
  if (valor === null) return partes.map(() => null);
  const cuotas = [];
  let acumulado = 0;
  partes.forEach((parte, i) => {
    const cuota = i === partes.length - 1 ? valor - acumulado : Math.round(valor * parte / total);
    cuotas.push(cuota);
    acumulado += cuota;
  });
  return cuotas;
}

/**
 * Flow confirmo el cobro de un plan: crea sus visitas (servicios 'programado',
 * una cada 7 dias desde fecha_inicio) y un pago por cada una. Quien la llama
 * tiene que pasarle un `db` dentro de una transaccion, igual que liberarServicio.
 */
async function activarPlan(db, flowToken, flowData = {}, { calcularVisita, ahora = new Date() } = {}) {
  const { rows: [plan] } = await db.query('SELECT *, fecha_inicio::text AS fecha_txt FROM planes WHERE flow_token=$1 FOR UPDATE', [flowToken]);
  if (!plan) return null;
  if (plan.estado !== 'pendiente_pago') return { plan, yaActivado: true };

  const precioVisita = calcularVisita(plan);
  await db.query("UPDATE planes SET estado='activo', pagado_en=$2 WHERE id=$1", [plan.id, ahora]);

  const entero = (v) => (v === undefined || v === null || v === '' ? null : Math.round(Number(v)));
  const fee = repartirEntre(entero(flowData.fee), Array(plan.visitas).fill(precioVisita.total_cliente), plan.total);
  const impuestos = repartirEntre(entero(flowData.taxes), Array(plan.visitas).fill(precioVisita.total_cliente), plan.total);
  const deposito = repartirEntre(entero(flowData.balance), Array(plan.visitas).fill(precioVisita.total_cliente), plan.total);

  const visitas = [];
  for (let k = 1; k <= plan.visitas; k++) {
    const { rows: [servicio] } = await db.query(
      `INSERT INTO servicios(cliente_id,plan_id,numero_visita,direccion,fecha_servicio,metros,horas_extra,con_materiales,
         precio_base,horas_extra_precio,subtotal,comision,iva,total_cliente,worker_recibe,retencion_honorarios,horas_incluidas,estado,tipo_servicio)
       VALUES($1,$2,$3,$4,((($5::date + $6::int)::timestamp AT TIME ZONE 'America/Santiago') + interval '12 hours'),$7,0,$8,
         $9,0,$10,$11,$12,$13,$14,$15,$16,'programado','aseo')
       RETURNING *`,
      [plan.cliente_id, plan.id, k, plan.direccion, plan.fecha_txt, (k - 1) * 7, plan.metros, plan.con_materiales,
       precioVisita.precio_base, precioVisita.subtotal, precioVisita.comision, precioVisita.iva, precioVisita.total_cliente,
       precioVisita.worker_recibe, precioVisita.retencion_honorarios, precioVisita.horas_incluidas]);
    const i = k - 1;
    await db.query(
      `INSERT INTO pagos(servicio_id,cliente_id,monto_total,comision_aseada,pago_worker,estado,flow_order,pagado_en,
         flow_comision,flow_impuestos,flow_deposito,flow_fecha_deposito)
       VALUES($1,$2,$3,$4,$5,'pagado',$6,$7,$8,$9,$10,$11::timestamp AT TIME ZONE 'America/Santiago')`,
      [servicio.id, plan.cliente_id, precioVisita.total_cliente, precioVisita.comision, precioVisita.worker_recibe,
       plan.flow_order, ahora, fee[i], impuestos[i], deposito[i], flowData.transferDate || null]);
    visitas.push(servicio);
  }
  return { plan: { ...plan, estado: 'activo' }, visitas };
}

/** Publica las visitas programadas cuyo dia ya llego (dia en Chile). */
async function promoverVisitasDelDia(db, { ahora = new Date() } = {}) {
  const { rows } = await db.query(
    `UPDATE servicios SET estado='buscando_worker'
     WHERE estado='programado'
       AND (fecha_servicio AT TIME ZONE 'America/Santiago')::date <= ($1::timestamptz AT TIME ZONE 'America/Santiago')::date
     RETURNING *`, [ahora]);
  return rows;
}

/**
 * Reembolsos iniciados hace mas de 72 horas que Flow todavia no confirma como
 * devueltos. Se marcan al devolverlos, asi el aviso a los administradores sale
 * una sola vez.
 */
async function reembolsosSinConfirmar(db, { ahora = new Date(), horas = 72 } = {}) {
  const limite = new Date(ahora.getTime() - horas * HORA_MS);
  const { rows } = await db.query(
    `UPDATE pagos SET reembolso_alerta_en=$2
     WHERE flow_refund_token IS NOT NULL AND reembolso_alerta_en IS NULL
       AND reembolsado_en <= $1
       AND COALESCE(flow_refund_status, '') NOT IN ('refunded', 'rejected', 'cancelled')
     RETURNING *`, [limite, ahora]);
  return rows;
}

module.exports = {
  VISITAS_POR_PLAN, comisionParaPrecio, precioVisitaPlan, activarPlan, promoverVisitasDelDia, reembolsosSinConfirmar,
  HORAS_REVISION, MOTIVOS_RECLAMO, HORAS_TOLERANCIA_LLEGADA,
  enTransaccion, tasaRetencion, calcularLiquidacion, registrarDatosFlow,
  liberarServicio, liberarVencidos, marcarFondosDisponibles,
  reclamar, resolverReclamo, marcarTransferida, listarPendientes,
  marcarLlegada, marcarNoLlegadas, reagendarPorNoLlegada
};
