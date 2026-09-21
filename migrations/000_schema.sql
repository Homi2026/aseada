-- Esquema base de Aseada.
--
-- Reconstruido a partir de las consultas de server.js. Hasta ahora estas
-- tablas solo existian como estado manual en la base de Railway, que ya no
-- esta disponible, asi que el repositorio no permitia levantar un ambiente
-- nuevo. Este archivo cierra ese hueco.
--
-- Ejecutar una vez sobre una base vacia, antes de 001.

CREATE TABLE IF NOT EXISTS usuarios (
  id                    SERIAL PRIMARY KEY,
  nombre                TEXT         NOT NULL,
  email                 TEXT         NOT NULL UNIQUE,
  password              TEXT         NOT NULL,           -- hash bcrypt, nunca texto plano
  rol                   VARCHAR(20)  NOT NULL CHECK (rol IN ('cliente', 'worker')),
  telefono              TEXT         NOT NULL DEFAULT '',
  foto_url              TEXT,
  calificacion_promedio NUMERIC(3,2) NOT NULL DEFAULT 5.0,
  total_servicios       INTEGER      NOT NULL DEFAULT 0,
  activo                BOOLEAN      NOT NULL DEFAULT TRUE,
  push_token            TEXT,
  creado_en             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- El login busca por email en cada request.
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (LOWER(email));
-- notificarWorkers() recorre los workers activos cada vez que entra un servicio.
CREATE INDEX IF NOT EXISTS idx_usuarios_workers_activos ON usuarios (rol, activo) WHERE activo;

CREATE TABLE IF NOT EXISTS servicios (
  id                   SERIAL PRIMARY KEY,
  cliente_id           INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  worker_id            INTEGER              REFERENCES usuarios(id) ON DELETE SET NULL,
  direccion            TEXT        NOT NULL,
  fecha_servicio       TIMESTAMPTZ,
  metros               INTEGER     NOT NULL,
  horas_extra          INTEGER     NOT NULL DEFAULT 0,
  con_materiales       BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Desglose congelado al momento de crear el servicio: si las tarifas
  -- cambian despues, el servicio ya cotizado no se altera.
  precio_base          INTEGER     NOT NULL,
  horas_extra_precio   INTEGER     NOT NULL DEFAULT 0,
  subtotal             INTEGER     NOT NULL,
  comision             INTEGER     NOT NULL,
  iva                  INTEGER     NOT NULL DEFAULT 0,
  total_cliente        INTEGER     NOT NULL,
  worker_recibe        INTEGER     NOT NULL,
  retencion_honorarios INTEGER     NOT NULL DEFAULT 0,

  tipo_servicio        VARCHAR(40) NOT NULL DEFAULT 'aseo'
                         CHECK (tipo_servicio IN ('aseo', 'fumigacion')),
  tipo_plaga           VARCHAR(40)
                         CHECK (tipo_plaga IS NULL OR tipo_plaga IN ('insectos', 'roedores', 'mixto')),
  horas_incluidas      INTEGER,

  estado               VARCHAR(30) NOT NULL DEFAULT 'pendiente_pago'
                         CHECK (estado IN ('pendiente_pago', 'buscando_worker', 'en_proceso', 'completado', 'pagado')),
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completado_en        TIMESTAMPTZ,

  -- Un servicio de fumigacion siempre declara que plaga trata.
  CONSTRAINT plaga_solo_en_fumigacion CHECK (
    (tipo_servicio = 'fumigacion' AND tipo_plaga IS NOT NULL) OR
    (tipo_servicio <> 'fumigacion')
  )
);

-- El worker pide la bolsa de trabajos disponibles cada 5 segundos.
CREATE INDEX IF NOT EXISTS idx_servicios_estado    ON servicios (estado, id DESC);
CREATE INDEX IF NOT EXISTS idx_servicios_cliente   ON servicios (cliente_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_servicios_worker    ON servicios (worker_id, id DESC);

CREATE TABLE IF NOT EXISTS pagos (
  id              SERIAL PRIMARY KEY,
  servicio_id     INTEGER     NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  cliente_id      INTEGER     NOT NULL REFERENCES usuarios(id)  ON DELETE RESTRICT,
  monto_total     INTEGER     NOT NULL,
  comision_aseada INTEGER     NOT NULL,
  pago_worker     INTEGER     NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'pagado', 'rechazado', 'liberado')),
  flow_token      TEXT,
  flow_order      TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pagado_en       TIMESTAMPTZ,
  liberado_en     TIMESTAMPTZ
);

-- La confirmacion de Flow llega por webhook y busca el pago por su token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_flow_token ON pagos (flow_token) WHERE flow_token IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_pagos_servicio   ON pagos (servicio_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Las tres tablas siguientes hoy solo se leen: server.js tiene el GET pero
-- todavia no existe la ruta que las escribe. El esquema queda definido para
-- que las consultas no fallen y para fijar la forma antes de implementarlas.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calificaciones (
  id              SERIAL PRIMARY KEY,
  servicio_id     INTEGER     NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  autor_id        INTEGER     NOT NULL REFERENCES usuarios(id)  ON DELETE CASCADE,
  destinatario_id INTEGER     NOT NULL REFERENCES usuarios(id)  ON DELETE CASCADE,
  puntaje         INTEGER     NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
  comentario      TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cada parte califica a la otra una sola vez por servicio.
  UNIQUE (servicio_id, autor_id, destinatario_id)
);

CREATE INDEX IF NOT EXISTS idx_calificaciones_destinatario ON calificaciones (destinatario_id);

CREATE TABLE IF NOT EXISTS disponibilidad (
  id          SERIAL PRIMARY KEY,
  worker_id   INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia_semana  SMALLINT    NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),  -- 0 = domingo
  hora_inicio TIME        NOT NULL,
  hora_fin    TIME        NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rango_horario_valido CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS idx_disponibilidad_worker ON disponibilidad (worker_id);

CREATE TABLE IF NOT EXISTS fotos_servicio (
  id          SERIAL PRIMARY KEY,
  servicio_id INTEGER     NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  momento     VARCHAR(10) NOT NULL CHECK (momento IN ('antes', 'despues')),
  subida_por  INTEGER              REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fotos_servicio ON fotos_servicio (servicio_id);

CREATE TABLE IF NOT EXISTS notificaciones (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo       VARCHAR(80) NOT NULL,
  titulo     TEXT        NOT NULL,
  mensaje    TEXT        NOT NULL,
  leida      BOOLEAN     NOT NULL DEFAULT FALSE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El panel del worker pide sus notificaciones sin leer en cada poll.
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones (usuario_id, id DESC);
