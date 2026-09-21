# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Publicar Aseada en la web

La aplicación ya genera una web estática lista para desplegar:

```bash
npx expo export --platform web
```

El resultado queda en `dist/`. La estructura recomendada para el producto es:

- `aseada.cl`: portada pública y presentación del servicio.
- `app.aseada.cl`: aplicación operativa con login, registro y solicitudes.
- API web: backend serverless desplegado en `https://aseada-backend.vercel.app`, configurado en `src/constants/api.ts`.
- Persistencia: PostgreSQL (Neon) conectado al proyecto `aseada-backend`. El esquema vive en `aseada-backend/migrations/`.

Para una prueba local del build final:

```bash
npx serve dist -l 19012
```

Antes de publicar, configurar el dominio personalizado en el proveedor elegido y verificar que `app.aseada.cl` apunte al hosting de la carpeta `dist`. La cuenta de Instagram debe crearse manualmente con el nombre de marca disponible y luego reemplazar el enlace provisional de la portada.

### Un solo backend

Web y móvil usan el mismo backend: la app de Express en `aseada-backend/server.js`, sobre PostgreSQL.

- En Vercel, `aseada-backend/api/index.js` exporta esa misma app y `vercel.json` reescribe todas las rutas hacia ella.
- En local, `node server.js` levanta la app en el puerto 3000.

Antes había tres implementaciones en paralelo —el `server.js` de PostgreSQL y dos copias distintas de un handler sobre Vercel Blob, una en cada repositorio, que ya se habían desincronizado entre sí—. Las de Blob se eliminaron: cubrían 8 de las 22 rutas y dejaban la web sin pagos, sin `completar servicio` y sin calificaciones.

Para levantar un ambiente nuevo:

1. Crear la base PostgreSQL y dejar `DATABASE_URL` disponible.
2. Aplicar el esquema: `cd aseada-backend && npm run migrate`. El runner lleva registro en la tabla `_migraciones`, así que repetirlo es seguro.
3. Configurar `JWT_SECRET` y, si se van a cobrar pagos, `FLOW_API_KEY`, `FLOW_SECRET_KEY` y `PUBLIC_URL`. Las dos primeras variables son obligatorias: sin ellas el servidor no arranca.

`npm test` levanta un PostgreSQL en memoria y verifica que el esquema siga en sintonía con las consultas de `server.js`.

## Join the community

Join our community of developers creating universal apps.


### Criterio inicial de fumigación

La primera tarifa referencial busca entrar por debajo de una visita técnica completa y mantener margen para el aseador:

- Insectos: desde $39.900 base.
- Roedores: desde $49.900 base.
- Insectos y roedores: desde $59.900 base.
- El cliente ve además una comisión de plataforma del 20%.
- El IVA se calcula al 19% sobre la comisión de Aseada y aparece separado en el resumen.

La competencia se divide en dos grupos: empresas especializadas de control de plagas, que suelen vender visitas técnicas y tratamientos completos, y marketplaces de servicios, que compiten por rapidez y precio. Aseada puede diferenciarse combinando la confianza del marketplace con precio transparente antes de solicitar, perfiles de aseadores y seguimiento del servicio. Estas tarifas deben validarse con cotizaciones reales por comuna, costo de insumos y requisitos sanitarios antes de convertirlas en precios definitivos.

### Modelo de pagos al trabajador

La pantalla del aseador muestra `ganancia bruta estimada`. No debe prometer un monto neto hasta definir la relación jurídica y tributaria:

- **Prestador independiente:** contrato de prestación de servicios, verificación de identidad, datos bancarios, boleta de honorarios y retención/emisión según las reglas vigentes del SII. El pago se libera después de que el servicio se marca como completado y el cliente confirma o vence un plazo de revisión.
- **Trabajador dependiente:** contrato de trabajo, remuneración, jornada, cotizaciones previsionales, seguro de accidentes y demás obligaciones laborales. En este modelo Aseada debe operar como empleador o mediante una empresa formal que lo sea.
- **Intermediación:** contrato claro entre cliente, aseador y Aseada, política de cancelación, comprobante de pago y trazabilidad del estado `pendiente`, `en revisión`, `aprobado` y `pagado`.

La implementación actual no calcula retenciones ni libera dinero automáticamente: solo muestra la ganancia bruta. Antes de cobrar en producción hay que validar el modelo con un contador o abogado laboral en Chile, especialmente si Aseada fija horarios, instrucciones, supervisión o sanciones, porque esos elementos pueden configurar relación laboral aunque el contrato diga “independiente”.

### Decisión de precios

No recomiendo reducir toda la tabla un 5% todavía. La comisión e IVA ya elevan el total del cliente, pero bajar permanentemente el precio reduce el margen disponible para soporte, pagos, seguros, reclamos y adquisición de clientes. Es preferible probar un lanzamiento con 5% de descuento limitado a los primeros servicios o a una comuna, medir conversión, aceptación de trabajadores y margen real, y luego ajustar por categoría.

### Notificaciones de trabajos

Al crear un servicio, el backend intenta crear una notificación para cada aseador activo. En web, el panel del aseador consulta nuevos trabajos cada cinco segundos y puede mostrar una notificación del navegador. Para iOS y Android todavía falta conectar Expo Notifications con credenciales de producción; el polling seguirá funcionando como respaldo.

En la web publicada, el trabajador debe pulsar `Activar sonido` una vez para cumplir la restricción del navegador sobre reproducción automática. Desde ese momento, cada nuevo trabajo puede generar un aviso visual y un sonido. En móviles, `expo-notifications` ya está instalado y configurado; falta definir el `projectId` de EAS y desplegar el backend con PostgreSQL para enviar los tokens push reales.
