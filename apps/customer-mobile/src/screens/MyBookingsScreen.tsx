import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Modal,
} from 'react-native';
import { Booking } from '@appointments/shared';
import BookingPassModal from './BookingPassModal';

interface MyBookingsScreenProps {
  onBack: () => void;
  bookings: (Booking & { provider_name?: string; resource_name?: string })[];
  onCancelBooking: (bookingId: string) => void;
  onRescheduleBooking?: (bookingId: string, newSlotStart: string, newSlotEnd: string) => Promise<void>;
}

export default function MyBookingsScreen({
  onBack,
  bookings,
  onCancelBooking,
  onRescheduleBooking,
}: MyBookingsScreenProps) {
  const [selectedPassBooking, setSelectedPassBooking] = useState<
    (Booking & { provider_name?: string; resource_name?: string }) | null
  >(null);

  // Reschedule state
  const [rescheduleTarget, setRescheduleTarget] = useState<
    (Booking & { provider_name?: string; resource_name?: string }) | null
  >(null);
  const [selectedDayOffset, setSelectedDayOffset] = useState<number>(1);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('11:00 AM');
  const [isSubmittingReschedule, setIsSubmittingReschedule] = useState(false);

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

  const handleConfirmReschedule = async () => {
    if (!rescheduleTarget || !onRescheduleBooking) return;
    setIsSubmittingReschedule(true);
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + selectedDayOffset);

      // Parse time string e.g. "11:00 AM"
      const [time, modifier] = selectedTimeSlot.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;

      targetDate.setHours(hours, minutes, 0, 0);
      const newStart = targetDate.toISOString();
      const newEnd = new Date(targetDate.getTime() + 30 * 60000).toISOString();

      await onRescheduleBooking(rescheduleTarget.id, newStart, newEnd);
      setRescheduleTarget(null);
      Alert.alert('Appointment Rescheduled', 'Your slot has been updated successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not reschedule appointment';
      Alert.alert('Reschedule Failed', msg);
    } finally {
      setIsSubmittingReschedule(false);
    }
  };

  const availableTimes = ['10:00 AM', '11:30 AM', '02:00 PM', '03:30 PM', '05:00 PM', '06:30 PM'];

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
                    <View style={styles.actionButtonsGroup}>
                      <TouchableOpacity
                        style={styles.passBtn}
                        onPress={() => setSelectedPassBooking(booking)}
                      >
                        <Text style={styles.passBtnText}>🎟️ Pass</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.rescheduleBtn}
                        onPress={() => setRescheduleTarget(booking)}
                      >
                        <Text style={styles.rescheduleBtnText}>🔄 Reschedule</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.cancelBtn}
                        onPress={() => handleCancelClick(booking.id, booking.slot_start)}
                      >
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Digital Pass / QR Voucher Modal */}
      <BookingPassModal
        visible={!!selectedPassBooking}
        booking={selectedPassBooking}
        onClose={() => setSelectedPassBooking(null)}
      />

      {/* Reschedule Modal */}
      <Modal
        visible={!!rescheduleTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setRescheduleTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.rescheduleSheet}>
            <View style={styles.rescheduleHeader}>
              <View>
                <Text style={styles.rescheduleSub}>Reschedule Slot</Text>
                <Text style={styles.rescheduleTitle}>{rescheduleTarget?.provider_name}</Text>
              </View>
              <TouchableOpacity
                style={styles.closeRescheduleBtn}
                onPress={() => setRescheduleTarget(null)}
              >
                <Text style={styles.closeRescheduleText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.rescheduleBody}>
              <Text style={styles.rescheduleSectionTitle}>Select New Date</Text>
              <View style={styles.daysRow}>
                {[1, 2, 3, 4].map((offset) => {
                  const d = new Date();
                  d.setDate(d.getDate() + offset);
                  const isSelected = selectedDayOffset === offset;
                  return (
                    <TouchableOpacity
                      key={offset}
                      style={[styles.dayCard, isSelected && styles.dayCardActive]}
                      onPress={() => setSelectedDayOffset(offset)}
                    >
                      <Text style={[styles.dayCardDay, isSelected && styles.dayCardTextActive]}>
                        {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                      </Text>
                      <Text style={[styles.dayCardNum, isSelected && styles.dayCardTextActive]}>
                        {d.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.rescheduleSectionTitle}>Select Time Slot</Text>
              <View style={styles.timesGrid}>
                {availableTimes.map((time) => {
                  const isSelected = selectedTimeSlot === time;
                  return (
                    <TouchableOpacity
                      key={time}
                      style={[styles.timeChip, isSelected && styles.timeChipActive]}
                      onPress={() => setSelectedTimeSlot(time)}
                    >
                      <Text style={[styles.timeChipText, isSelected && styles.timeChipTextActive]}>
                        {time}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.rescheduleNotice}>
                <Text style={styles.rescheduleNoticeText}>
                  💡 Your deposit of ₹{rescheduleTarget?.deposit_amount} will automatically transfer to the new slot without any extra charge.
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.confirmRescheduleBtn,
                  isSubmittingReschedule && styles.btnDisabled,
                ]}
                onPress={handleConfirmReschedule}
                disabled={isSubmittingReschedule}
              >
                <Text style={styles.confirmRescheduleText}>
                  {isSubmittingReschedule ? 'Rescheduling...' : 'Confirm Reschedule'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    flexDirection: 'column',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
    gap: 8,
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
  actionButtonsGroup: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  passBtn: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  passBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  rescheduleBtn: {
    backgroundColor: '#f0f9ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  rescheduleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  cancelBtn: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 10,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  rescheduleSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  rescheduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rescheduleSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
  },
  rescheduleTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  closeRescheduleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeRescheduleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  rescheduleBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  rescheduleSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 10,
    marginTop: 8,
  },
  daysRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  dayCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dayCardActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#059669',
  },
  dayCardDay: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  dayCardNum: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  dayCardTextActive: {
    color: '#059669',
  },
  timesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  timeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timeChipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  timeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  timeChipTextActive: {
    color: '#ffffff',
  },
  rescheduleNotice: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  rescheduleNoticeText: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  confirmRescheduleBtn: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  confirmRescheduleText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});
