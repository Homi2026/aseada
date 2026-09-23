/**
 * En la web no hay token push: los avisos de trabajos nuevos los maneja la
 * pantalla del aseador con Notification del navegador y el sondeo cada 5 s.
 *
 * Este archivo existe para que el bundle web ni siquiera importe
 * expo-notificaciones: su build web lee localStorage al importarse, y eso
 * revienta el render estatico de `expo export --platform web` sobre Node 22+,
 * donde existe un localStorage global que no tiene getItem.
 */
export async function registrarNotificaciones(_token: string | null) {
  return;
}
