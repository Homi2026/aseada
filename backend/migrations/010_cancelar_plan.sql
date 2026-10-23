-- Un plan se puede cancelar: las visitas que todavia no tienen aseador se
-- devuelven y el plan queda 'cancelado'. Las visitas ya en curso o hechas
-- siguen su camino normal.
ALTER TABLE planes DROP CONSTRAINT IF EXISTS planes_estado_check;
ALTER TABLE planes ADD CONSTRAINT planes_estado_check
  CHECK (estado IN ('pendiente_pago', 'activo', 'rechazado', 'cancelado'));
ALTER TABLE planes ADD COLUMN IF NOT EXISTS cancelado_en TIMESTAMPTZ;
