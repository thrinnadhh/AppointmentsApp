import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  BackHandler,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Resource, Slot, Booking } from '@appointments/shared';
import HomeScreen from './src/screens/HomeScreen';
import ProviderDetailScreen from './src/screens/ProviderDetailScreen';
import CheckoutModal from './src/screens/CheckoutModal';
import MyBookingsScreen from './src/screens/MyBookingsScreen';
import {
  MOCK_PROVIDERS,
  fetchCustomerBookingsFromSupabase,
  cancelBookingOnSupabase,
  rescheduleBookingOnSupabase,
  sendPhoneOtp,
  verifyPhoneOtp,
  syncCustomerProfile,
  getCurrentCustomerSession,
  signOutCustomer,
  supabase,
} from './src/services/api';

type ScreenType = 'HOME' | 'PROVIDER_DETAIL' | 'MY_BOOKINGS';

export interface NavigationEntry {
  screen: ScreenType;
  providerId?: string;
  categoryId?: string | null;
}

const DEMO_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';

export default function App() {
  // Navigation History Stack ensures returning from booking goes to exactly where the user left off
  const [history, setHistory] = useState<NavigationEntry[]>([
    { screen: 'HOME', categoryId: null },
  ]);
  const [checkoutVisible, setCheckoutVisible] = useState<boolean>(false);
  const [profileVisible, setProfileVisible] = useState<boolean>(false);
  const [activeResource, setActiveResource] = useState<Resource | null>(null);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);

  // Authentication & Active Customer State
  const [activeCustomerId, setActiveCustomerId] = useState<string>(DEMO_CUSTOMER_ID);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authPhone, setAuthPhone] = useState<string>('+919999999991');
  const [authOtp, setAuthOtp] = useState<string>('');
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Derive current screen and state from the top of the history stack
  const currentEntry = history[history.length - 1] || { screen: 'HOME', categoryId: null };
  const currentScreen = currentEntry.screen;
  const activeCategoryId = currentEntry.categoryId ?? null;
  const selectedProviderId = currentEntry.providerId ?? MOCK_PROVIDERS[0].id;

  // Customer Profile State
  const [customerProfile, setCustomerProfile] = useState({
    name: 'Ravi Teja',
    phone: '+91 98765 43210',
    email: 'ravi.teja@customer.tirupati.in',
    city: 'Tirupati, AP',
  });

  // Check existing Supabase session on app startup
  useEffect(() => {
    async function checkSession() {
      try {
        const session = await getCurrentCustomerSession();
        if (session?.user) {
          const u = session.user;
          setActiveCustomerId(u.id);
          setIsAuthenticated(true);
          const p = u.phone ? (u.phone.startsWith('+') ? u.phone : `+${u.phone}`) : authPhone;
          setCustomerProfile((prev) => ({
            ...prev,
            phone: p,
            name: (u.user_metadata?.full_name as string) || `Customer ${p.slice(-4)}`,
          }));
        }
      } catch (err) {
        console.warn('Error checking auth session:', err);
      }
    }
    checkSession();
  }, []);

  // Stored customer bookings (seeded from Supabase)
  const [customerBookings, setCustomerBookings] = useState<
    (Booking & { provider_name?: string; resource_name?: string })[]
  >([]);

  const [confirmationToast, setConfirmationToast] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    try {
      const data = await fetchCustomerBookingsFromSupabase(activeCustomerId);
      if (data && data.length > 0) {
        setCustomerBookings(data);
      } else {
        setCustomerBookings([]);
      }
    } catch (e) {
      console.warn('Error loading customer bookings from Supabase:', e);
    }
  }, [activeCustomerId]);

  useEffect(() => {
    loadBookings();

    const channel = supabase
      .channel(`customer-bookings-${activeCustomerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `customer_id=eq.${activeCustomerId}`,
        },
        (payload) => {
          const newStatus = (payload.new as { status?: string })?.status;
          if (newStatus) {
            setConfirmationToast(`Appointment update: Status is now ${newStatus}`);
            setTimeout(() => setConfirmationToast(null), 4000);
          }
          loadBookings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadBookings, activeCustomerId]);

  const handleSendOtp = async () => {
    if (!authPhone.trim()) {
      setAuthError('Please enter a valid mobile number');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await sendPhoneOtp(authPhone);
      if (res.success) {
        setOtpSent(true);
        setConfirmationToast('OTP sent! Test OTP is 123456');
        setTimeout(() => setConfirmationToast(null), 4000);
      } else {
        setAuthError(res.error || 'Failed to send OTP');
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Error sending OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!authOtp.trim()) {
      setAuthError('Please enter the 6-digit verification code');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await verifyPhoneOtp(authPhone, authOtp);
      if (res.success && res.user) {
        const uid = res.user.id;
        const phone = res.user.phone || authPhone;
        const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
        await syncCustomerProfile('Verified Customer', formattedPhone, `${formattedPhone.replace(/\D/g, '')}@customer.tirupati.in`);
        setActiveCustomerId(uid);
        setIsAuthenticated(true);
        setOtpSent(false);
        setAuthOtp('');
        setCustomerProfile((prev) => ({
          ...prev,
          phone: formattedPhone,
          name: `Verified Customer (${formattedPhone.slice(-4)})`,
        }));
        setConfirmationToast('Phone verified! Signed in with Supabase.');
        setTimeout(() => setConfirmationToast(null), 4000);
      } else {
        setAuthError(res.error || 'Invalid OTP. Please try 123456.');
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Failed to verify OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await signOutCustomer();
      setActiveCustomerId(DEMO_CUSTOMER_ID);
      setIsAuthenticated(false);
      setOtpSent(false);
      setAuthOtp('');
      setCustomerProfile({
        name: 'Ravi Teja',
        phone: '+91 98765 43210',
        email: 'ravi.teja@customer.tirupati.in',
        city: 'Tirupati, AP',
      });
      setConfirmationToast('Signed out. Switched to Guest mode.');
      setTimeout(() => setConfirmationToast(null), 4000);
    } finally {
      setAuthLoading(false);
    }
  };

  // Navigate backward through history stack
  const handleGoBack = useCallback(() => {
    if (checkoutVisible) {
      setCheckoutVisible(false);
      return true;
    }
    if (profileVisible) {
      setProfileVisible(false);
      return true;
    }
    if (currentScreen === 'MY_BOOKINGS') {
      // Returning from bookings goes back to where the user was browsing (HOME with activeCategoryId preserved)
      setHistory((prev) => {
        const lastHomeIdx = prev.map((e) => e.screen === 'HOME').lastIndexOf(true);
        if (lastHomeIdx >= 0) {
          return prev.slice(0, lastHomeIdx + 1);
        }
        return [{ screen: 'HOME', categoryId: activeCategoryId }];
      });
      return true;
    }
    if (currentScreen === 'PROVIDER_DETAIL') {
      // Returning from provider detail goes back to the category venues list
      setHistory((prev) => {
        const lastHomeIdx = prev.map((e) => e.screen === 'HOME').lastIndexOf(true);
        if (lastHomeIdx >= 0) {
          return prev.slice(0, lastHomeIdx + 1);
        }
        return [{ screen: 'HOME', categoryId: activeCategoryId }];
      });
      return true;
    }
    if (currentScreen === 'HOME' && activeCategoryId) {
      // User is on Category view and presses Back: return to 5-Category Hub
      setHistory([{ screen: 'HOME', categoryId: null }]);
      return true;
    }
    if (history.length > 1) {
      setHistory((prev) => prev.slice(0, -1));
      return true;
    }
    return false;
  }, [checkoutVisible, profileVisible, currentScreen, activeCategoryId, history.length]);

  // Category selection handler with history stack awareness
  const handleSelectCategory = useCallback((catId: string | null) => {
    if (catId === null) {
      // Returning to All Categories hub: pop back to root hub if in history
      setHistory((prev) => {
        const lastHubIdx = prev.map((e) => e.screen === 'HOME' && !e.categoryId).lastIndexOf(true);
        if (lastHubIdx >= 0) {
          return prev.slice(0, lastHubIdx + 1);
        }
        return [...prev, { screen: 'HOME', categoryId: null }];
      });
    } else {
      setHistory((prev) => {
        const top = prev[prev.length - 1];
        if (top && top.screen === 'HOME' && top.categoryId !== null) {
          // Switch category in-place for horizontal bar tabs to prevent redundant stack build-up
          return [...prev.slice(0, -1), { screen: 'HOME', categoryId: catId }];
        }
        return [...prev, { screen: 'HOME', categoryId: catId }];
      });
    }
  }, []);

  const handleSelectProvider = useCallback((providerId: string) => {
    setHistory((prev) => [
      ...prev,
      { screen: 'PROVIDER_DETAIL', providerId, categoryId: activeCategoryId },
    ]);
  }, [activeCategoryId]);

  const handleOpenMyBookings = useCallback(() => {
    setHistory((prev) => [
      ...prev,
      { screen: 'MY_BOOKINGS', providerId: selectedProviderId, categoryId: activeCategoryId },
    ]);
  }, [selectedProviderId, activeCategoryId]);

  const handleProceedToHold = (resource: Resource, slot: Slot) => {
    setActiveResource(resource);
    setActiveSlot(slot);
    setCheckoutVisible(true);
  };

  const handlePaymentSuccess = async (bookingId: string) => {
    await loadBookings();
    setCheckoutVisible(false);
    setConfirmationToast(`Booking Confirmed on Supabase! Deposit ₹${activeResource?.deposit_amount} captured.`);
    // Push MY_BOOKINGS onto history so clicking back returns to where the user left off (Provider Detail)
    setHistory((prev) => [
      ...prev,
      { screen: 'MY_BOOKINGS', providerId: selectedProviderId, categoryId: activeCategoryId },
    ]);

    setTimeout(() => {
      setConfirmationToast(null);
    }, 4000);
  };

  const handleCancelBooking = async (bookingId: string) => {
    const target = customerBookings.find((b) => b.id === bookingId);
    if (!target) return;

    try {
      await cancelBookingOnSupabase(bookingId, target.slot_start);
      setConfirmationToast('Booking cancelled on Supabase.');
      await loadBookings();
    } catch (err) {
      console.warn('Cancelling locally:', err);
      setCustomerBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: 'CANCELLED', payment_status: 'REFUNDED' } : b))
      );
    }
    setTimeout(() => setConfirmationToast(null), 4000);
  };

  const handleRescheduleBooking = async (
    bookingId: string,
    newSlotStart: string,
    newSlotEnd: string
  ) => {
    try {
      await rescheduleBookingOnSupabase(bookingId, newSlotStart, newSlotEnd);
      await loadBookings();
      setConfirmationToast('Appointment rescheduled successfully!');
      setTimeout(() => setConfirmationToast(null), 4000);
    } catch (err) {
      console.warn('Reschedule failed:', err);
      throw err;
    }
  };

  // Hardware Back Navigation (Android)
  useEffect(() => {
    const backSub = BackHandler.addEventListener('hardwareBackPress', handleGoBack);
    return () => backSub.remove();
  }, [handleGoBack]);

  // Browser Popstate Back Navigation (Web Preview & Mobile Browsers)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onPopState = () => {
      handleGoBack();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [handleGoBack]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Screen Router */}
      {currentScreen === 'HOME' && (
        <HomeScreen
          selectedCategory={activeCategoryId}
          onSelectCategory={handleSelectCategory}
          onSelectProvider={handleSelectProvider}
          onOpenMyBookings={handleOpenMyBookings}
          onOpenProfile={() => setProfileVisible(true)}
        />
      )}

      {currentScreen === 'PROVIDER_DETAIL' && (
        <ProviderDetailScreen
          providerId={selectedProviderId}
          onBack={handleGoBack}
          onProceedToHold={handleProceedToHold}
        />
      )}

      {currentScreen === 'MY_BOOKINGS' && (
        <MyBookingsScreen
          onBack={handleGoBack}
          bookings={customerBookings}
          onCancelBooking={handleCancelBooking}
          onRescheduleBooking={handleRescheduleBooking}
        />
      )}

      {/* Checkout Modal with 5-min Hold Timer */}
      <CheckoutModal
        visible={checkoutVisible}
        resource={activeResource}
        slot={activeSlot}
        customerId={activeCustomerId}
        onClose={() => setCheckoutVisible(false)}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* Customer Profile & Authentication Modal */}
      <Modal
        visible={profileVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setProfileVisible(false)}
      >
        <View style={styles.profileModalOverlay}>
          <SafeAreaView style={styles.profileSheet}>
            <View style={styles.profileHeader}>
              <Text style={styles.profileTitle}>Customer Profile & Sign In</Text>
              <TouchableOpacity
                style={styles.closeProfileBtn}
                onPress={() => setProfileVisible(false)}
                accessibilityLabel="Close profile modal"
              >
                <Text style={styles.closeProfileText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.profileContent} showsVerticalScrollIndicator={false}>
              <View style={styles.profileAvatarBox}>
                <Text style={styles.avatarEmoji}>👤</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileName}>{customerProfile.name}</Text>
                  <Text style={styles.profileCity}>{customerProfile.city}</Text>
                </View>
                <View
                  style={[
                    styles.authBadge,
                    { backgroundColor: isAuthenticated ? '#ecfdf5' : '#fef3c7' },
                  ]}
                >
                  <Text
                    style={[
                      styles.authBadgeText,
                      { color: isAuthenticated ? '#059669' : '#d97706' },
                    ]}
                  >
                    {isAuthenticated ? '✅ Verified' : '⚡ Guest'}
                  </Text>
                </View>
              </View>

              {/* Phone OTP Authentication Card */}
              <View style={styles.authCard}>
                <View style={styles.authCardHeader}>
                  <Text style={styles.authCardTitle}>1-Tap Phone OTP Authentication</Text>
                </View>
                <Text style={styles.authCardSubtitle}>
                  {isAuthenticated
                    ? `Authenticated via Supabase Auth with phone ${customerProfile.phone}`
                    : 'Sign in with your mobile phone to sync bookings and link medical records'}
                </Text>

                {authError && (
                  <View style={styles.authErrorBox}>
                    <Text style={styles.authErrorText}>⚠️ {authError}</Text>
                  </View>
                )}

                {!isAuthenticated ? (
                  !otpSent ? (
                    <View>
                      <View style={styles.authInputGroup}>
                        <Text style={styles.authInputLabel}>MOBILE NUMBER (E.164)</Text>
                        <TextInput
                          style={styles.authTextInput}
                          value={authPhone}
                          onChangeText={setAuthPhone}
                          placeholder="+919999999991"
                          placeholderTextColor="#94a3b8"
                          keyboardType="phone-pad"
                          autoCapitalize="none"
                          editable={!authLoading}
                          testID="input-phone-auth"
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.authPrimaryBtn}
                        onPress={handleSendOtp}
                        disabled={authLoading}
                        accessibilityLabel="Send OTP"
                        testID="btn-send-otp"
                      >
                        {authLoading ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.authPrimaryBtnText}>Send 6-Digit OTP</Text>
                        )}
                      </TouchableOpacity>
                      <Text style={styles.authHelperText}>
                        ℹ️ Test Phone: +919999999991 (Fixed OTP: 123456)
                      </Text>
                    </View>
                  ) : (
                    <View>
                      <View style={styles.authInputGroup}>
                        <Text style={styles.authInputLabel}>6-DIGIT VERIFICATION CODE</Text>
                        <TextInput
                          style={[styles.authTextInput, { letterSpacing: 4, textAlign: 'center', fontSize: 20 }]}
                          value={authOtp}
                          onChangeText={setAuthOtp}
                          placeholder="123456"
                          placeholderTextColor="#94a3b8"
                          keyboardType="number-pad"
                          maxLength={6}
                          editable={!authLoading}
                          testID="input-otp-code"
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.authPrimaryBtn}
                        onPress={handleVerifyOtp}
                        disabled={authLoading}
                        accessibilityLabel="Verify OTP and Sign In"
                        testID="btn-verify-otp"
                      >
                        {authLoading ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.authPrimaryBtnText}>Verify OTP & Sign In</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.authSecondaryBtn}
                        onPress={() => {
                          setOtpSent(false);
                          setAuthError(null);
                        }}
                      >
                        <Text style={styles.authSecondaryBtnText}>← Change Phone Number</Text>
                      </TouchableOpacity>
                    </View>
                  )
                ) : (
                  <TouchableOpacity
                    style={styles.signOutBtn}
                    onPress={handleSignOut}
                    disabled={authLoading}
                    testID="btn-sign-out"
                  >
                    <Text style={styles.signOutBtnText}>Sign Out / Switch Account</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.profileFields}>
                <View style={styles.profileField}>
                  <Text style={styles.fieldLabel}>ACTIVE MOBILE</Text>
                  <Text style={styles.fieldValue}>{customerProfile.phone}</Text>
                </View>

                <View style={styles.profileField}>
                  <Text style={styles.fieldLabel}>ACTIVE USER ID (SUPABASE)</Text>
                  <Text style={[styles.fieldValue, { fontSize: 11, fontFamily: 'monospace' }]}>
                    {activeCustomerId}
                  </Text>
                </View>

                <View style={styles.profileStatsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statNum}>{customerBookings.length}</Text>
                    <Text style={styles.statLabel}>Total Bookings</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statNum}>
                      {customerBookings.filter((b) => b.status === 'CONFIRMED').length}
                    </Text>
                    <Text style={styles.statLabel}>Active Slots</Text>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={styles.viewBookingsFromProfileBtn}
                onPress={() => {
                  setProfileVisible(false);
                  handleOpenMyBookings();
                }}
              >
                <Text style={styles.viewBookingsFromProfileText}>
                  View Appointments ({customerBookings.length})
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Confirmation Toast Alert */}
      {confirmationToast && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>🎉 {confirmationToast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  screenContainer: {
    flex: 1,
  },
  hiddenScreen: {
    display: 'none',
  },
  toastContainer: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: '#064e3b',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 9999,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  profileModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  profileSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
    maxHeight: '85%',
  },
  profileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  profileTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  closeProfileBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeProfileText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  profileContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  profileAvatarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
  },
  avatarEmoji: {
    fontSize: 36,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  profileCity: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
    marginTop: 2,
  },
  profileFields: {
    gap: 12,
    marginBottom: 20,
  },
  profileField: {
    backgroundColor: '#f8fafc',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  fieldValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
  },
  profileStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#ecfdf5',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    alignItems: 'center',
  },
  statNum: {
    fontSize: 22,
    fontWeight: '800',
    color: '#059669',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065f46',
    marginTop: 2,
  },
  viewBookingsFromProfileBtn: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  viewBookingsFromProfileText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  authBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  authBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  authCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  authCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  authCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  authCardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 14,
    lineHeight: 16,
  },
  authInputGroup: {
    marginBottom: 12,
  },
  authInputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  authTextInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    minHeight: 44,
  },
  authPrimaryBtn: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: 4,
  },
  authPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  authSecondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    minHeight: 44,
  },
  authSecondaryBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  authHelperText: {
    fontSize: 11,
    color: '#059669',
    backgroundColor: '#ecfdf5',
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  authErrorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecdd3',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  authErrorText: {
    color: '#e11d48',
    fontSize: 12,
    fontWeight: '600',
  },
  signOutBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 44,
  },
  signOutBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
});
