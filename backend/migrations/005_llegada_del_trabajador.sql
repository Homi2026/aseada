-- 005: llegada del trabajador, para poder detectar solos que nadie llego.
--
-- El sistema de garantia protegia al cliente si el trabajador no terminaba o
-- si el cliente reportaba un problema, pero dependia de que el cliente se
-- diera cuenta y reclamara a mano si nadie se presentaba. Si el cliente no
-- estaba mirando la app justo en ese momento, el servicio quedaba
-- 'en_proceso' indefinidamente, sin que nadie hiciera nada y sin que el
-- trabajador cobrara ni el cliente recuperara su plata.
--
-- aceptado_en es el ancla para medir la ventana de llegada, no
-- fecha_servicio: esa columna es solo el dia preferido que escribe el
-- cliente (a veces vacio, y ahi queda en el momento de pedir el servicio),
-- no una hora de cita real. Lo unico confiable es cuando el aseador acepto.

ALTER TABLE servicios ADD COLUMN IF NOT EXISTS aceptado_en TIMESTAMPTZ;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS llegada_en TIMESTAMPTZ;

-- El proceso periodico busca servicios en_proceso sin llegada marcada cuya
-- aceptacion ya paso la ventana de tolerancia.
CREATE INDEX IF NOT EXISTS idx_servicios_sin_llegada
  ON servicios (aceptado_en) WHERE estado = 'en_proceso' AND llegada_en IS NULL;
