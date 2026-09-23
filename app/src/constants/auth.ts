import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

import { ErrorApi } from './api';

export const guardarSesion = async (token: string, usuario: any) => {
  await AsyncStorage.setItem('token', token);
  await AsyncStorage.setItem('usuario', JSON.stringify(usuario));
};

export const obtenerSesion = async () => {
  const token = await AsyncStorage.getItem('token');
  const usuario = await AsyncStorage.getItem('usuario');
  return { token, usuario: usuario ? JSON.parse(usuario) : null };
};

export const cerrarSesion = async () => {
  await AsyncStorage.removeItem('token');
  await AsyncStorage.removeItem('usuario');
};

/**
 * Devuelve la sesion y falla como 401 si no hay token. Asi "nunca inicie
 * sesion" y "se me vencio la sesion" terminan en el mismo lugar: el login.
 */
export const exigirSesion = async () => {
  const { token, usuario } = await obtenerSesion();
  if (!token) throw new ErrorApi('Tu sesión terminó. Vuelve a iniciar sesión.', 401);
  return { token, usuario };
};

/** Borra la sesion local y manda al login. Para cuando el token ya no sirve. */
export const volverAlLogin = async () => {
  await cerrarSesion();
  router.replace('/login');
};
