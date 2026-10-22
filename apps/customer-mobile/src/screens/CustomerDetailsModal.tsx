import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { signInWithGoogle, signInWithGoogleDev, syncCustomerProfile } from '../services/api';

export interface CustomerBookingDetails {
  fullName: string;
  phone: string;
  email?: string;
}

interface CustomerDetailsModalProps {
  visible: boolean;
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  doctorName?: string;
  slotTime?: string;
  isAuthenticated: boolean;
  onClose: () => void;
  onProceedToPayment: (details: CustomerBookingDetails) => void;
  onAuthSuccess?: (user: any) => void;
}

export default function CustomerDetailsModal({
  visible,
  initialName = '',
  initialPhone = '',
  initialEmail = '',
  doctorName,
  slotTime,
  isAuthenticated,
  onClose,
  onProceedToPayment,
  onAuthSuccess,
}: CustomerDetailsModalProps) {
  const [fullName, setFullName] = useState<string>(initialName || 'Trinadh Patient');
  const [phone, setPhone] = useState<string>(initialPhone || '+919999999991');
  const [email, setEmail] = useState<string>(initialEmail || 'trinadh.patient@gmail.com');
  const [loadingGoogle, setLoadingGoogle] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialName) setFullName(initialName);
    if (initialPhone) setPhone(initialPhone);
    if (initialEmail) setEmail(initialEmail);
  }, [initialName, initialPhone, initialEmail]);

  const handleGoogleSignIn = async () => {
    setLoadingGoogle(true);
    setErrorMessage(null);
    try {
      // 1. Try real Supabase Google OAuth
      const oAuthRes = await signInWithGoogle();
      if (oAuthRes.success && oAuthRes.url) {
        // Redirect initiated via browser
        return;
      }

      // 2. Dev / Local fallback if OAuth provider is not configured in Supabase dashboard
      const devRes = await signInWithGoogleDev(
        email || 'trinadh.patient@gmail.com',
        fullName || 'Trinadh Google User'
      );

      if (devRes.success) {
        if (devRes.user?.user_metadata?.full_name) {
          setFullName(devRes.user.user_metadata.full_name);
        }
        if (devRes.user?.email) {
          setEmail(devRes.user.email);
        }
        if (onAuthSuccess) {
          onAuthSuccess(devRes.user);
        }
      } else {
        setErrorMessage(devRes.error || 'Google Sign-In was unable to complete. Please check network.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in error';
      setErrorMessage(msg);
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleContinue = async () => {
    const trimmedName = fullName.trim();
    const cleanPhone = phone.trim().replace(/\s+/g, '');

    if (!trimmedName) {
      setErrorMessage('Please enter your full name');
      return;
    }

    if (!cleanPhone) {
      setErrorMessage('Please enter your mobile phone number for appointment SMS alerts');
      return;
    }

    const digitsOnly = cleanPhone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      setErrorMessage('Please enter a valid 10-digit mobile phone number');
      return;
    }

    const formattedPhone = cleanPhone.startsWith('+')
      ? cleanPhone
      : `+91${digitsOnly.slice(-10)}`;

    setErrorMessage(null);

    // Save profile to Supabase if authenticated
    if (isAuthenticated) {
      try {
        await syncCustomerProfile(trimmedName, formattedPhone, email.trim() || undefined);
      } catch (e) {
        console.warn('Profile sync warning:', e);
      }
    }

    onProceedToPayment({
      fullName: trimmedName,
      phone: formattedPhone,
      email: email.trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Patient & Booking Details</Text>
              <Text style={styles.headerSubtitle}>
                {doctorName ? `${doctorName} • ` : ''}{slotTime || 'Scheduled Slot'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close details modal">
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.contentBody} showsVerticalScrollIndicator={false}>
            {/* Google Sign-In Card */}
            <View style={styles.googleAuthCard}>
              <View style={styles.googleAuthHeader}>
                <View style={styles.googleIconBadge}>
                  <Text style={styles.googleGText}>G</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.googleCardTitle}>
                    {isAuthenticated ? 'Connected with Google' : 'Quick Sign In with Google'}
                  </Text>
                  <Text style={styles.googleCardSubtitle}>
                    {isAuthenticated
                      ? `Signed in as ${email || 'Verified Account'}`
                      : 'Auto-fill your details and link your OPD hospital pass'}
                  </Text>
                </View>
              </View>

              {!isAuthenticated ? (
                <TouchableOpacity
                  style={styles.googleButton}
                  onPress={handleGoogleSignIn}
                  disabled={loadingGoogle}
                  testID="btn-continue-google"
                >
                  {loadingGoogle ? (
                    <ActivityIndicator size="small" color="#1e293b" />
                  ) : (
                    <>
                      <Text style={styles.googleBtnIcon}>🌐</Text>
                      <Text style={styles.googleBtnText}>Continue with Google</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.authenticatedBadge}>
                  <Text style={styles.authenticatedBadgeText}>✓ Google Identity Verified</Text>
                </View>
              )}
            </View>

            {/* Error Message */}
            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
              </View>
            )}

            {/* Details Form Card */}
            <View style={styles.formCard}>
              <Text style={styles.formSectionTitle}>Patient Information</Text>

              {/* Full Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  FULL NAME <Text style={styles.requiredStar}>*</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={fullName}
                  onChangeText={(val) => {
                    setFullName(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="e.g. K. Trinadh"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="words"
                  testID="input-patient-fullname"
                />
              </View>

              {/* Mobile Phone */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  MOBILE NUMBER <Text style={styles.requiredStar}>* (For SMS & Reception Check-in)</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={phone}
                  onChangeText={(val) => {
                    let cleaned = val.replace(/[^0-9+\s-]/g, '');
                    if (cleaned.includes('+')) {
                      const hasLeading = cleaned.startsWith('+');
                      cleaned = (hasLeading ? '+' : '') + cleaned.replace(/\+/g, '');
                    }
                    setPhone(cleaned);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="+91 99999 99991"
                  placeholderTextColor="#94a3b8"
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  testID="input-patient-mobile"
                />
              </View>

              {/* Email (Optional) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  EMAIL ADDRESS <Text style={styles.optionalTag}>(Optional for digital receipts)</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="name@example.com"
                  placeholderTextColor="#94a3b8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="input-patient-email"
                />
              </View>

              <View style={styles.tokenNoticeBox}>
                <Text style={styles.tokenNoticeIcon}>🎫</Text>
                <Text style={styles.tokenNoticeText}>
                  Your unique <Text style={{ fontWeight: '700', color: '#0369a1' }}>Queue Token Number</Text> will be automatically generated and registered to this mobile number immediately after deposit payment.
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Sticky Bottom Actions */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.proceedButton}
              onPress={handleContinue}
              testID="btn-proceed-to-checkout"
              accessibilityRole="button"
              accessibilityLabel="Proceed to Hold & Pay Deposit"
            >
              <Text style={styles.proceedButtonText}>Proceed to Hold & Pay Deposit →</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: 560,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  contentBody: {
    padding: 16,
  },
  googleAuthCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  googleAuthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  googleIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleGText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ea4335',
  },
  googleCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  googleCardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 10,
    minHeight: 48,
  },
  googleBtnIcon: {
    fontSize: 18,
  },
  googleBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  authenticatedBadge: {
    backgroundColor: '#ecfdf5',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    alignItems: 'center',
  },
  authenticatedBadgeText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
  },
  formSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 14,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  requiredStar: {
    color: '#dc2626',
    fontWeight: '700',
  },
  optionalTag: {
    color: '#94a3b8',
    fontWeight: '400',
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    minHeight: 48,
  },
  tokenNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#bae6fd',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
    gap: 8,
  },
  tokenNoticeIcon: {
    fontSize: 18,
  },
  tokenNoticeText: {
    flex: 1,
    fontSize: 12,
    color: '#0369a1',
    lineHeight: 18,
  },
  bottomBar: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  proceedButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  proceedButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
