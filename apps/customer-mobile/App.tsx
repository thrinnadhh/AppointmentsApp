import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Resource, Slot, Booking } from '@appointments/shared';
import HomeScreen from './src/screens/HomeScreen';
import ProviderDetailScreen from './src/screens/ProviderDetailScreen';
import CheckoutModal from './src/screens/CheckoutModal';
import MyBookingsScreen from './src/screens/MyBookingsScreen';
import { 
  MOCK_PROVIDERS, 
  fetchCustomerBookingsFromSupabase, 
  cancelBookingOnSupabase 
} from './src/services/api';

type ScreenType = 'HOME' | 'PROVIDER_DETAIL' | 'MY_BOOKINGS';

const DEMO_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('HOME');
  const [selectedProviderId, setSelectedProviderId] = useState<string>(MOCK_PROVIDERS[0].id);
  const [checkoutVisible, setCheckoutVisible] = useState<boolean>(false);
  const [activeResource, setActiveResource] = useState<Resource | null>(null);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);
  
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


  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Screen Router */}
      {currentScreen === 'HOME' && (
        <HomeScreen
          onSelectProvider={handleSelectProvider}
          onOpenMyBookings={() => setCurrentScreen('MY_BOOKINGS')}
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
});
