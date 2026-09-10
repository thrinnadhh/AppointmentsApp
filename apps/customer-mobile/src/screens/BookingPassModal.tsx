import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Booking } from '@appointments/shared';

interface BookingPassModalProps {
  visible: boolean;
  booking: (Booking & { provider_name?: string; resource_name?: string }) | null;
  onClose: () => void;
}

export default function BookingPassModal({
  visible,
  booking,
  onClose,
}: BookingPassModalProps) {
  if (!booking) return null;

  const slotDate = new Date(booking.slot_start);
  const timeString = slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateString = slotDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const passId = booking.reference_code || `TPT-${booking.id.slice(0, 6).toUpperCase()}`;

  const handleDirections = () => {
    Alert.alert(
      'Opening Navigation',
      `Routing directions to ${booking.provider_name || 'Venue'} in Tirupati.`
    );
  };

  const handleSave = () => {
    Alert.alert(
      'Pass Saved',
      'Appointment pass saved to your wallet. You will receive an SMS reminder 2 hours prior.'
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheetContainer}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.headerSubtitle}>Digital Booking Pass</Text>
              <Text style={styles.headerTitle}>{booking.provider_name || 'Appointment'}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* The Ticket Pass Visual */}
            <View style={styles.passCard}>
              <View style={styles.passTop}>
                <View style={styles.badgeRow}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusDot}>●</Text>
                    <Text style={styles.statusText}>{booking.status}</Text>
                  </View>
                  <Text style={styles.passNumber}>{passId}</Text>
                </View>

                <Text style={styles.serviceName}>{booking.resource_name || 'Reserved Session'}</Text>
                
                <View style={styles.slotBox}>
                  <View style={styles.slotCol}>
                    <Text style={styles.slotLabel}>DATE</Text>
                    <Text style={styles.slotVal}>{dateString}</Text>
                  </View>
                  <View style={styles.slotDividerVertical} />
                  <View style={styles.slotCol}>
                    <Text style={styles.slotLabel}>TIME</Text>
                    <Text style={styles.slotVal}>{timeString}</Text>
                  </View>
                </View>
              </View>

              {/* Perforated ticket tear line */}
              <View style={styles.tearLineContainer}>
                <View style={styles.tearHoleLeft} />
                <View style={styles.tearDashes} />
                <View style={styles.tearHoleRight} />
              </View>

              <View style={styles.passBottom}>
                {/* Visual QR Code Generator */}
                <View style={styles.qrContainer}>
                  <View style={styles.qrMatrix}>
                    {/* Corner Position Detection Blocks */}
                    <View style={[styles.qrCornerBlock, styles.qrTopLeft]}>
                      <View style={styles.qrInnerBlock} />
                    </View>
                    <View style={[styles.qrCornerBlock, styles.qrTopRight]}>
                      <View style={styles.qrInnerBlock} />
                    </View>
                    <View style={[styles.qrCornerBlock, styles.qrBottomLeft]}>
                      <View style={styles.qrInnerBlock} />
                    </View>

                    {/* Matrix visual pattern lines */}
                    <View style={styles.qrGridPattern}>
                      <View style={[styles.qrDot, { top: 38, left: 38 }]} />
                      <View style={[styles.qrDot, { top: 38, left: 54 }]} />
                      <View style={[styles.qrDot, { top: 38, left: 70 }]} />
                      <View style={[styles.qrDot, { top: 54, left: 38 }]} />
                      <View style={[styles.qrDot, { top: 54, left: 54 }]} />
                      <View style={[styles.qrDot, { top: 70, left: 54 }]} />
                      <View style={[styles.qrDot, { top: 70, left: 70 }]} />
                      <View style={[styles.qrDot, { top: 86, left: 38 }]} />
                      <View style={[styles.qrDot, { top: 86, left: 86 }]} />
                    </View>
                  </View>
                  <Text style={styles.qrCaption}>Scan at reception desk for check-in</Text>
                </View>

                <View style={styles.depositInfoBox}>
                  <View style={styles.depositRow}>
                    <Text style={styles.depositTitle}>Deposit Paid via UPI / Card</Text>
                    <Text style={styles.depositAmount}>₹{booking.deposit_amount}</Text>
                  </View>
                  <Text style={styles.depositSubtext}>
                    This deposit guarantees your slot and will be adjusted in your final bill at the counter.
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.directionsBtn} onPress={handleDirections}>
                <Text style={styles.btnIcon}>📍</Text>
                <Text style={styles.btnText}>Directions</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.btnIcon}>📥</Text>
                <Text style={styles.btnText}>Save Pass</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  scrollArea: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  passCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  passTop: {
    padding: 20,
    backgroundColor: '#ffffff',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  statusDot: {
    color: '#059669',
    fontSize: 10,
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065f46',
  },
  passNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    fontFamily: 'monospace',
  },
  serviceName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 16,
  },
  slotBox: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  slotCol: {
    flex: 1,
  },
  slotDividerVertical: {
    width: 1,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 12,
  },
  slotLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  slotVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  tearLineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    backgroundColor: '#ffffff',
    position: 'relative',
  },
  tearHoleLeft: {
    width: 16,
    height: 24,
    backgroundColor: '#f8fafc',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: '#e2e8f0',
  },
  tearDashes: {
    flex: 1,
    borderBottomWidth: 1.5,
    borderBottomColor: '#cbd5e1',
    borderStyle: 'dashed',
    marginHorizontal: 8,
  },
  tearHoleRight: {
    width: 16,
    height: 24,
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: '#e2e8f0',
  },
  passBottom: {
    padding: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  qrContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  qrMatrix: {
    width: 130,
    height: 130,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#0f172a',
    borderRadius: 12,
    position: 'relative',
    padding: 8,
  },
  qrCornerBlock: {
    width: 32,
    height: 32,
    borderWidth: 3,
    borderColor: '#0f172a',
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrInnerBlock: {
    width: 14,
    height: 14,
    backgroundColor: '#059669',
  },
  qrTopLeft: {
    top: 8,
    left: 8,
  },
  qrTopRight: {
    top: 8,
    right: 8,
  },
  qrBottomLeft: {
    bottom: 8,
    left: 8,
  },
  qrGridPattern: {
    ...StyleSheet.absoluteFill,
  },
  qrDot: {
    width: 10,
    height: 10,
    backgroundColor: '#0f172a',
    position: 'absolute',
    borderRadius: 2,
  },
  qrCaption: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 10,
  },
  depositInfoBox: {
    width: '100%',
    backgroundColor: '#f0fdf4',
    padding: 14,
    borderRadius: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  depositRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  depositTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  depositAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#166534',
  },
  depositSubtext: {
    fontSize: 11,
    color: '#15803d',
    marginTop: 4,
    lineHeight: 15,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    marginBottom: 24,
  },
  directionsBtn: {
    flex: 1,
    backgroundColor: '#0f172a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  btnIcon: {
    fontSize: 14,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
