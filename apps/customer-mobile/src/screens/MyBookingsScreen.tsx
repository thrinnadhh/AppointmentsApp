import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Booking } from '@appointments/shared';

interface MyBookingsScreenProps {
  onBack: () => void;
  bookings: (Booking & { provider_name?: string; resource_name?: string })[];
  onCancelBooking: (bookingId: string) => void;
}

export default function MyBookingsScreen({
  onBack,
  bookings,
  onCancelBooking,
}: MyBookingsScreenProps) {
  const handleCancelClick = (bookingId: string, slotStart: string) => {
    const diffHours = (new Date(slotStart).getTime() - Date.now()) / (1000 * 60 * 60);

    if (diffHours > 1) {
      Alert.alert(
        'Cancel Appointment',
        'You are cancelling more than 1 hour in advance. Your deposit will be refunded in full.',
        [
          { text: 'Keep Booking', style: 'cancel' },
          { text: 'Confirm & Refund', style: 'destructive', onPress: () => onCancelBooking(bookingId) },
        ]
      );
    } else {
      Alert.alert(
        'Late Cancellation Warning',
        'You are cancelling inside the 1-hour window. Under the policy, your deposit will be forfeited to the business.',
        [
          { text: 'Keep Booking', style: 'cancel' },
          { text: 'Forfeit & Cancel', style: 'destructive', onPress: () => onCancelBooking(bookingId) },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back to Browse</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Appointments</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {bookings.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={styles.emptyTitle}>No Appointments Yet</Text>
            <Text style={styles.emptySubtitle}>
              Explore Tirupati clinics, restaurants, turfs, and salons to book your first slot.
            </Text>
          </View>
        ) : (
          bookings.map((booking) => {
            const slotDate = new Date(booking.slot_start);
            const timeString = slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateString = slotDate.toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            });

            return (
              <View key={booking.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.providerName}>{booking.provider_name || 'Service Provider'}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      booking.status === 'CONFIRMED'
                        ? styles.statusConfirmed
                        : booking.status === 'CANCELLED'
                        ? styles.statusCancelled
                        : styles.statusCompleted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        booking.status === 'CONFIRMED'
                          ? styles.statusTextConfirmed
                          : booking.status === 'CANCELLED'
                          ? styles.statusTextCancelled
                          : styles.statusTextCompleted,
                      ]}
                    >
                      {booking.status}
                    </Text>
                  </View>
                </View>

                <Text style={styles.resourceName}>{booking.resource_name || 'Staff'}</Text>

                <View style={styles.timeRow}>
                  <Text style={styles.timeIcon}>🕒</Text>
                  <Text style={styles.timeText}>
                    {timeString} • {dateString}
                  </Text>
                </View>

                <View style={styles.cardFooter}>
                  <View style={styles.depositInfo}>
                    <Text style={styles.depositLabel}>Deposit Paid:</Text>
                    <Text style={styles.depositValue}>₹{booking.deposit_amount}</Text>
                  </View>

                  {booking.status === 'CONFIRMED' && (
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => handleCancelClick(booking.id, booking.slot_start)}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  providerName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusConfirmed: {
    backgroundColor: '#dcfce7',
  },
  statusCancelled: {
    backgroundColor: '#fee2e2',
  },
  statusCompleted: {
    backgroundColor: '#f1f5f9',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusTextConfirmed: {
    color: '#15803d',
  },
  statusTextCancelled: {
    color: '#b91c1c',
  },
  statusTextCompleted: {
    color: '#475569',
  },
  resourceName: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  timeIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  depositInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  depositLabel: {
    fontSize: 11,
    color: '#64748b',
    marginRight: 4,
  },
  depositValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  cancelBtn: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cancelBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#dc2626',
  },
});
