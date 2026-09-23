# Aseada

Marketplace chileno de aseo del hogar y fumigación: un cliente pide un
servicio, un aseador lo toma, el cliente paga por Flow y la plataforma libera
el pago al trabajador cuando el servicio queda completado.

Este es un monorepo con dos piezas que se despliegan por separado:

| Carpeta    | Qué es                                                        | Desplegado en                          |
| ---------- | ------------------------------------------------------------- | -------------------------------------- |
| `backend/` | API en Express 5 sobre Postgres (Neon). Pagos por Flow.        | https://aseada-backend.vercel.app      |
| `app/`     | App en Expo SDK 51 (React Native 0.74.5), exportada a web.     | https://dist-wheat-pi-45.vercel.app    |

Web y móvil usan el mismo backend: `backend/api/index.js` expone en Vercel la
misma app de Express que corre `node server.js` en local. La URL del backend
que consume la app vive en `app/src/constants/api.ts`.

## Antes de empezar

- Node 22 o superior (es la versión con la que corre el CI).
- Una base Postgres con su `DATABASE_URL`. En producción es Neon; para
  desarrollo sirve cualquier Postgres.
- Las variables de entorno del backend. La lista canónica, con qué hace cada
  una y cuáles son obligatorias, está en `backend/.env.example` — cópialo a
  `backend/.env` y rellénalo. No la dupliques acá ni en ningún otro lado.

Sin `JWT_SECRET` y `DATABASE_URL` el servidor no arranca a propósito. Las de
Flow son opcionales: si faltan, el backend levanta igual y solo las rutas de
pago responden 503.

## Levantar el backend

```bash
cd backend
npm install
cp .env.example .env      # y rellena JWT_SECRET y DATABASE_URL
npm run migrate           # aplica migrations/ en orden
npm start                 # http://localhost:3000
```

`npm run migrate` lleva registro en la tabla `_migraciones`, así que repetirlo
es seguro: los archivos ya aplicados se saltan. Cada migración corre en su
propia transacción, o sea que una que falle no deja la base a medio camino.

## Levantar la app

```bash
cd app
npm install --legacy-peer-deps
npm run web               # Expo en el navegador
```

`--legacy-peer-deps` no es opcional: es lo mismo que usa `app/vercel.json`
para el build de producción. Sin eso npm se cae resolviendo los peers de
React 18.2.

Para probar el build final tal como queda publicado:

```bash
npx expo export --platform web
npx serve dist -l 19012
```

**No subas la versión del SDK.** La app está fijada a Expo SDK 51 / React 18.2
y eso está escrito en `app/AGENTS.md`. Si una dependencia solo existe para SDK
52 o superior, no va.

## Correr los tests

```bash
cd backend
npm test
```

Son `node:test` nativos, sin dependencias extra, y levantan un Postgres real
en memoria (pglite) donde aplican las migraciones y corren contra ellas las
mismas consultas que usa `server.js`. La batería completa toma unos 35
segundos. Cúbrelos antes de pushear: el mismo CI los corre en cada push y en
cada pull request.

La app no tiene tests todavía; lo que el CI verifica es que compile:

```bash
cd app
npx tsc --noEmit
```

## Crear un administrador

El registro público solo acepta los roles `cliente` y `worker`. Para que una
cuenta ya registrada pase a `admin`:

```bash
cd backend
npm run hacer-admin -- tu@email.cl
```

Necesita `DATABASE_URL` apuntando a la base donde está esa cuenta. Si vas a
tocar producción, bájate las variables con `npx vercel env pull .env.local`.

## Integración continua

`.github/workflows/ci.yml` corre en los pushes a `main` y en cada pull
request, con tres jobs en paralelo:

- **backend**: `npm ci && npm test`
- **app**: `npm ci --legacy-peer-deps`, después `npx tsc --noEmit` y después
  `npx expo export --platform web`
- **secretos**: gitleaks sobre todo el repositorio, con `gitleaks.toml` en la
  raíz como configuración

El push va acotado a `main` a propósito: sin ese filtro, un pull request que
sale de una rama de este mismo repositorio dispara los tres jobs dos veces y
las dos corridas no se cancelan entre sí, porque quedan en grupos de
`concurrency` distintos.

La app no tiene tests todavía; lo que el CI verifica son los tipos y que el
export web de Expo termine bien. El export no es decorativo: `tsc` tarda un
segundo y solo mira los tipos, mientras que `npx expo export --platform web`
es textualmente el `buildCommand` de `app/vercel.json`, así que es el único
paso que prueba lo que Vercel va a construir de verdad.

El escaneo de secretos tampoco es decorativo: el 20 de mayo de 2026 se subió
un `.env` con las llaves de producción de Flow **y con el `JWT_SECRET` de
producción**, y estuvo cuatro meses accesible públicamente. Nada de eso se ha
rotado todavía. Con ese `JWT_SECRET` cualquiera se firma un token de
administrador válido, así que es tan urgente como las llaves de pago. El
runbook para arreglarlo está en
[`docs/rotar-credenciales-expuestas.md`](docs/rotar-credenciales-expuestas.md)
y hay que ejecutarlo.

## Despliegue

Los dos proyectos están en Vercel y se despliegan solos desde la rama por
defecto:

- **backend** → `aseada-backend.vercel.app`. `backend/vercel.json` reescribe
  todas las rutas hacia `/api` y define el cron diario
  (`/api/cron/diario`, 12:00 UTC) que libera los pagos a los trabajadores.
  Ese cron va protegido con `CRON_SECRET`.
- **app** → `dist-wheat-pi-45.vercel.app`. Build: `npx expo export --platform
  web`, salida en `dist/`.

Las variables de entorno de producción se configuran en el panel de Vercel de
cada proyecto, nunca en un archivo del repositorio.
