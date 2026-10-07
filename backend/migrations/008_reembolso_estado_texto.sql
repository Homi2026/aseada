-- Flow informa el estado del reembolso como texto ('created', 'accepted',
-- 'rejected', 'refunded', 'cancelled'), no como numero. La columna de la 006
-- era INTEGER, asi que el primer aviso de Flow habria fallado al guardarse.
ALTER TABLE pagos ALTER COLUMN flow_refund_status TYPE TEXT USING flow_refund_status::text;

-- Para avisar una sola vez a los administradores cuando un reembolso sigue sin
-- confirmarse 72 horas despues de iniciado.
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS reembolso_alerta_en TIMESTAMPTZ;
