import AsyncStorage from '@react-native-async-storage/async-storage';

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
