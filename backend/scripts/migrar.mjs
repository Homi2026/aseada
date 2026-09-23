// Aplica los archivos de migrations/ en orden, una sola vez cada uno.
//
// Correr con: npm run migrate
//
// Lleva registro en la tabla _migraciones, asi que es seguro repetirlo: los
// archivos ya aplicados se saltan. Cada migracion corre dentro de su propia
// transaccion, de modo que una que falle no deja la base a medio camino.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function archivosDeMigracion() {
  return readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * @param cliente cualquier objeto con .query(sql, params) — pg.Client en
 *   produccion, PGlite en las pruebas.
 * @param log donde reportar el avance.
 * @returns los nombres de archivo que se aplicaron en esta corrida.
 */
export async function migrar(cliente, log = console.log) {
  // Un archivo .sql trae varias sentencias en un solo string. pg las acepta
  // asi porque usa el protocolo simple; PGlite usa el extendido, que admite
  // una sola por llamada, y expone exec() para este caso.
  const ejecutarScript = (sql) =>
    typeof cliente.exec === 'function' ? cliente.exec(sql) : cliente.query(sql);

  await cliente.query(`CREATE TABLE IF NOT EXISTS _migraciones (
    archivo    TEXT PRIMARY KEY,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const { rows } = await cliente.query('SELECT archivo FROM _migraciones');
  const yaAplicadas = new Set(rows.map((r) => r.archivo));

  const aplicadas = [];
  for (const archivo of archivosDeMigracion()) {
    if (yaAplicadas.has(archivo)) {
      log(`  ·  ${archivo} (ya aplicada)`);
      continue;
    }
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    await cliente.query('BEGIN');
    try {
      await ejecutarScript(sql);
      await cliente.query('INSERT INTO _migraciones(archivo) VALUES($1)', [archivo]);
      await cliente.query('COMMIT');
      log(`  ✓  ${archivo}`);
      aplicadas.push(archivo);
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw new Error(`Fallo ${archivo}, no se aplico ningun cambio de ese archivo: ${error.message}`);
    }
  }
  return aplicadas;
}

// Solo al ejecutar el script directamente; al importarlo desde las pruebas no
// se conecta a ninguna base.
if (process.argv[1] && process.argv[1].endsWith('migrar.mjs')) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: ['.env.local', '.env'], quiet: true });

  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. Ponla en .env.local o exportala antes de correr el script.');
    process.exit(1);
  }

  const { default: pg } = await import('pg');
  const cliente = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // La cadena puede traer credenciales; mostrar solo el host.
  const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return 'la base configurada'; } })();
  console.log(`Aplicando migraciones en ${host}\n`);

  try {
    await cliente.connect();
    const aplicadas = await migrar(cliente);
    console.log(aplicadas.length
      ? `\nListo: ${aplicadas.length} migracion(es) aplicada(s).`
      : '\nListo: la base ya estaba al dia.');
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await cliente.end().catch(() => {});
  }
}
