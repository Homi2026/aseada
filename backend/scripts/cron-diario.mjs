// Dispara el proceso diario de liberacion de pagos (GET /api/cron/diario).
//
// Pensado para un servicio de Railway separado del backend principal, con
// `deploy.cronSchedule` en railway.json: Railway lo arranca una vez al dia,
// corre este script y lo apaga. El backend en si sigue siendo un solo
// servicio siempre encendido; esto es solo el despertador.
//
// Necesita PUBLIC_URL (adonde pegarle) y CRON_SECRET (la misma que exige
// /api/cron/diario), tomadas de las variables del servicio.

const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const secreto = process.env.CRON_SECRET;

if (!base || !secreto) {
  console.error('Faltan PUBLIC_URL o CRON_SECRET en las variables de este servicio.');
  process.exit(1);
}

try {
  const res = await fetch(`${base}/api/cron/diario`, {
    headers: { Authorization: `Bearer ${secreto}` }
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`El backend respondio ${res.status}:`, cuerpo);
    process.exit(1);
  }
  console.log('Proceso diario OK:', cuerpo);
} catch (error) {
  console.error('No se pudo contactar al backend:', error.message);
  process.exit(1);
}
