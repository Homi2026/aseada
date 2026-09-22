import { Alert, Platform } from 'react-native';

// En react-native-web, Alert.alert es una funcion vacia: no muestra nada ni
// ejecuta los botones. Todo lo que dependa de un Alert (confirmar, avisar un
// error, redirigir despues de guardar) se pierde en silencio en el navegador.
// Estas dos funciones usan los dialogos del navegador en web y los nativos en
// el celular.

const enWeb = Platform.OS === 'web';

export function avisar(titulo: string, mensaje = '') {
  if (enWeb) {
    window.alert(mensaje ? `${titulo}\n\n${mensaje}` : titulo);
    return;
  }
  Alert.alert(titulo, mensaje || undefined);
}

/** Pide confirmacion. Resuelve true si la persona acepta. */
export function confirmar(titulo: string, mensaje: string, textoAceptar = 'Aceptar'): Promise<boolean> {
  if (enWeb) return Promise.resolve(window.confirm(`${titulo}\n\n${mensaje}`));
  return new Promise((resolver) => {
    Alert.alert(titulo, mensaje, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolver(false) },
      { text: textoAceptar, onPress: () => resolver(true) },
    ], { cancelable: true, onDismiss: () => resolver(false) });
  });
}
