/**
 * ConsentScreen.tsx
 *
 * DPDP Act 2023 (India) — Section 6 compliance screen.
 * Must be shown on first launch BEFORE any data collection.
 *
 * Rules:
 *  - Each consent purpose has its own separate toggle (no bundled checkboxes)
 *  - Required consents cannot be skipped to use the app
 *  - Optional consents must be pre-set to OFF (opted-out by default)
 *  - The consent version is stored server-side for audit
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { supabase } from '../services/api';

const CONSENT_VERSION = '1.0';

interface ConsentItem {
  purpose: string;
  label: string;
  description: string;
  required: boolean;
  default: boolean;
}

const CONSENTS: ConsentItem[] = [
  {
    purpose: 'phone_otp',
    label: 'Phone Number for Authentication',
    description: 'We use your phone number to send a one-time password so you can log in securely. This is required to use the app.',
    required: true,
    default: true,
  },
  {
    purpose: 'booking_data',
    label: 'Booking Information',
    description: 'We store your appointment details (provider, time, status) so you can view and manage your bookings. This is required to use the app.',
    required: true,
    default: true,
  },
  {
    purpose: 'location_detection',
    label: 'Location for Nearby Discovery',
    description: 'We use your approximate location to show clinics, salons, and turfs near you. You can still search by city without enabling this.',
    required: false,
    default: false,
  },
  {
    purpose: 'clinical_booking',
    label: 'Clinical Appointment Data',
    description: 'When you book a doctor, we record the clinic and slot time. This data is not shared with third parties and is used only to manage your appointment.',
    required: false,
    default: false,
  },
  {
    purpose: 'marketing_notifications',
    label: 'Offers & Notifications from Partners',
    description: 'Receive occasional offers and reminders from merchants you\'ve visited. You can change this at any time in Settings.',
    required: false,
    default: false,
  },
];

interface Props {
  onConsentsGranted: () => void;
}

export default function ConsentScreen({ onConsentsGranted }: Props) {
  const [values, setValues] = useState<Record<string, boolean>>(
    Object.fromEntries(CONSENTS.map(c => [c.purpose, c.default]))
  );
  const [saving, setSaving] = useState(false);

  const toggle = (purpose: string, required: boolean) => {
    if (required) return; // required consents cannot be toggled off
    setValues(prev => ({ ...prev, [purpose]: !prev[purpose] }));
  };

  const handleAccept = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Store locally until sign-in, then sync after auth
        // For now, proceed — consents will be saved on next session
        onConsentsGranted();
        return;
      }

      // Upsert each consent record
      const rows = CONSENTS.map(c => ({
        user_id: user.id,
        purpose: c.purpose,
        granted: c.required ? true : (values[c.purpose] ?? false),
        version: CONSENT_VERSION,
      }));

      const { error } = await supabase
        .from('user_consents')
        .upsert(rows, { onConflict: 'user_id,purpose,version' });

      if (error) {
        Alert.alert('Error', 'Could not save your preferences. Please try again.');
        return;
      }

      onConsentsGranted();
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Your Privacy, Your Choice</Text>
        <Text style={styles.subtitle}>
          Appointments4u collects only what it needs to serve you. Please review each permission below.
          Required items cannot be turned off — they are needed for the app to work.
        </Text>

        {CONSENTS.map(item => (
          <View key={item.purpose} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.labelContainer}>
                <Text style={styles.label}>
                  {item.label}
                  {item.required && <Text style={styles.required}> (Required)</Text>}
                </Text>
              </View>
              <Switch
                value={item.required ? true : (values[item.purpose] ?? false)}
                onValueChange={() => toggle(item.purpose, item.required)}
                disabled={item.required}
                trackColor={{ false: '#ddd', true: '#3b82f6' }}
                thumbColor={item.required ? '#93c5fd' : '#ffffff'}
              />
            </View>
            <Text style={styles.description}>{item.description}</Text>
          </View>
        ))}

        <View style={styles.legalBox}>
          <Text style={styles.legalText}>
            By continuing, you acknowledge that Appointments4u is a technology scheduling platform
            and acts as an intermediary between you and service providers. In a medical emergency,
            call <Text style={styles.bold}>108</Text> immediately. Do not rely on appointment slots in emergencies.
          </Text>
          <Text style={styles.legalText}>
            You have the right to withdraw optional consents or request account deletion at any
            time via <Text style={styles.bold}>Settings → Account → Delete Account</Text>.
          </Text>
          <Text style={styles.legalText}>
            Grievance Officer: grievance@appointments4u.in · Response within 48 hours.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleAccept}
          disabled={saving}
          accessibilityLabel="Accept and continue"
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Accept & Continue</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.privacyLink}>
          Read our full{' '}
          <Text style={styles.link} onPress={() => Linking.openURL('https://appointments4u.in/privacy')}>
            Privacy Policy
          </Text>{' '}
          and{' '}
          <Text style={styles.link} onPress={() => Linking.openURL('https://appointments4u.in/terms')}>
            Terms of Service
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  scroll:           { padding: 20, paddingBottom: 8 },
  title:            { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  subtitle:         { fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 20 },
  card:             {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  row:              { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  labelContainer:   { flex: 1, marginRight: 8 },
  label:            { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  required:         { color: '#64748b', fontWeight: '400' },
  description:      { fontSize: 13, color: '#64748b', lineHeight: 18 },
  legalBox:         {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  legalText:        { fontSize: 12, color: '#475569', lineHeight: 18, marginBottom: 8 },
  bold:             { fontWeight: '700' },
  footer:           { padding: 20, paddingTop: 8, backgroundColor: '#f8fafc' },
  button:           {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled:   { opacity: 0.6 },
  buttonText:       { color: '#fff', fontSize: 16, fontWeight: '700' },
  privacyLink:      { textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 10 },
  link:             { color: '#3b82f6', textDecorationLine: 'underline' },
});
