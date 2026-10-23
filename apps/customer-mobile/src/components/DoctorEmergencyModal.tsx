import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Booking } from '@appointments/shared';
import { chooseEmergencyOption } from '../services/api';

interface DoctorEmergencyModalProps {
  visible: boolean;
  booking: (Booking & { provider_name?: string; resource_name?: string }) | null;
  onChoiceResolved: (choice: 'WAIT' | 'RESCHEDULE' | 'REFUND', bookingId: string) => void;
  onRequestReschedule: (booking: Booking & { provider_name?: string; resource_name?: string }) => void;
  onClose: () => void;
}

export default function DoctorEmergencyModal({
  visible,
  booking,
  onChoiceResolved,
  onRequestReschedule,
  onClose,
}: DoctorEmergencyModalProps) {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!booking) return null;

  const doctorArrived = Boolean(booking.emergency_doctor_arrived);
  const totalRefundAmount = Number(booking.total_charged || ((booking.deposit_amount || 100) + (booking.platform_fee || 10)));
  const slotDate = new Date(booking.slot_start);
  const timeStr = slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleRefund = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await chooseEmergencyOption(booking.id, 'REFUND');
      if (!res.success) {
        throw new Error(res.error || 'Failed to process refund');
      }
      onChoiceResolved('REFUND', booking.id);
      Alert.alert(
        '100% Refund Initiated 💸',
        `₹${res.refund_amount || totalRefundAmount} (100% deposit + platform fee) has been refunded to your original payment method.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Refund failed';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWait = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await chooseEmergencyOption(booking.id, 'WAIT');
      if (!res.success) {
        throw new Error(res.error || 'Failed to confirm wait status');
      }
      onChoiceResolved('WAIT', booking.id);
      Alert.alert(
        'Standby Priority Maintained ⏳',
        'You have chosen to wait. Your appointment queue spot remains active. We will notify you as soon as the doctor resumes or standby relief arrives.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReschedule = () => {
    onClose();
    onRequestReschedule(booking);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card} testID="doctor-emergency-modal">
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>🚨</Text>
          </View>

          <Text style={styles.headline}>Doctor Emergency Update</Text>
          <View style={styles.emergencyPill}>
            <Text style={styles.emergencyPillText}>Due to emergency, doctor is not available</Text>
          </View>

          <View style={styles.detailsBox}>
            <Text style={styles.doctorName}>{booking.resource_name || 'Consultant Doctor'}</Text>
            <Text style={styles.providerName}>{booking.provider_name || 'Hospital / Clinic'}</Text>
            <Text style={styles.slotTime}>Scheduled: Today at {timeStr}</Text>
          </View>

          <Text style={styles.explanationText}>
            {doctorArrived
              ? 'The doctor arrived at the clinic but had an urgent unscheduled emergency mid-session. Under our hospital policy, you may wait on standby, reschedule to another slot, or receive a 100% full refund.'
              : 'The doctor is unable to attend today due to an urgent medical emergency. You may reschedule your consultation at no charge or receive a 100% full refund.'}
          </Text>

          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}

          {submitting ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#dc2626" />
              <Text style={styles.loadingText}>Processing your request...</Text>
            </View>
          ) : (
            <View style={styles.actionContainer}>
              {doctorArrived && (
                <TouchableOpacity
                  style={[styles.btn, styles.btnWait]}
                  onPress={handleWait}
                  testID="btn-emergency-wait"
                >
                  <Text style={styles.btnWaitText}>⏳ Wait for Doctor / Relief</Text>
                  <Text style={styles.btnSub}>Maintain priority queue status</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.btn, styles.btnReschedule]}
                onPress={handleReschedule}
                testID="btn-emergency-reschedule"
              >
                <Text style={styles.btnRescheduleText}>📅 Reschedule Appointment</Text>
                <Text style={styles.btnSub}>Choose another slot at zero cost</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnRefund]}
                onPress={handleRefund}
                testID="btn-emergency-refund"
              >
                <Text style={styles.btnRefundText}>💸 100% Full Refund (₹{totalRefundAmount})</Text>
                <Text style={styles.btnSubRefund}>100% deposit + platform fee returned</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fee2e2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconEmoji: {
    fontSize: 32,
  },
  headline: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
    textAlign: 'center',
  },
  emergencyPill: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 16,
  },
  emergencyPillText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '700',
  },
  detailsBox: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  doctorName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  providerName: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '600',
  },
  slotTime: {
    fontSize: 12,
    color: '#0284c7',
    fontWeight: '700',
    marginTop: 4,
  },
  explanationText: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  errorBox: {
    width: '100%',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    padding: 10,
    borderRadius: 10,
    marginBottom: 14,
  },
  errorText: {
    color: '#e11d48',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  actionContainer: {
    width: '100%',
    gap: 10,
  },
  btn: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWait: {
    backgroundColor: '#fef3c7',
    borderWidth: 1.5,
    borderColor: '#fcd34d',
  },
  btnWaitText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#92400e',
  },
  btnReschedule: {
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
    borderColor: '#93c5fd',
  },
  btnRescheduleText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  btnRefund: {
    backgroundColor: '#059669',
  },
  btnRefundText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  btnSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },
  btnSubRefund: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d1fae5',
    marginTop: 2,
  },
});
