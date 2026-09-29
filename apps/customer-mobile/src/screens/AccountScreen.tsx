/**
 * AccountScreen.tsx
 *
 * User account management — shows profile details, consent settings,
 * and account deletion (mandated by Google Play Store, May 2024).
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView, Linking, Switch,
} from 'react-native';
import { supabase, getApiBaseUrl } from '../services/api';

interface DeletionStatus {
  pending: boolean;
  request: { id: string; requested_at: string; scheduled_for: string } | null;
}

interface ConsentState {
  location_detection: boolean;
  marketing_notifications: boolean;
  loaded: boolean;
}

export default function AccountScreen() {
  const [user, setUser]                 = useState<{ id: string; phone?: string; email?: string } | null>(null);
  const [deletion, setDeletion]         = useState<DeletionStatus | null>(null);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [consents, setConsents]         = useState<ConsentState>({ location_detection: false, marketing_notifications: false, loaded: false });
  const [savingConsent, setSavingConsent] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user ? { id: user.id, phone: user.phone, email: user.email } : null);

      // Load optional consent settings from DB (DPDPA §6 right to withdraw)
      if (user) {
        try {
          const { data: rows } = await supabase
            .from('user_consents')
            .select('purpose, granted')
            .eq('user_id', user.id)
            .in('purpose', ['location_detection', 'marketing_notifications']);

          if (rows) {
            const map: Record<string, boolean> = {};
            rows.forEach(r => { map[r.purpose] = r.granted; });
            setConsents({
              location_detection: map['location_detection'] ?? false,
              marketing_notifications: map['marketing_notifications'] ?? false,
              loaded: true,
            });
          }
        } catch { /* non-fatal */ }
      }

      // Check for existing deletion request
      try {
        const base = getApiBaseUrl();
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (token) {
          const res = await fetch(`${base}/api/account/delete`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) setDeletion(await res.json());
        }
      } catch { /* non-fatal */ }

      setLoading(false);
    })();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const toggleConsent = async (purpose: 'location_detection' | 'marketing_notifications', value: boolean) => {
    if (!user) return;
    setSavingConsent(purpose);
    try {
      await supabase
        .from('user_consents')
        .upsert(
          { user_id: user.id, purpose, granted: value, version: '1.0' },
          { onConflict: 'user_id,purpose,version' }
        );
      setConsents(prev => ({ ...prev, [purpose]: value }));
    } catch {
      Alert.alert('Error', 'Could not update consent. Please try again.');
    } finally {
      setSavingConsent(null);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Your account and all personal data will be permanently deleted after a 30-day grace period. You can cancel this request by contacting support within those 30 days.\n\nThis cannot be undone after 30 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Schedule Deletion',
          style: 'destructive',
          onPress: confirmDelete,
        },
      ]
    );
  };

  const confirmDelete = async () => {
    setLoadingDelete(true);
    try {
      const base = getApiBaseUrl();
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        Alert.alert('Error', 'You must be signed in to delete your account.');
        return;
      }

      const res = await fetch(`${base}/api/account/delete`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'User requested via app' }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setDeletion({ pending: true, request: { ...data, id: data.request_id } });
        Alert.alert(
          'Deletion Scheduled',
          'Your account is scheduled for deletion in 30 days. To cancel, email support@appointments4u.in with subject "Cancel Account Deletion".',
          [{ text: 'OK', onPress: handleSignOut }]
        );
      } else {
        Alert.alert('Error', data.error || 'Failed to schedule deletion');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setLoadingDelete(false);
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#3b82f6" /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Account</Text>

      {/* Profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        {user?.phone && <Text style={styles.detail}>📱 {user.phone}</Text>}
        {user?.email && <Text style={styles.detail}>✉️ {user.email}</Text>}
      </View>

      {/* Privacy */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy & Data</Text>
        <TouchableOpacity
          style={styles.link}
          onPress={() => Linking.openURL('https://appointments4u.in/privacy')}
        >
          <Text style={styles.linkText}>Privacy Policy →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.link}
          onPress={() => Linking.openURL('https://appointments4u.in/terms')}
        >
          <Text style={styles.linkText}>Terms of Service →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.link}
          onPress={() => Linking.openURL('mailto:grievance@appointments4u.in')}
        >
          <Text style={styles.linkText}>Grievance Officer →</Text>
        </TouchableOpacity>
      </View>

      {/* Manage Consents — DPDPA §6 right to withdraw optional consents */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy Preferences</Text>
        <Text style={styles.consentNote}>Required consents (phone, booking data) cannot be withdrawn while the app is in use.</Text>

        <View style={styles.consentRow}>
          <View style={styles.consentLabelGroup}>
            <Text style={styles.consentLabel}>Location for Nearby Discovery</Text>
            <Text style={styles.consentSub}>Show providers near you based on GPS</Text>
          </View>
          {savingConsent === 'location_detection'
            ? <ActivityIndicator size="small" color="#059669" />
            : <Switch
                value={consents.location_detection}
                onValueChange={(v) => toggleConsent('location_detection', v)}
                trackColor={{ false: '#e2e8f0', true: '#059669' }}
                thumbColor="#ffffff"
              />
          }
        </View>

        <View style={[styles.consentRow, { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12, marginTop: 4 }]}>
          <View style={styles.consentLabelGroup}>
            <Text style={styles.consentLabel}>Offers & Partner Notifications</Text>
            <Text style={styles.consentSub}>Occasional offers from merchants you've visited</Text>
          </View>
          {savingConsent === 'marketing_notifications'
            ? <ActivityIndicator size="small" color="#059669" />
            : <Switch
                value={consents.marketing_notifications}
                onValueChange={(v) => toggleConsent('marketing_notifications', v)}
                trackColor={{ false: '#e2e8f0', true: '#059669' }}
                thumbColor="#ffffff"
              />
          }
        </View>
      </View>

      {/* Account Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Actions</Text>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {deletion?.pending ? (
          <View style={styles.deletionPending}>
            <Text style={styles.deletionPendingTitle}>⏳ Account Deletion Scheduled</Text>
            <Text style={styles.deletionPendingText}>
              Your account is scheduled for permanent deletion on{' '}
              {deletion.request?.scheduled_for
                ? new Date(deletion.request.scheduled_for).toLocaleDateString('en-IN')
                : '30 days from now'}.
              {'\n\n'}To cancel, email{' '}
              <Text style={styles.bold}>support@appointments4u.in</Text> with subject
              "Cancel Account Deletion".
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={handleDeleteAccount}
            disabled={loadingDelete}
          >
            {loadingDelete
              ? <ActivityIndicator color="#ef4444" />
              : <Text style={styles.deleteText}>Delete Account</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.footer}>
        Grievance Officer: grievance@appointments4u.in{'\n'}
        Response within 48 hours · Resolution within 30 days
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#f8fafc' },
  content:              { padding: 20, paddingBottom: 40 },
  centered:             { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading:              { fontSize: 28, fontWeight: '700', color: '#0f172a', marginBottom: 24 },
  section:              {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle:         { fontSize: 13, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  detail:               { fontSize: 15, color: '#1e293b', marginBottom: 6 },
  link:                 { paddingVertical: 8 },
  linkText:             { fontSize: 15, color: '#3b82f6' },
  signOutBtn:           { backgroundColor: '#f1f5f9', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  signOutText:          { fontSize: 15, fontWeight: '600', color: '#475569' },
  deleteBtn:            { borderWidth: 1.5, borderColor: '#fecaca', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  deleteText:           { fontSize: 15, fontWeight: '600', color: '#ef4444' },
  deletionPending:      { backgroundColor: '#fef3c7', borderRadius: 10, padding: 14 },
  deletionPendingTitle: { fontSize: 15, fontWeight: '700', color: '#92400e', marginBottom: 8 },
  deletionPendingText:  { fontSize: 13, color: '#78350f', lineHeight: 20 },
  bold:                 { fontWeight: '700' },
  footer:               { marginTop: 8, fontSize: 12, color: '#94a3b8', textAlign: 'center', lineHeight: 18 },
  consentNote:          { fontSize: 12, color: '#94a3b8', marginBottom: 12, lineHeight: 18 },
  consentRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  consentLabelGroup:    { flex: 1, marginRight: 12 },
  consentLabel:         { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  consentSub:           { fontSize: 12, color: '#64748b', marginTop: 2 },
});
