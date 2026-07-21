import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Registers this device for "tournament starting soon" push alerts. Safe to
// call every time the Lobby mounts - it's a no-op once a token is already
// saved, and fails quietly (never throws to the caller) on web, simulators,
// or a project with no EAS project ID configured yet (`eas init` sets that
// up; until then Expo can't issue a push token, so this just skips).
export async function registerForPushNotificationsAsync(): Promise<void> {
  try {
    if (Platform.OS === 'web') return; // Native push only - the Lobby's in-app countdown covers web for now.
    if (!Device.isDevice) return; // Simulators/emulators can't receive push.

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn(
        'Push notifications: no EAS project ID configured (run `eas init`) - skipping push token registration.'
      );
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) {
      await supabase.rpc('update_push_token', { p_token: token });
    }
  } catch (err) {
    // Never let a push-registration hiccup block the player from using the app.
    console.warn('Push notification registration failed:', (err as Error).message);
  }
}
