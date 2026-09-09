import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
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
} from './src/services/api';

type ScreenType = 'HOME' | 'PROVIDER_DETAIL' | 'MY_BOOKINGS';

const DEMO_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('HOME');
  const [selectedProviderId, setSelectedProviderId] = useState<string>(MOCK_PROVIDERS[0].id);
  const [checkoutVisible, setCheckoutVisible] = useState<boolean>(false);
  const [profileVisible, setProfileVisible] = useState<boolean>(false);
  const [activeResource, setActiveResource] = useState<Resource | null>(null);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);

  // Customer Profile State
  const [customerProfile, setCustomerProfile] = useState({
    name: 'Ravi Teja',
    phone: '+91 98765 43210',
    email: 'ravi.teja@customer.tirupati.in',
    city: 'Tirupati, AP',
  });

  // Stored customer bookings (seeded from Supabase)
  const [customerBookings, setCustomerBookings] = useState<
    (Booking & { provider_name?: string; resource_name?: string })[]
  >([]);

  const [confirmationToast, setConfirmationToast] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    try {
      const data = await fetchCustomerBookingsFromSupabase(DEMO_CUSTOMER_ID);
      if (data && data.length > 0) {
        setCustomerBookings(data);
      }
    } catch (e) {
      console.warn('Error loading customer bookings from Supabase:', e);
    }
  }, []);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setCurrentScreen('PROVIDER_DETAIL');
  };

  const handleProceedToHold = (resource: Resource, slot: Slot) => {
    setActiveResource(resource);
    setActiveSlot(slot);
    setCheckoutVisible(true);
  };

  const handlePaymentSuccess = async (bookingId: string) => {
    await loadBookings();
    setCheckoutVisible(false);
    setConfirmationToast(`Booking Confirmed on Supabase! Deposit ₹${activeResource?.deposit_amount} captured.`);
    setCurrentScreen('MY_BOOKINGS');

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

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Screen Router */}
      {currentScreen === 'HOME' && (
        <HomeScreen
          onSelectProvider={handleSelectProvider}
          onOpenMyBookings={() => setCurrentScreen('MY_BOOKINGS')}
          onOpenProfile={() => setProfileVisible(true)}
        />
      )}

      {currentScreen === 'PROVIDER_DETAIL' && (
        <ProviderDetailScreen
          providerId={selectedProviderId}
          onBack={() => setCurrentScreen('HOME')}
          onProceedToHold={handleProceedToHold}
        />
      )}

      {currentScreen === 'MY_BOOKINGS' && (
        <MyBookingsScreen
          onBack={() => setCurrentScreen('HOME')}
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
        onClose={() => setCheckoutVisible(false)}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* Customer Profile Modal */}
      <Modal
        visible={profileVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setProfileVisible(false)}
      >
        <View style={styles.profileModalOverlay}>
          <SafeAreaView style={styles.profileSheet}>
            <View style={styles.profileHeader}>
              <Text style={styles.profileTitle}>Customer Profile</Text>
              <TouchableOpacity
                style={styles.closeProfileBtn}
                onPress={() => setProfileVisible(false)}
              >
                <Text style={styles.closeProfileText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.profileContent}>
              <View style={styles.profileAvatarBox}>
                <Text style={styles.avatarEmoji}>👤</Text>
                <View>
                  <Text style={styles.profileName}>{customerProfile.name}</Text>
                  <Text style={styles.profileCity}>{customerProfile.city}</Text>
                </View>
              </View>

              <View style={styles.profileFields}>
                <View style={styles.profileField}>
                  <Text style={styles.fieldLabel}>MOBILE PHONE</Text>
                  <Text style={styles.fieldValue}>{customerProfile.phone}</Text>
                </View>

                <View style={styles.profileField}>
                  <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
                  <Text style={styles.fieldValue}>{customerProfile.email}</Text>
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
                  setCurrentScreen('MY_BOOKINGS');
                }}
              >
                <Text style={styles.viewBookingsFromProfileText}>
                  View Appointments ({customerBookings.length})
                </Text>
              </TouchableOpacity>
            </View>
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
    paddingBottom: 32,
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
});
