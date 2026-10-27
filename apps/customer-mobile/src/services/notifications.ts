/**
 * Expo Push Notification Service
 *
 * Manages push notification permissions and device token registration.
 * Persists push tokens to the dedicated public.push_tokens table and syncs
 * with customer profile for instant alerts (confirmations, reminders, queue callouts).
 *
 * Privacy Safeguards:
 * Strictly receives privacy-safe alerts without patient names or medical conditions.
 *
 * Denial & Offline Tolerance:
 * When permission is denied, the in-app state (HomeScreen live card and Booking Pass)
 * remains the live, authoritative source of truth.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './api';

declare const process: { env: Record<string, string | undefined> };
declare const __DEV__: boolean | undefined;

let cachedPushToken: string | null = null;

const isProduction =
  typeof __DEV__ !== 'undefined'
    ? !__DEV__
    : typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

// Configure default notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Checks if a push token is synthetic/mocked
 */
export function isMockPushToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return /\[(tpt_|mock_|fake_|test_)/i.test(token);
}

/**
 * Validates genuine Expo push token format
 */
export function isValidProductionPushToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const isExpoFormat = /^ExponentPushToken\[[a-zA-Z0-9_-]+\]$/.test(token);
  return isExpoFormat && !isMockPushToken(token);
}

export type PushPermissionResult = {
  token: string | null;
  status: 'granted' | 'denied' | 'undetermined';
  denied: boolean;
};

/**
 * Register device for push notifications and sync token with push_tokens table
 * Prompted at a sensible moment (e.g. after booking confirmation or viewing booking pass)
 */
export async function registerForPushNotificationsAsync(
  customerId?: string
): Promise<string | null> {
  const result = await requestPushPermissionWithStatus(customerId);
  return result.token;
}

/**
 * Requests push permission, retrieves native token, and saves to database.
 * Returns detailed status so UI can gracefully handle denial.
 */
export async function requestPushPermissionWithStatus(
  customerId?: string
): Promise<PushPermissionResult> {
  try {
    // 1. Android specific notification channel setup
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Appointments & Queue Updates',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#059669',
          sound: 'default',
        });
      } catch (err) {
        console.warn('[PushNotification] Error setting android notification channel:', err);
      }
    }

    // 2. Physical device check
    if (Platform.OS !== 'web' && !Device.isDevice) {
      console.log('[PushNotification] Must use physical device for real push notifications');
      if (isProduction) {
        return { token: null, status: 'undetermined', denied: false };
      }
    }

    // 3. Permission Request
    let finalStatus: Notifications.PermissionStatus = Notifications.PermissionStatus.UNDETERMINED;

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.Notification !== 'undefined') {
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
          const webPerm = await Notification.requestPermission().catch(() => 'denied');
          finalStatus = webPerm === 'granted'
            ? Notifications.PermissionStatus.GRANTED
            : Notifications.PermissionStatus.DENIED;
        } else {
          finalStatus = Notification.permission === 'granted'
            ? Notifications.PermissionStatus.GRANTED
            : Notifications.PermissionStatus.DENIED;
        }
      }
    } else {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      finalStatus = existingStatus;

      if (existingStatus !== Notifications.PermissionStatus.GRANTED) {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
    }

    if (finalStatus !== Notifications.PermissionStatus.GRANTED) {
      console.log('[PushNotification] Permission not granted. In-app status remains primary source of truth.');
      return { token: null, status: 'denied', denied: true };
    }

    // 4. Token Acquisition
    let token: string | null = null;

    if (Platform.OS !== 'web' && Device.isDevice) {
      try {
        const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
        const pushTokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );
        token = pushTokenData.data;
      } catch (tokenErr) {
        console.warn('[PushNotification] Error getting native push token:', tokenErr);
      }
    }

    // Dev/Simulator mock token fallback when genuine token unavailable
    if (!token && !isProduction) {
      token = cachedPushToken || `ExponentPushToken[tpt_${(customerId || 'guest').substring(0, 8)}_${Date.now().toString(36)}]`;
    }

    cachedPushToken = token;

    // 5. Persist to dedicated public.push_tokens table
    if (token) {
      if (isProduction && !isValidProductionPushToken(token)) {
        console.warn('[PushNotification] Refusing to persist mock push token to production profile');
        return { token: null, status: 'granted', denied: false };
      }

      try {
        // Upsert into dedicated push_tokens table (RLS ensures user can only insert/update own token)
        await supabase
          .from('push_tokens')
          .upsert(
            {
              token,
              device_type: Platform.OS,
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: 'user_id,token' }
          );

        // Also update legacy profile column for backwards compatibility
        if (customerId) {
          await supabase
            .from('profiles')
            .update({ expo_push_token: token } as any)
            .eq('id', customerId);
        }
      } catch (dbErr) {
        console.warn('[PushNotification] Token persistence error (non-fatal):', dbErr);
      }
    }

    return {
      token,
      status: 'granted',
      denied: false,
    };
  } catch (err) {
    console.warn('[PushNotification] Registration error:', err);
    return { token: null, status: 'undetermined', denied: false };
  }
}

/**
 * Configure push notification listeners and deep-linking to the ticket screen
 */
export function setupNotificationListeners(
  onNavigateToTicket: (bookingId: string) => void
): () => void {
  // 1. Foreground notification received listener
  const notificationSubscription = Notifications.addNotificationReceivedListener((notification) => {
    console.log('[PushNotification] Notification received in foreground:', notification.request.content.title);
  });

  // 2. Notification response (tap) listener for deep-linking
  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    const bookingId = typeof data?.booking_id === 'string' ? data.booking_id : undefined;
    if (bookingId && typeof onNavigateToTicket === 'function') {
      console.log('[PushNotification] Deep-linking to ticket:', bookingId);
      onNavigateToTicket(bookingId);
    }
  });

  return () => {
    notificationSubscription.remove();
    responseSubscription.remove();
  };
}

/**
 * Present a local in-app alert or browser notification
 */
export function showInAppNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body,
            icon: '/favicon.ico',
            data,
          });
          return;
        } catch {
          // Continue to console fallback
        }
      }
    }
  } else {
    Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
      },
      trigger: null, // immediate
    }).catch(() => null);
  }

  console.log(`[PUSH NOTIFICATION] 🔔 ${title}: ${body}`, data || '');
}

/**
 * Push service diagnostics
 */
export function getPushServiceStatus(): {
  supported: boolean;
  token: string | null;
  provider: 'expo-push-free';
} {
  return {
    supported: true,
    token: cachedPushToken,
    provider: 'expo-push-free',
  };
}
