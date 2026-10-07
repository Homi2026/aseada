-- Cuando el aseador no llega, antes el unico camino era un reclamo que un
-- admin tenia que revisar a mano. Ahora el cliente elige: reagendar con otro
-- aseador (hoy o manana), o pedir el reembolso. Si pide el reembolso, se
-- inicia solo via la API de Flow (refund/create) en vez de requerir que un
-- admin entre al panel de Flow a ejecutarlo.

-- Al reagendar, el aseador que no llego queda excluido de ese servicio: no
-- puede volver a tomarlo aunque siga en la bolsa de trabajos disponibles.
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS workers_excluidos INTEGER[] NOT NULL DEFAULT '{}';

-- Lo que necesita refund/getStatus para seguir el reembolso despues de
-- iniciarlo: el token que entrega Flow al crearlo, la orden propia, y el
-- ultimo estado que informo (numerico, igual que payment/getStatus).
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_refund_token TEXT;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_refund_order TEXT;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_refund_status INTEGER;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS flow_refund_status_en TIMESTAMPTZ;
