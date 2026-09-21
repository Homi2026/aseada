import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registrarNotificaciones(token: string | null) {
  if (!token || Platform.OS === 'web' || !Constants.isDevice) return;

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await fetch(`${process.env.EXPO_PUBLIC_API_URL || 'https://aseada-backend-production.up.railway.app'}/api/push-token`, {
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
