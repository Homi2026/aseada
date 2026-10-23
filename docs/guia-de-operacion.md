# Guía de operación de Aseada

Para quien administra Aseada día a día (hoy Benjamín y Matías). Explica qué
hace el sistema solo, qué hay que hacer a mano y dónde.

- Panel de administración: https://web-production-d6ba2.up.railway.app/admin
- Estado del servidor: https://backend-production-a2494.up.railway.app/health
- Correo de soporte que ven los clientes: soporteaseada@gmail.com

## Rutina diaria (10 minutos)

Entra al panel y revisa, de arriba hacia abajo:

1. **Avisos.** Todo lo que pasó desde la última vez: pagos recibidos, reclamos,
   devoluciones sin confirmar, servicios sin aseador. Márcalos como leídos
   cuando los hayas atendido.
2. **Aseadores por activar.** Un aseador nuevo no ve la bolsa de trabajos hasta
   que lo actives. Revisa que tenga comuna, experiencia y datos bancarios.
3. **Por transferir hoy.** Pagos que ya están liberados y que Flow ya depositó.
   Transfiere a cada aseador desde la cuenta de Aseada (hoy Mercado Pago), anota la referencia de la
   transferencia y aprieta "marcar transferida": al aseador le llega el aviso.
4. **Reclamos.** Lee el motivo, contacta a las partes si hace falta y decide:
   *Pagar al trabajador* (el servicio se hizo bien) o *Devolver al cliente*.
   La devolución de un reclamo **no** sale sola: después hay que hacerla en el
   panel de Flow con la orden que indica el sistema.
5. **Devoluciones en curso.** Las que pidió un cliente o salieron de cancelar un
   plan. Prometemos devolver en máximo 72 horas: si una lleva más, o Flow no la
   aceptó, revísala en el panel de Flow y contacta al cliente.
6. **En la bolsa sin aseador.** Servicios pagados que nadie tomó. Si uno lleva
   muchas horas, contacta aseadores para que lo tomen o al cliente para
   ofrecerle la devolución.
7. **Planes activos.** Solo para cancelar cuando un cliente lo pide por soporte
   (ver más abajo).

## Lo que el sistema hace solo

Corre cada 30 minutos:

| Qué | Cuándo |
|---|---|
| Libera el pago al aseador | 24 horas después de que marcó "terminado", si el cliente no confirmó ni reclamó |
| Marca los pagos listos para transferir | Cuando llega la fecha de depósito de Flow |
| Levanta un reclamo "no llegó nadie" | Si el aseador no marcó "llegué" 2 horas después de aceptar |
| Publica las visitas de un plan | El día que le toca a cada una |
| Avisa servicio sin aseador | 4 horas después de que llegó su día sin que nadie lo tome |
| Avisa devolución sin confirmar | 72 horas después de iniciada, si Flow no la confirma |

Cuando nadie llega, el cliente elige solo: reagendar (hoy o mañana, con otro
aseador) o pedir la devolución, que se inicia sola en Flow. Esto solo aplica si
el sistema comprueba que nadie llegó; si el aseador sí marcó su llegada, el
reclamo pasa a tu revisión.

## Tareas de soporte

**Olvidó su contraseña.** El cliente o aseador escribe a soporte. Verifica que
el correo venga de la misma dirección de la cuenta, entra al panel →
*Restablecer contraseña*, escribe el email y genera una clave temporal. Envíasela
y pídele que la cambie desde su perfil. La clave se muestra una sola vez.

**Cancelar un plan.** El cliente lo pide por soporte. En *Planes activos*,
aprieta *Cancelar visitas pendientes y devolver*: se cancelan las visitas que aún
no tienen aseador y se pide a Flow un solo reembolso por su total. Las visitas en
curso o ya hechas no cambian.

**Crear otro administrador.** La persona se registra en la web como cliente.
Después, desde la carpeta `backend`, con acceso a Railway:
`npx @railway/cli ssh --service backend -- npm run hacer-admin -- su@email.cl`.
Tiene que cerrar sesión y volver a entrar.

## Despliegues

- Todo lo que se sube a `main` en GitHub se despliega solo en Railway.
- El backend aplica sus migraciones de base de datos solo al arrancar. Si una
  falla, el sitio sigue funcionando y `/health` la muestra pendiente.
- La web a veces no se reconstruye sola. Si un cambio no aparece:
  `npx @railway/cli redeploy --service web --from-source --yes`.
- Después de cada despliegue, revisa `/health`: tiene que decir `"ok":true`.

## Si algo se filtra

Si una llave queda expuesta (en GitHub, en un incidente del proveedor, etc.),
rótala de inmediato: ver `docs/rotar-credenciales-expuestas.md`. En Railway las
llaves viven en el servicio `backend` → Variables. La Secret Key de Flow se
regenera en Flow → Configuración → Datos de integración.

## Pendientes antes de abrir a clientes reales

- Crear la cuenta de Gmail soporteaseada@gmail.com.
- Poner en Railway la Secret Key de Flow regenerada después del incidente de
  Railway de octubre de 2026.
- Quitar el acceso público (TCP Proxy) de la base de datos en Railway.
- Hacer un pago de prueba real de punta a punta (y su devolución).
- Revisión de los términos y la política de privacidad por un abogado, con la
  razón social y el RUT cuando exista la SpA.
- Consulta al contador: IVA sobre la comisión o sobre el total, y régimen
  tributario.
