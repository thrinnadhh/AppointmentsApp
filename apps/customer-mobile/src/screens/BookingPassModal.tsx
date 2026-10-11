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
  Platform,
} from 'react-native';
import { Booking } from '@appointments/shared';
import { fetchBookingCheckinCode, supabase } from '../services/api';

interface BookingPassModalProps {
  visible: boolean;
  booking: (Booking & { provider_name?: string; resource_name?: string }) | null;
  onClose: () => void;
  onMarkReached?: (bookingId: string) => Promise<void>;
}

export default function BookingPassModal({
  visible,
  booking,
  onClose,
  onMarkReached,
}: BookingPassModalProps) {
  const [isMarkingReached, setIsMarkingReached] = React.useState(false);
  const [checkinCode, setCheckinCode] = React.useState<string | null>(null);
  const [liveStatus, setLiveStatus] = React.useState<string>(booking?.status || 'HELD');
  const [liveCheckedInAt, setLiveCheckedInAt] = React.useState<string | null>(booking?.checked_in_at || null);
  const [liveQueuePosition, setLiveQueuePosition] = React.useState<number | null>(booking?.queue_position || null);
  const [liveWaitMinutes, setLiveWaitMinutes] = React.useState<number | null>(booking?.estimated_wait_minutes || null);

  React.useEffect(() => {
    if (booking) {
      setLiveStatus(booking.status);
      setLiveCheckedInAt(booking.checked_in_at || null);
      setLiveQueuePosition(booking.queue_position || null);
      setLiveWaitMinutes(booking.estimated_wait_minutes || null);
    }
  }, [booking?.status, booking?.checked_in_at, booking?.queue_position, booking?.estimated_wait_minutes]);

  React.useEffect(() => {
    if (!booking?.id || !visible) return;
    if (booking.status !== 'CONFIRMED' && booking.status !== 'CHECKED_IN') return;

    let isMounted = true;
    fetchBookingCheckinCode(booking.id).then((code) => {
      if (isMounted) setCheckinCode(code);
    });

    return () => {
      isMounted = false;
    };
  }, [booking?.id, booking?.status, visible]);

  // Reactive Supabase Realtime update for live check-in and late queue
  React.useEffect(() => {
    if (!booking?.id || !visible) return;

    const channel = supabase
      .channel(`modal-checkin-${booking.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${booking.id}`,
        },
        (payload) => {
          const newRec = payload.new as {
            status?: string;
            checked_in_at?: string;
            queue_position?: number | null;
            estimated_wait_minutes?: number | null;
          };
          if (newRec?.status) {
            setLiveStatus(newRec.status);
          }
          if (newRec?.checked_in_at) {
            setLiveCheckedInAt(newRec.checked_in_at);
          }
          if (newRec?.queue_position !== undefined) {
            setLiveQueuePosition(newRec.queue_position);
          }
          if (newRec?.estimated_wait_minutes !== undefined) {
            setLiveWaitMinutes(newRec.estimated_wait_minutes);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [booking?.id, visible]);

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

  const nowMs = Date.now();
  const slotMs = slotDate.getTime();
  const windowOpenMs = slotMs - 60 * 60 * 1000;
  const isWindowOpen = nowMs >= windowOpenMs;
  const isCheckedIn = liveStatus === 'CHECKED_IN' || Boolean(liveCheckedInAt);
  const currentQueuePosition = liveQueuePosition ?? booking.queue_position;
  const currentWaitMinutes = liveWaitMinutes ?? booking.estimated_wait_minutes;


  const handleSayReached = async () => {
    if (!booking) return;
    setIsMarkingReached(true);
    try {
      if (onMarkReached) {
        await onMarkReached(booking.id);
      }
      Alert.alert(
        'Arrival Confirmed! 📍',
        'The venue reception has been notified that you have reached in person.'
      );
    } catch {
      Alert.alert('Notice', 'Unable to mark reached right now. Please inform the receptionist.');
    } finally {
      setIsMarkingReached(false);
    }
  };

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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.statusPill, isCheckedIn && styles.statusPillCheckedIn]}>
                      <Text style={[styles.statusDot, isCheckedIn && { color: '#047857' }]}>●</Text>
                      <Text style={[styles.statusText, isCheckedIn && { color: '#047857' }]}>
                        {isCheckedIn ? 'CHECKED_IN' : liveStatus}
                      </Text>
                    </View>
                    {isCheckedIn ? (
                      <View style={styles.checkedInBadge} testID="pass-checkedin-badge">
                        <Text style={styles.checkedInBadgeText}>✓ PRESENT</Text>
                      </View>
                    ) : booking.is_present ? (
                      <View style={styles.presentPill} testID="pass-present-pill">
                        <Text style={styles.presentPillText}>📍 AT VENUE</Text>
                      </View>
                    ) : null}
                    {currentQueuePosition ? (
                      <View style={styles.lateTurnPill} testID="pass-late-turn-pill">
                        <Text style={styles.lateTurnPillText}>⏰ TURN #{currentQueuePosition}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.passNumber} testID="pass-reference-code">{passId}</Text>
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
                {/* RECEPTION CHECK-IN PANEL */}
                {isCheckedIn ? (
                  /* 1. Verified & Checked In: Hide code, show verified banner */
                  <View style={styles.checkedInCard} testID="pass-checked-in-card">
                    <View style={styles.checkedInRow}>
                      <View style={styles.checkedInCheckCircle}>
                        <Text style={styles.checkedInCheckMark}>✓</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.checkedInTitle}>You are checked in</Text>
                        <Text style={styles.checkedInTime} testID="pass-checked-in-time">
                          {liveCheckedInAt
                            ? `Reception verified at ${new Date(liveCheckedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : 'Reception desk verified arrival'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.checkedInNotice}>
                      Please have a seat in the waiting lobby. Your specialist will attend to you shortly.
                    </Text>
                  </View>
                ) : (liveStatus === 'CONFIRMED' && isWindowOpen) ? (
                  /* 2. Check-in Window Open: Show code in large type */
                  <View style={styles.checkinCodeBox} testID="pass-checkin-code-box">
                    <View style={styles.checkinCodeHeader}>
                      <Text style={styles.checkinCodeIcon}>🎟️</Text>
                      <Text style={styles.checkinCodeBadge}>RECEPTION CHECK-IN CODE</Text>
                    </View>
                    <Text style={styles.checkinCodeNumber} testID="pass-checkin-code-number">
                      {checkinCode || '••••'}
                    </Text>
                    <Text style={styles.checkinCodeInstruction}>
                      Show this code at reception
                    </Text>
                    <Text style={styles.checkinCodeSubtext}>
                      Tell this OTP to reception staff upon arrival to check in
                    </Text>
                  </View>
                ) : (liveStatus === 'CONFIRMED' && !isWindowOpen) ? (
                  /* 3. Window Not Yet Open: Friendly upcoming notice */
                  <View style={styles.checkinEarlyBox} testID="pass-checkin-early-box">
                    <Text style={styles.checkinEarlyIcon}>🔒</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkinEarlyTitle}>Check-in Code Opening Soon</Text>
                      <Text style={styles.checkinEarlySubtitle}>
                        Your 4-digit reception OTP will appear here 60 minutes before your slot (at {new Date(windowOpenMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Decorative Visual QR Code */}
                {!isCheckedIn && (
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
                )}

                <View style={styles.depositInfoBox}>
                  <View style={styles.depositRow}>
                    <Text style={styles.depositTitle}>Deposit Paid via UPI / Card</Text>
                    <Text style={styles.depositAmount}>₹{booking.deposit_amount}</Text>
                  </View>
                  <Text style={styles.depositSubtext}>
                    This deposit guarantees your slot and will be adjusted in your final bill at the counter.
                  </Text>
                </View>

                {/* Expected Arrival & Zero-Wait Schedule */}
                <View style={styles.expectedTimeBox} testID="pass-expected-time">
                  <View style={styles.expectedTimeHeader}>
                    <Text style={styles.expectedTimeIcon}>⏱️</Text>
                    <Text style={styles.expectedTimeTitle}>Expected Time & Zero-Wait Advice</Text>
                  </View>
                  <Text style={styles.expectedTimeText}>
                    Scheduled Slot: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{timeString}</Text> | Expected Arrival: <Text style={{ fontWeight: '700', color: '#0284c7' }}>10 mins prior</Text> | Est. Consultation Wait: <Text style={{ fontWeight: '700', color: '#059669' }}>0–5 mins</Text> (Zero-Wait OPD Token #{passId.slice(-3)})
                  </Text>
                </View>

                {/* Late Arrival Queue Token or Grace Reminder */}
                {currentQueuePosition ? (
                  <View style={styles.lateQueueActiveBox} testID="pass-late-queue-token">
                    <View style={styles.lateQueueActiveHeader}>
                      <View style={styles.lateQueueBadgePill}>
                        <Text style={styles.lateQueueBadgeIcon}>⏰</Text>
                        <Text style={styles.lateQueueBadgeText}>LATE TURN ASSIGNED</Text>
                      </View>
                      <Text style={styles.lateQueueTokenNumber} testID="pass-late-token-number">
                        Token #{currentQueuePosition}
                      </Text>
                    </View>
                    <Text style={styles.lateQueueNoticeText}>
                      You have been accommodated after 2 member appointments due to late arrival.
                    </Text>
                    {currentWaitMinutes ? (
                      <View style={styles.lateWaitRow}>
                        <Text style={styles.lateWaitLabel}>Estimated Wait:</Text>
                        <Text style={styles.lateWaitVal} testID="pass-late-wait-minutes">
                          ~{currentWaitMinutes} mins
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  (liveStatus === 'CONFIRMED' || isCheckedIn) && (
                    <View style={styles.lateArrivalPassNote} testID="pass-late-arrival-note">
                      <View style={styles.lateArrivalPassHeader}>
                        <Text style={styles.lateArrivalPassIcon}>⏱️</Text>
                        <Text style={styles.lateArrivalPassTitle}>Late Arrival Rule (+2 Token Buffer)</Text>
                      </View>
                      <Text style={styles.lateArrivalPassText}>
                        Arriving late? Don't worry! Tap <Text style={{ fontWeight: '700', color: '#059669' }}>"I've Reached"</Text> below when you arrive. You will be placed <Text style={{ fontWeight: '700', color: '#0f172a' }}>2 tokens after the ongoing token</Text> (e.g. token #10 ongoing → queued at #12).
                      </Text>
                    </View>
                  )
                )}
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.actionRow}>
              {(liveStatus === 'CONFIRMED' || isCheckedIn) && (
                isCheckedIn ? (
                  <View style={styles.reachedPill} testID="pass-reached-status">
                    <Text style={styles.btnIcon}>✓</Text>
                    <Text style={styles.reachedPillText}>Checked In</Text>
                  </View>
                ) : booking.is_present ? (
                  <View style={styles.reachedPill} testID="pass-reached-status">
                    <Text style={styles.btnIcon}>✓</Text>
                    <Text style={styles.reachedPillText}>At Venue</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.reachedActionBtn}
                    onPress={handleSayReached}
                    disabled={isMarkingReached}
                    testID="pass-say-reached-btn"
                  >
                    <Text style={styles.btnIcon}>📍</Text>
                    <Text style={styles.reachedActionBtnText}>
                      {isMarkingReached ? 'Notifying…' : "I've Reached"}
                    </Text>
                  </TouchableOpacity>
                )
              )}
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
  presentPill: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  presentPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065f46',
  },
  reachedActionBtn: {
    flex: 1.2,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  reachedActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  reachedPill: {
    flex: 1.1,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  reachedPillText: {
    color: '#15803d',
    fontSize: 12,
    fontWeight: '800',
  },
  expectedTimeBox: {
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
    marginTop: 12,
  },
  expectedTimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  expectedTimeIcon: {
    fontSize: 14,
  },
  expectedTimeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369a1',
  },
  expectedTimeText: {
    fontSize: 11,
    color: '#0c4a6e',
    lineHeight: 16,
  },
  lateArrivalPassNote: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginTop: 12,
  },
  lateArrivalPassHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  lateArrivalPassIcon: {
    fontSize: 14,
  },
  lateArrivalPassTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
  },
  lateArrivalPassText: {
    fontSize: 11,
    color: '#78350f',
    lineHeight: 15,
  },
  statusPillCheckedIn: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  checkedInBadge: {
    backgroundColor: '#047857',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  checkedInBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  checkedInCard: {
    backgroundColor: '#ecfdf5',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#10b981',
    marginBottom: 16,
  },
  checkedInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  checkedInCheckCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedInCheckMark: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  checkedInTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#064e3b',
  },
  checkedInTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#047857',
    marginTop: 2,
  },
  checkedInNotice: {
    fontSize: 12,
    color: '#065f46',
    lineHeight: 16,
  },
  checkinCodeBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  checkinCodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  checkinCodeIcon: {
    fontSize: 14,
  },
  checkinCodeBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 1,
  },
  checkinCodeNumber: {
    fontSize: 40,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: 8,
    marginVertical: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  checkinCodeInstruction: {
    fontSize: 13,
    fontWeight: '800',
    color: '#047857',
    marginTop: 4,
  },
  checkinCodeSubtext: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
  },
  checkinEarlyBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  checkinEarlyIcon: {
    fontSize: 16,
    marginTop: 2,
  },
  checkinEarlyTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 2,
  },
  checkinEarlySubtitle: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
  },
  lateTurnPill: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  lateTurnPillText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  lateQueueActiveBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    marginBottom: 16,
  },
  lateQueueActiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  lateQueueBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  lateQueueBadgeIcon: {
    fontSize: 12,
  },
  lateQueueBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400e',
    letterSpacing: 0.5,
  },
  lateQueueTokenNumber: {
    fontSize: 18,
    fontWeight: '900',
    color: '#b45309',
    letterSpacing: 0.5,
  },
  lateQueueNoticeText: {
    fontSize: 12,
    color: '#78350f',
    lineHeight: 16,
    marginBottom: 6,
  },
  lateWaitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  lateWaitLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
  },
  lateWaitVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#b45309',
  },
});
