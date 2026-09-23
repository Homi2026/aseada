# Aseada · app

Aplicación de Aseada: marketplace chileno de aseo del hogar y fumigación. Es un
solo proyecto **Expo SDK 51** (React 18.2 / React Native 0.74.5) que sirve tres
usos con las mismas pantallas:

- **Portada pública** (`src/app/landing.tsx`): qué es Aseada, precios y entrada
  a registro o login.
- **Cliente**: solicita un servicio, paga por Flow, sigue su historial, confirma
  el trabajo o reporta un problema.
- **Aseador y administración**: bolsa de trabajos, historial, ganancias y el
  panel de `/admin` (activar aseadores, transferencias y reclamos).

Lee la documentación de esa versión exacta del SDK antes de escribir código:
https://docs.expo.dev/versions/v51.0.0/. No subas el SDK ni agregues
dependencias que solo existan para versiones posteriores.

## Levantar el proyecto

```bash
npm install --legacy-peer-deps
npx expo start          # elige web, iOS o Android desde el menú
```

Verificaciones antes de entregar un cambio:

```bash
npx tsc --noEmit -p tsconfig.json
npx expo export --platform web
```

## Exportar la web

```bash
npx expo export --platform web   # deja el sitio estático en dist/
npx serve dist -l 19012          # prueba local del build final
```

El despliegue lo hace Vercel con esa misma orden: `vercel.json` define
`buildCommand`, `outputDirectory: dist` y `cleanUrls: true`.

## A qué API apunta

La base vive en `src/constants/api.ts` y es una sola para toda la app
(pantallas y token de notificaciones push):

1. `EXPO_PUBLIC_API_URL` si está definida.
2. `http://localhost:3000` cuando la web corre en `localhost` o `127.0.0.1`.
3. `https://aseada-backend.vercel.app` en cualquier otro caso.

El backend es el Express de `backend/` sobre PostgreSQL (Neon). Los pagos son
con **Flow** y ya están operativos en producción: el dinero del cliente queda
retenido y se libera al trabajador cuando el cliente confirma, o a las 24 horas
de marcado el servicio como terminado.

## Cosas del código que conviene saber

- **Los precios los calcula siempre el servidor** (`POST /api/calcular-precio`).
  No hay tabla de respaldo en la app: si un número se escribe a mano en la
  portada, tiene que existir en la tabla del servidor.
- **La cuenta de un aseador nace en revisión.** Hasta que un administrador la
  activa, el servidor responde 403 en las rutas de trabajador y la app muestra
  la pantalla de "cuenta en revisión" en vez de la bolsa.
- **La dirección del servicio no se muestra hasta aceptarlo**: en la bolsa los
  trabajos llegan con `direccion_visible: false` y sin el campo `direccion`.
- **Sesión vencida ≠ vacío.** `src/constants/api.ts` conserva el código HTTP en
  `ErrorApi`; un 401 manda al login y cualquier otro error muestra el estado de
  `src/components/estado-error.tsx` con botón de reintentar. Nunca dejes un
  `catch` que ponga la lista en `[]`.
- **Los diálogos van por `src/constants/dialogos.ts`** (`avisar`, `confirmar`):
  `Alert.alert` de React Native no hace nada en la web.
- **Deep link**: el esquema es `aseada://` (`app.json`), el mismo que arma el
  backend para las URLs de retorno de Flow.

## Pendiente de verdad

- **Notificaciones push en móvil**: `expo-notifications` está configurado, pero
  falta el `projectId` de EAS. Sin él, `registrarNotificaciones` no registra
  nada y el respaldo es el sondeo cada 5 segundos de la bolsa de trabajos. En
  la web, el aseador tiene que pulsar "Activar sonido" una vez por la
  restricción del navegador sobre reproducción automática.
- **Cuenta de redes sociales**: la portada no enlaza a Instagram porque la
  cuenta todavía no existe. Cuando se cree, va en el pie de `landing.tsx`.
- **Imagen para compartir**: `src/app/+html.tsx` tiene título, descripción y
  Open Graph, pero no `og:image`. Falta una imagen de marca de 1200×630.
- **Dominios**: `aseada.cl` para la portada y `app.aseada.cl` para la app
  operativa todavía están por configurar en el proveedor.
- **Modelo de pago al trabajador**: la app muestra ganancia bruta y un líquido
  estimado con retención referencial de honorarios (15,25%). La relación
  jurídica con el aseador (prestador independiente) debe validarse con un
  contador o abogado laboral en Chile antes de escalar.
