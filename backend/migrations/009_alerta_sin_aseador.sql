-- Un servicio pagado que nadie acepta quedaba en la bolsa para siempre: el
-- cliente esperando y nadie enterado. buscando_desde marca cuando entro a la
-- bolsa (pago confirmado, reagendamiento o visita de plan publicada), y
-- sin_aseador_alerta_en evita avisar mas de una vez por cada busqueda.
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS buscando_desde TIMESTAMPTZ;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS sin_aseador_alerta_en TIMESTAMPTZ;

-- Los que ya estan en la bolsa: desde que se pago, o desde que se creo.
UPDATE servicios s SET buscando_desde = COALESCE(
  (SELECT MAX(p.pagado_en) FROM pagos p WHERE p.servicio_id = s.id), s.creado_en)
WHERE s.estado = 'buscando_worker' AND s.buscando_desde IS NULL;
