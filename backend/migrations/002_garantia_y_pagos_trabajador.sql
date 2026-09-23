-- 002: garantia al cliente y pago a los trabajadores.
--
-- El pago del cliente queda retenido hasta que se cumplen dos condiciones:
-- que el servicio este confirmado (por el cliente, o solo a las 24 h sin
-- reclamo) y que Flow ya haya depositado el dinero. Asi Aseada nunca le
-- adelanta al trabajador plata que todavia no recibio.

-- ─── Servicios: confirmacion y reclamos ────────────────────────────────────
ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_estado_check;
ALTER TABLE servicios ADD CONSTRAINT servicios_estado_check CHECK (estado IN (
  'pendiente_pago', 'buscando_worker', 'en_proceso', 'completado',
  'en_reclamo',   -- el cliente reporto un problema: el pago queda retenido
  'pagado',       -- confirmado; el pago al trabajador ya esta liberado
  'reembolsado'   -- el reclamo se resolvio devolviendole el dinero al cliente
));

ALTER TABLE servicios ADD COLUMN IF NOT EXISTS confirmado_en TIMESTAMPTZ;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS confirmacion_origen VARCHAR(20);
ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_confirmacion_origen_check;
ALTER TABLE servicios ADD CONSTRAINT servicios_confirmacion_origen_check
  CHECK (confirmacion_origen IS NULL OR confirmacion_origen IN ('cliente', 'automatica', 'admin'));

ALTER TABLE servicios ADD COLUMN IF NOT EXISTS reclamo_en TIMESTAMPTZ;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS reclamo_motivo VARCHAR(30);
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS reclamo_detalle TEXT;
ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_reclamo_motivo_check;
ALTER TABLE servicios ADD CONSTRAINT servicios_reclamo_motivo_check
  CHECK (reclamo_motivo IS NULL OR reclamo_motivo IN ('no_llego', 'incompleto', 'danio', 'otro'));

-- La liberacion automatica busca servicios completados hace mas de 24 h.
CREATE INDEX IF NOT EXISTS idx_servicios_por_confirmar ON servicios (completado_en) WHERE estado = 'completado';

-- ─── Pagos: lo que informa Flow del deposito ───────────────────────────────
ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_estado_check;
ALTER TABLE pagos ADD CONSTRAINT pagos_estado_check
  CHECK (estado IN ('pendiente', 'pagado', 'rechazado', 'liberado', 'reembolsado'));

-- Salen de paymentData en payment/getStatus. Con la fecha de deposito, el
-- sistema sabe cuando el dinero esta de verdad en la cuenta de Aseada.
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_comision INTEGER;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_impuestos INTEGER;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_deposito INTEGER;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_fecha_deposito TIMESTAMPTZ;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS reembolsado_en TIMESTAMPTZ;

-- ─── Usuarios: administrador y datos bancarios ─────────────────────────────
-- El rol admin no se puede pedir al registrarse (el registro solo acepta
-- cliente y worker); se asigna con scripts/hacer-admin.mjs.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('cliente', 'worker', 'admin'));

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rut TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS banco TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo_cuenta VARCHAR(20);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS numero_cuenta TEXT;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_cuenta_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_cuenta_check
  CHECK (tipo_cuenta IS NULL OR tipo_cuenta IN ('corriente', 'vista', 'ahorro'));

-- ─── Tasa de retencion de honorarios por año ───────────────────────────────
-- Ley 21.133: la tasa sube cada enero. En una tabla, para que un cambio de
-- año no deje el calculo desactualizado en silencio.
CREATE TABLE IF NOT EXISTS tasas_retencion (
  anio SMALLINT PRIMARY KEY,
  tasa NUMERIC(5,4) NOT NULL CHECK (tasa > 0 AND tasa < 1)
);
INSERT INTO tasas_retencion (anio, tasa) VALUES
  (2025, 0.1450), (2026, 0.1525), (2027, 0.1600), (2028, 0.1700)
ON CONFLICT (anio) DO NOTHING;

-- ─── Transferencias a trabajadores ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transferencias_trabajador (
  id                 SERIAL PRIMARY KEY,
  -- Una sola transferencia por pago: aunque la liberacion se dispare dos
  -- veces (cliente y proceso automatico a la vez), no se paga doble.
  pago_id            INTEGER      NOT NULL UNIQUE REFERENCES pagos(id) ON DELETE CASCADE,
  servicio_id        INTEGER      NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  worker_id          INTEGER      NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,

  bruto              INTEGER      NOT NULL CHECK (bruto >= 0),
  tasa_retencion     NUMERIC(5,4) NOT NULL,
  retencion          INTEGER      NOT NULL CHECK (retencion >= 0),
  liquido            INTEGER      NOT NULL,
  -- Si Aseada retiene y paga la retencion al SII, se transfiere el liquido;
  -- si no, el bruto y el trabajador declara por su cuenta. Queda registrado
  -- con que regla se calculo cada transferencia.
  aseada_retiene     BOOLEAN      NOT NULL,
  monto_a_transferir INTEGER      NOT NULL,

  estado             VARCHAR(20)  NOT NULL DEFAULT 'esperando_fondos'
                       CHECK (estado IN ('esperando_fondos', 'por_transferir', 'transferido')),
  -- Cuando el dinero ya esta en la cuenta de Aseada.
  disponible_desde   TIMESTAMPTZ  NOT NULL,
  transferido_en     TIMESTAMPTZ,
  referencia         TEXT,         -- comprobante de la transferencia
  creado_en          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT liquido_cuadra CHECK (liquido = bruto - retencion),
  CONSTRAINT monto_segun_regla CHECK (monto_a_transferir = CASE WHEN aseada_retiene THEN liquido ELSE bruto END)
);

CREATE INDEX IF NOT EXISTS idx_transferencias_pendientes ON transferencias_trabajador (estado, disponible_desde);
CREATE INDEX IF NOT EXISTS idx_transferencias_worker ON transferencias_trabajador (worker_id, id DESC);
