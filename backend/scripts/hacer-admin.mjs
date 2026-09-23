// Da el rol de administrador a una cuenta ya registrada.
//
// Correr con: npm run hacer-admin -- tu@email.cl
//
// El registro publico solo acepta cliente y worker, asi que esta es la unica
// forma de crear un administrador: requiere acceso a la base.

import pg from 'pg';
import dotenv from 'dotenv';
// La misma regla TLS que el servidor: este script corre contra produccion con
// la DATABASE_URL de Neon, asi que no puede ir sin verificar el certificado.
import { sslPostgres } from '../ssl-postgres.js';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Uso: npm run hacer-admin -- tu@email.cl');
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Corre primero: npx vercel env pull .env.local');
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: url, ssl: sslPostgres() });
try {
  await cliente.connect();
  const { rows } = await cliente.query(
    "UPDATE usuarios SET rol='admin' WHERE LOWER(email)=$1 RETURNING nombre, email", [email]);
  if (rows.length === 0) {
    console.error(`No existe una cuenta con ${email}. Regístrate primero en la app.`);
    process.exitCode = 1;
  } else {
    console.log(`Listo: ${rows[0].nombre} (${rows[0].email}) ahora es administrador.`);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exitCode = 1;
} finally {
  await cliente.end().catch(() => {});
}
