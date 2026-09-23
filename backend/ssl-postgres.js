// Como se conecta a Postgres, en un solo lugar.
//
// El servidor y los scripts (migrar, hacer-admin) hablan con la misma base de
// Neon. Cuando cada uno decidia por su cuenta si verificar el certificado, la
// decision se separo: server.js respetaba DB_SSL_NO_VERIFY y los scripts
// llevaban `rejectUnauthorized: false` escrito a mano, o sea que viajaban SIN
// verificar siempre — y el README manda correrlos contra produccion, con la
// DATABASE_URL de Neon y el hash de la contrasena de un admin adentro.
//
// Una sola fuente de verdad para que no vuelva a divergir.

/**
 * La opcion `ssl` que espera pg. Se verifica el certificado del servidor,
 * salvo que DB_SSL_NO_VERIFY sea 'true': esa es la marcha atras de un solo
 * paso para un ambiente con certificado propio (ver .env.example).
 */
function sslPostgres(env = process.env) {
  return { rejectUnauthorized: env.DB_SSL_NO_VERIFY !== 'true' };
}

/** Deja el aviso en el log cuando se anduvo sin verificar el certificado. */
function avisarSiNoVerifica(env = process.env, log = console.warn) {
  if (env.DB_SSL_NO_VERIFY === 'true') {
    log('[aseada] DB_SSL_NO_VERIFY=true: la conexion a Postgres no verifica el certificado del servidor.');
  }
}

module.exports = { sslPostgres, avisarSiNoVerifica };
