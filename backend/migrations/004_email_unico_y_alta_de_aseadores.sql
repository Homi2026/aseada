-- 004: un email = una cuenta, y el alta de aseadores pasa por revision.
--
-- Dos arreglos que tocan la misma tabla.

-- ─── 1. El email dejaba entrar dos cuentas de la misma persona ─────────────
--
-- /auth/registro y /auth/login comparaban `email=$1`, y Postgres distingue
-- mayusculas de minusculas en TEXT: c@t.cl y C@T.CL eran dos cuentas
-- distintas. La persona se registraba, al dia siguiente escribia su correo de
-- otra forma y "no existia"; peor, podia registrarse de nuevo y quedarse con
-- dos historiales de servicios y de pagos.
--
-- El indice idx_usuarios_email sobre LOWER(email) ya existia desde la 000,
-- pero no era unico y ninguna consulta lo usaba. server.js ahora normaliza a
-- minusculas y consulta por LOWER(email); esto es la red abajo.

-- Primero las colisiones que la base ya pueda tener. Sin esto, el CREATE
-- UNIQUE INDEX falla con "could not create unique index ... Key (lower(email))
-- is duplicated", que no dice a quien hay que arreglar ni que hacer.
DO $$
DECLARE
  repetidos TEXT;
BEGIN
  SELECT string_agg(email_normalizado || ' (' || cuentas || ' cuentas)', ', ' ORDER BY email_normalizado)
    INTO repetidos
    FROM (
      SELECT LOWER(email) AS email_normalizado, COUNT(*) AS cuentas
        FROM usuarios
       GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
    ) AS colisiones;

  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede crear el indice unico de email: hay cuentas que solo se diferencian por mayusculas (%). Decide cual se queda, mueve o borra las otras, y vuelve a correr `npm run migrate`.', repetidos;
  END IF;
END $$;

-- El unico ya cubre las busquedas del login, asi que el indice anterior sobra.
DROP INDEX IF EXISTS idx_usuarios_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_unico ON usuarios (LOWER(email));

-- ─── 2. Los aseadores nacen inactivos ──────────────────────────────────────
--
-- Cualquiera podia registrarse con rol 'worker' y ver al instante la bolsa de
-- trabajos pagados CON la direccion completa de cada cliente. Para un servicio
-- a domicilio ese era el riesgo de producto mas grave del sistema.
--
-- El DEFAULT de la columna `activo` NO se cambia a proposito: lo usan tambien
-- clientes y administradores, que si entran activos. Quien decide es
-- /auth/registro, que inserta activo = (rol <> 'worker'). Los aseadores que ya
-- estaban en la base quedan como estaban: se revisan desde
-- GET /api/admin/workers y se activan con POST /api/admin/workers/:id/activar.

-- La cola de revision lee justamente los que estan inactivos; el indice de la
-- 000 (idx_usuarios_workers_activos) es parcial sobre WHERE activo y no sirve
-- para esta.
CREATE INDEX IF NOT EXISTS idx_usuarios_workers_en_revision
  ON usuarios (rol, creado_en) WHERE NOT activo;
