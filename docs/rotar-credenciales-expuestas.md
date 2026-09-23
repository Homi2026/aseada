# Rotar las credenciales expuestas: las llaves de Flow y el `JWT_SECRET`

**Para:** Benjamín (necesita el panel de Flow, el panel de Vercel y permisos
de administrador en los repositorios de GitHub).
**Estado:** pendiente. Las credenciales siguen vivas y siguen siendo públicas.

## Qué pasó

El 20 de mayo de 2026 el commit `2c36c14` subió un archivo `.env` con las
llaves de producción de Flow **y con el `JWT_SECRET` de producción**. Estuvo
cuatro meses accesible públicamente y todavía está:

- en el historial de este monorepo (`gitleaks git .` lo encuentra: dos
  hallazgos, ambos en `.env` del commit `2c36c14`);
- en el repositorio archivado `github.com/Homi2026/aseada-backend`, donde un
  `curl` anónimo todavía descarga el archivo.

Borrar el archivo en un commit nuevo no sirve de nada: el contenido viejo
sigue en el historial y en cualquier clon que alguien haya hecho.

### Qué trae exactamente ese archivo

No son solo las llaves de pago. Esto es lo que devuelve hoy, sin
autenticarse:

```bash
curl -sS https://raw.githubusercontent.com/Homi2026/aseada-backend/2c36c14/.env
```

| Variable          | Valor            | Qué abre                                        |
| ----------------- | ---------------- | ----------------------------------------------- |
| `FLOW_API_KEY`    | real, 36 caract. | cobrar y consultar pagos en nombre de Aseada    |
| `FLOW_SECRET_KEY` | real, 40 caract. | firmar esas llamadas a Flow                     |
| `JWT_SECRET`      | real, 18 caract. | **firmar tokens de sesión de cualquier usuario**|
| `FLOW_API_URL`    | real             | nada: es la URL pública de Flow, no es secreto  |
| `PORT`            | real             | nada: es un número de puerto, no es secreto     |

El `JWT_SECRET` es tanto o más grave que las llaves de Flow, y por eso tiene
su propio paso más abajo. En `backend/server.js`, `firmarToken()` firma el
token con `{ id, email, rol, activo }` usando ese secreto y `verificarToken()`
lo valida con el mismo valor. Quien lo tenga se arma un token con
`rol: 'admin'` y `activo: true` sin pasar nunca por el login: entra al panel
de administración —activar aseadores, marcar transferencias, resolver
reclamos— y a toda la base de clientes. Rotar Flow y dejar este secreto sin
tocar deja la puerta abierta.

Haz los pasos en este orden. El 1 y el 1.b son los que de verdad cierran el
riesgo; los demás evitan que los mismos secretos sigan circulando.

---

## 1. Rotar las llaves en Flow y actualizarlas en Vercel

Esto es obligatorio **aunque después limpies el historial**. Las llaves ya son
públicas: cualquiera pudo copiarlas en estos cuatro meses, y limpiar el
historial no las desactiva.

1. Entra a https://www.flow.cl → **Configuración → API** y genera un par
   nuevo (API key + secret key).
2. Guárdalas en tu gestor de contraseñas. No las pegues en Slack, ni en
   WhatsApp, ni en un archivo del proyecto.
3. Actualiza las variables en el proyecto `aseada-backend` de Vercel. Los
   nombres exactos son `FLOW_API_KEY` y `FLOW_SECRET_KEY`:

   ```bash
   cd backend
   npx vercel login
   npx vercel link                 # elige el proyecto aseada-backend

   # Reemplazar el valor en produccion: primero se borra, despues se crea.
   npx vercel env rm FLOW_API_KEY production
   npx vercel env add FLOW_API_KEY production      # pega la llave nueva

   npx vercel env rm FLOW_SECRET_KEY production
   npx vercel env add FLOW_SECRET_KEY production   # pega el secreto nuevo
   ```

   También puedes hacerlo a mano en
   **Vercel → proyecto `aseada-backend` → Settings → Environment Variables**.

4. Vercel no re-despliega solo al cambiar una variable: hay que volver a
   desplegar para que el backend tome los valores nuevos.

   ```bash
   npx vercel --prod
   ```

5. Comprueba que los pagos siguen funcionando. Si faltara alguna variable, el
   backend arranca igual pero las rutas de pago responden 503 y el log dice
   cuál falta (`[aseada] faltan ...`). Haz un pago de prueba de punta a punta:
   crear servicio → pagar → que vuelva la confirmación de Flow.

6. En el panel de Flow, revisa el historial de transacciones de los últimos
   cuatro meses buscando cobros que no reconozcas.

---

## 1.b. Rotar el `JWT_SECRET`

Es tan obligatorio como el paso 1 y por el mismo motivo: el valor está en ese
mismo `.env` público. Mientras no cambie, cualquiera que lo haya copiado se
firma un token de administrador y entra sin contraseña.

**Antes de empezar, avisa.** Los tokens se firman con `expiresIn: '7d'`
(`firmarToken()` en `backend/server.js`) y no hay lista de revocación: al
cambiar el secreto **todas las sesiones abiertas se caen de una vez**
—clientes, aseadores y administradores— y cada persona tiene que volver a
entrar con su correo y su contraseña. Hazlo en horario de baja demanda y
avisa antes por el canal que uses con los aseadores.

1. Genera un secreto nuevo, largo y al azar. No inventes uno a mano:

   ```bash
   openssl rand -base64 48
   ```

2. Guárdalo en el gestor de contraseñas, igual que las llaves de Flow, y
   reemplaza la variable en producción:

   ```bash
   cd backend
   npx vercel env rm JWT_SECRET production
   npx vercel env add JWT_SECRET production        # pega el secreto nuevo
   ```

3. Vuelve a desplegar, por lo mismo que en el paso 1: Vercel no re-despliega
   solo al cambiar una variable.

   ```bash
   npx vercel --prod
   ```

   Si el paso 1 y este los haces juntos, cambia las tres variables y despliega
   una sola vez.

4. Comprueba que la sesión vieja quedó muerta y que se puede volver a entrar:
   con la app abierta de antes, cualquier pantalla que pegue al backend tiene
   que responder `401 Token invalido`; cerrando sesión y entrando de nuevo con
   correo y contraseña, tiene que funcionar.

5. Revisa si alguien ya usó el secreto viejo. Esto no se ve en el panel de
   Flow ni en una lista de sesiones: hay que mirar la base, y hay que mirar
   los **efectos**, no las cuentas.

   El detalle importa. Un token falsificado no necesita existir en la base:
   `verificarToken()` solo comprueba la firma y `exigirRol()` lee el `rol` que
   venía adentro del token, así que quien lo firmó entró con un `id` inventado
   y **no dejó ninguna fila nueva en `usuarios`**. Buscar
   «administradores que nadie creó» no alcanza; lo que sí queda registrado es
   lo que hizo:

   ```sql
   -- Aseadores activados desde el 20-05-2026 (la fecha del commit que filtro
   -- el secreto). Cada uno tiene que corresponder a una revision que alguien
   -- del equipo recuerda haber hecho.
   SELECT id, nombre, email, comuna, creado_en
     FROM usuarios
    WHERE rol = 'worker' AND activo = true AND creado_en >= '2026-05-20'
    ORDER BY creado_en;

   -- Transferencias marcadas como pagadas: si alguna dice 'transferido' y no
   -- hay plata saliendo de la cuenta que la respalde, la marco un tercero.
   SELECT id, worker_id, monto_a_transferir, transferido_en, referencia
     FROM transferencias_trabajador
    WHERE estado = 'transferido' AND transferido_en >= '2026-05-20'
    ORDER BY transferido_en;

   -- Reclamos resueltos: un reclamo cerrado sin que el cliente supiera es la
   -- otra forma de sacar plata con un token de administrador.
   SELECT id, cliente_id, worker_id, estado, reclamo_en, reclamo_motivo
     FROM servicios
    WHERE reclamo_en IS NOT NULL AND reclamo_en >= '2026-05-20'
    ORDER BY reclamo_en;

   -- Secundario, y por la DATABASE_URL mas que por el JWT_SECRET: el registro
   -- no acepta el rol 'admin', asi que una fila admin que nadie creo significa
   -- que alguien escribio directo en la base.
   SELECT id, email, rol, creado_en FROM usuarios WHERE rol = 'admin';
   ```

   Si algo de eso no cuadra, el incidente dejó de ser una exposición y pasó a
   ser un acceso: pára, deja registro de lo que encontraste y revísalo caso
   por caso antes de seguir con los pasos 2 y 3.

---

## 2. Cerrar los repositorios archivados

Mientras esos repos sigan públicos, el `.env` se sigue bajando aunque este
monorepo quede impecable.

- `github.com/Homi2026/aseada-backend`
- `github.com/Homi2026/aseada-app`

Para cada uno, en **Settings**:

1. Si está archivado, primero **Unarchive** (un repo archivado es de solo
   lectura y no deja cambiar la visibilidad).
2. **Danger Zone → Change repository visibility → Make private**. Si ya no
   los ocupa nadie, mejor **Delete this repository**: lo que no existe no se
   filtra.
3. Si lo dejaste privado, vuelve a archivarlo.

Ojo: poner un repo en privado **no borra los forks** que alguien haya hecho
mientras era público, ni el caché de los buscadores de código. Por eso los
pasos 1 y 1.b son los que mandan.

---

## 3. Limpiar el historial de este monorepo

Con `git filter-repo` (no con `filter-branch`, que está obsoleto y es lento).

```bash
# Instalar la herramienta, una sola vez
brew install git-filter-repo        # o: pip install git-filter-repo

# Trabaja sobre un clon fresco: filter-repo se niega a correr sobre un
# repositorio con cambios sin guardar, y asi conservas el original intacto.
git clone https://github.com/<organizacion>/<monorepo>.git aseada-limpio
cd aseada-limpio

# Borra el archivo .env de todos los commits del historial
git filter-repo --path .env --invert-paths

# Verifica que ya no aparezca en ningun commit
git log --all --oneline -- .env      # no debe imprimir nada

# filter-repo saca el remote a proposito, para que no empujes sin querer
git remote add origin https://github.com/<organizacion>/<monorepo>.git
git push --force --all
git push --force --tags
```

**Esto reescribe el historial.** Lo que implica:

- Todos los hashes de commit cambian. Cualquier clon que ya exista queda
  desincronizado y **hay que rehacerlo desde cero** (`git clone` de nuevo),
  no sirve un `git pull`.
- Los pull requests abiertos hay que rehacerlos.
- Los enlaces a commits que estén pegados en tickets, Slack o documentos
  dejan de funcionar.

Por eso conviene hacerlo **ahora, antes de sumar más gente al proyecto**:
mientras menos clones existan, menos gente tiene que rehacer su copia. Avisa
antes de empujar el force push.

---

## 4. Verificar que quedó cerrado

**Que el archivo ya no se descargue.** Este `curl` hoy baja el `.env`; cuando
el trabajo esté hecho tiene que devolver 404:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/Homi2026/aseada-backend/2c36c14/.env
```

Pruébalo **desde una sesión sin iniciar** (ventana de incógnito o `curl` sin
credenciales): si estás logueado y el repo quedó privado, a ti te va a
responder 200 igual.

**Que el historial del monorepo esté limpio.** El mismo escaneo que corre el
CI, a mano:

```bash
gitleaks git . --config gitleaks.toml --redact --no-banner
```

Tiene que decir `no leaks found`. Cuando así sea, borra el
`continue-on-error: true` del paso «Secretos en el historial» en
`.github/workflows/ci.yml`, para que de ahí en adelante un secreto en el
historial corte el build.

**Que el `JWT_SECRET` haya cambiado de verdad.** Un token emitido antes de la
rotación tiene que dejar de servir. Con uno guardado de antes:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <token viejo>" \
  https://aseada-backend.vercel.app/api/mis-servicios
```

Tiene que responder `401`. Si responde `200`, el despliegue del paso 1.b no
tomó el valor nuevo: vuelve a `npx vercel --prod` y revisa la variable en
**Settings → Environment Variables**.

**Que las llaves viejas estén revocadas.** En el panel de Flow, la sección de
API tiene que mostrar solo el par nuevo. Si Flow te deja ver la fecha de
creación o el último uso de cada llave, confirma que la vieja ya no registra
actividad. Si el panel no permite revocar explícitamente y solo regenera,
entonces regenerar **es** la revocación: la llave anterior deja de servir.

---

## 5. Lo que NO hay que hacer

- **No subas el `.env.local` que anda dando vuelta en el escritorio.** Trae la
  `DATABASE_URL` de Neon, `PGPASSWORD` y el `JWT_SECRET` de producción en
  texto plano. Con ese `JWT_SECRET` cualquiera firma un token de administrador
  válido; con la `DATABASE_URL`, cualquiera se conecta a la base de clientes.
  Y ojo con el orden: el `JWT_SECRET` de ese archivo es el mismo que ya está
  público en el `.env` del commit `2c36c14`, así que no es un riesgo futuro
  sino el que estás cerrando en el paso 1.b. Después de rotarlo, ese
  `.env.local` queda desactualizado: bájalo de nuevo con
  `npx vercel env pull .env.local` en vez de editarlo a mano.
- **No compartas la carpeta del proyecto por Drive, WeTransfer ni por correo.**
  Arrastrar la carpeta se lleva los archivos ocultos, `.env.local` incluido.
  Si necesitas pasarle el proyecto a alguien, que lo clone desde GitHub y las
  variables se las pasas aparte, por el gestor de contraseñas.
- **No pongas valores reales en `backend/.env.example`.** Ese archivo está en
  el repositorio a propósito, con los nombres y el valor vacío, y el escaneo
  de secretos lo tiene en la lista de excepciones justamente porque no debería
  traer nada adentro.
- **No arregles esto solo borrando el `.env` en un commit nuevo.** El
  contenido sigue en el historial; es exactamente el error que nos dejó cuatro
  meses expuestos.
