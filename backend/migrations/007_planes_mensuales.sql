-- Planes: un cobro por adelantado que cubre varias visitas semanales. Cada
-- visita es un servicio normal con su propio pago, para que se libere igual
-- que cualquier otro trabajo. 'programado' es una visita que todavia no se
-- publica a la bolsa: aparece el dia que le toca.

CREATE TABLE IF NOT EXISTS planes (
  id              SERIAL PRIMARY KEY,
  cliente_id      INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('mensual', 'trimestral')),
  direccion       TEXT        NOT NULL,
  metros          INTEGER     NOT NULL,
  con_materiales  BOOLEAN     NOT NULL DEFAULT FALSE,
  visitas         INTEGER     NOT NULL,
  fecha_inicio    DATE        NOT NULL,
  precio_visita   INTEGER     NOT NULL,
  total           INTEGER     NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente_pago'
                    CHECK (estado IN ('pendiente_pago', 'activo', 'rechazado')),
  flow_token      TEXT,
  flow_order      TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagado_en       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planes_flow_token ON planes (flow_token) WHERE flow_token IS NOT NULL;

ALTER TABLE servicios ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES planes(id) ON DELETE RESTRICT;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS numero_visita INTEGER;

ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_estado_check;
ALTER TABLE servicios ADD CONSTRAINT servicios_estado_check CHECK (estado IN (
  'pendiente_pago', 'buscando_worker', 'en_proceso', 'completado',
  'en_reclamo', 'pagado', 'reembolsado',
  'programado'
));

CREATE INDEX IF NOT EXISTS idx_servicios_programados ON servicios (fecha_servicio) WHERE estado = 'programado';
