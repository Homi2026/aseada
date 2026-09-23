import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { API_URL } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registrarNotificaciones(token: string | null) {
  if (!token || !Constants.isDevice) return;

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  // Una sola base de API para toda la app: el host de Railway que habia aca
  // dejo de existir y los tokens push se perdian en silencio.
  await fetch(`${API_URL}/api/push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ push_token: pushToken }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('trabajos', {
      name: 'Trabajos disponibles',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}
