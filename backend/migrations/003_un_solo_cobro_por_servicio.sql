-- 003: un solo cobro vivo por servicio.
--
-- /api/pagos/crear creaba una orden nueva en Flow cada vez que se llamaba, y
-- el esquema aceptaba N pagos 'pagado' del mismo servicio. Un cliente que
-- tocaba "Pagar" dos veces pagaba dos veces; al liberar, los dos pagos
-- pasaban a 'liberado' pero se creaba UNA sola transferencia, asi que el
-- segundo cobro quedaba huerfano: nadie lo veia y nadie lo devolvia.
--
-- La ruta ya no crea la segunda orden. Esto es la red abajo: aunque el codigo
-- se equivoque, la base no deja que existan dos cobros vivos del mismo
-- servicio.

-- 'duplicado' es el cobro que llego de mas: esta cobrado en Flow y hay que
-- devolverlo a mano en su panel. Se distingue de 'rechazado' (Flow no lo
-- cobro) y de 'reembolsado' (la devolucion ya se decidio por un reclamo).
ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_estado_check;
ALTER TABLE pagos ADD CONSTRAINT pagos_estado_check
  CHECK (estado IN ('pendiente', 'pagado', 'rechazado', 'liberado', 'reembolsado', 'duplicado'));

ALTER TABLE pagos ADD COLUMN IF NOT EXISTS duplicado_en TIMESTAMPTZ;

-- Esta migracion corre sobre bases que ya pueden tener el cobro doble hecho:
-- sin limpiarlas primero, el indice unico no se puede crear. Queda vivo uno
-- solo por servicio y el resto pasa a 'duplicado', con su aviso, para que se
-- devuelvan.
--
-- Cual sobrevive: el mas antiguo, que es el que el cliente hizo de verdad
-- primero. Con una excepcion, los 'liberado': ese pago ya tiene una
-- transferencia al trabajador colgando, y marcarlo duplicado dejaria esa
-- transferencia apuntando a un cobro que decimos que hay que devolver.
--
-- Y el aviso se escribe aca mismo. Marcar el pago y nada mas dejaba la plata
-- del cliente etiquetada en una tabla que nadie mira: no hay ninguna ruta que
-- liste los pagos en 'duplicado', asi que un cobro de mas anterior a este
-- arreglo no aparecia en ningun lado. El camino de runtime (la confirmacion de
-- Flow en server.js) ya avisa a los administradores y al cliente; estos son los
-- mismos dos textos para los duplicados historicos.
WITH ordenados AS (
  SELECT id, row_number() OVER (
           PARTITION BY servicio_id
           ORDER BY (estado = 'liberado') DESC, creado_en ASC, id ASC
         ) AS puesto
  FROM pagos
  WHERE estado IN ('pagado', 'liberado')
),
marcados AS (
  UPDATE pagos SET estado='duplicado', duplicado_en=NOW()
  WHERE id IN (SELECT id FROM ordenados WHERE puesto > 1)
  RETURNING servicio_id, cliente_id, monto_total, flow_order
),
-- Los montos se escriben como los escribe la app: $39.990. to_char usaria el
-- separador de la configuracion regional de la base, que no es la chilena.
con_monto AS (
  SELECT m.*, '$' || regexp_replace(m.monto_total::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g') AS monto
  FROM marcados m
)
INSERT INTO notificaciones(usuario_id, tipo, titulo, mensaje)
SELECT a.id, 'pago_duplicado', 'Hay que devolver un cobro duplicado',
       'El servicio #' || c.servicio_id || ' se cobró dos veces. Devuelve ' || c.monto ||
       ' en el panel de Flow: orden ' || COALESCE(c.flow_order, 'sin registrar') || '.'
FROM con_monto c CROSS JOIN usuarios a
WHERE a.rol = 'admin' AND a.activo
UNION ALL
SELECT c.cliente_id, 'pago_duplicado', 'Te cobramos dos veces',
       'Recibimos dos pagos del servicio #' || c.servicio_id || '. Te devolvemos ' || c.monto ||
       '; Flow procesa la devolución en los próximos días.'
FROM con_monto c;

-- El indice que hace imposible el segundo cobro. Parcial: los 'pendiente',
-- 'rechazado', 'reembolsado' y 'duplicado' pueden repetirse todo lo que haga
-- falta; los que representan plata cobrada y no devuelta, no.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_uno_vivo_por_servicio
  ON pagos (servicio_id) WHERE estado IN ('pagado', 'liberado');
