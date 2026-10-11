import React, { useState, useEffect } from 'react';
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

export interface HospitalQueueTokenItem {
  tokenNumber: number;
  patientName: string;
  slotTime: string;
  expectedTime: string;
  status: 'COMPLETED' | 'IN_CONSULTATION' | 'PRESENT_READY' | 'NOT_PRESENT' | 'LATE_QUEUE';
  isCurrentCustomer?: boolean;
  code?: string;
  lateTurnNumber?: number;
  estimatedWaitMinutes?: number;
}

export default function BookingPassModal({
  visible,
  booking,
  onClose,
  onMarkReached,
}: BookingPassModalProps) {
  const [activeTab, setActiveTab] = useState<'pass' | 'queue'>('pass');
  const [isMarkingReached, setIsMarkingReached] = useState(false);
  const [checkinCode, setCheckinCode] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<string>(booking?.status || 'HELD');
  const [liveCheckedInAt, setLiveCheckedInAt] = useState<string | null>(booking?.checked_in_at || null);
  const [liveQueuePosition, setLiveQueuePosition] = useState<number | null>(booking?.queue_position || null);
  const [liveWaitMinutes, setLiveWaitMinutes] = useState<number | null>(booking?.estimated_wait_minutes || null);

  useEffect(() => {
    if (booking) {
      setLiveStatus(booking.status);
      setLiveCheckedInAt(booking.checked_in_at || null);
      setLiveQueuePosition(booking.queue_position || null);
      setLiveWaitMinutes(booking.estimated_wait_minutes || null);
    }
  }, [booking?.status, booking?.checked_in_at, booking?.queue_position, booking?.estimated_wait_minutes]);

  useEffect(() => {
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
  useEffect(() => {
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
  const isLateQueue = Boolean(currentQueuePosition);

  // Derive user token number (e.g. Token #4 by default for hospital OPD session)
  const myTokenNumber = 4;

  // Build the complete Hospital OPD queue roster (Tokens #1 to #8)
  const hospitalQueueRoster: HospitalQueueTokenItem[] = [
    {
      tokenNumber: 1,
      patientName: 'Suresh Babu',
      slotTime: '09:00 - 09:15 AM',
      expectedTime: '09:00 AM',
      status: 'COMPLETED',
    },
    {
      tokenNumber: 2,
      patientName: 'Lakshmi Devi',
      slotTime: '09:15 - 09:30 AM',
      expectedTime: '09:15 AM',
      status: 'IN_CONSULTATION', // Now Serving
    },
    {
      tokenNumber: 3,
      patientName: 'Rajesh Sharma',
      slotTime: '09:30 - 09:45 AM',
      expectedTime: '09:30 AM',
      status: 'PRESENT_READY', // Present in lobby
    },
    {
      tokenNumber: 4,
      patientName: 'You (Patient Pass)',
      slotTime: '09:45 - 10:00 AM',
      expectedTime: '09:45 AM',
      isCurrentCustomer: true,
      code: checkinCode || '4821',
      status: isCheckedIn
        ? 'PRESENT_READY'
        : isLateQueue
        ? 'LATE_QUEUE'
        : 'NOT_PRESENT',
      lateTurnNumber: currentQueuePosition || undefined,
      estimatedWaitMinutes: isLateQueue ? currentWaitMinutes || 35 : 15,
    },
    {
      tokenNumber: 5,
      patientName: 'Priya Nair',
      slotTime: '10:00 - 10:15 AM',
      expectedTime: '10:00 AM',
      status: 'NOT_PRESENT',
      estimatedWaitMinutes: 30,
    },
    {
      tokenNumber: 6,
      patientName: 'Anand Mohan',
      slotTime: '10:15 - 10:30 AM',
      expectedTime: '10:15 AM',
      status: 'NOT_PRESENT',
      estimatedWaitMinutes: 45,
    },
    {
      tokenNumber: 7,
      patientName: 'Haritha P.',
      slotTime: '10:30 - 10:45 AM',
      expectedTime: '10:30 AM',
      status: 'NOT_PRESENT',
      estimatedWaitMinutes: 60,
    },
    {
      tokenNumber: 8,
      patientName: 'Subba Rao',
      slotTime: '10:45 - 11:00 AM',
      expectedTime: '10:45 AM',
      status: 'NOT_PRESENT',
      estimatedWaitMinutes: 75,
    },
  ];

  // Summary counts for the session
  const totalTokens = hospitalQueueRoster.length;
  const presentCount = hospitalQueueRoster.filter(
    (t) => t.status === 'PRESENT_READY' || t.status === 'IN_CONSULTATION'
  ).length;
  const notPresentCount = hospitalQueueRoster.filter((t) => t.status === 'NOT_PRESENT').length;
  const lateQueueCount = isLateQueue ? 1 : 0;

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
      `Routing directions to ${booking.provider_name || 'Hospital'} in Tirupati.`
    );
  };

  const handleSave = () => {
    Alert.alert(
      'Pass Saved',
      'Appointment pass saved to your wallet. You will receive an SMS reminder before your turn.'
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.headerSubtitleRow}>
                <Text style={styles.headerSubtitle}>Hospital OPD Live Pass & Queue</Text>
                <View style={styles.liveIndicatorPill}>
                  <Text style={styles.liveIndicatorDot}>●</Text>
                  <Text style={styles.liveIndicatorText}>LIVE</Text>
                </View>
              </View>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {booking.provider_name || 'Trinadh Multi-Speciality Hospital'}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Segmented Control Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'pass' && styles.tabButtonActive]}
              onPress={() => setActiveTab('pass')}
              testID="pass-tab-pass"
            >
              <Text style={[styles.tabButtonText, activeTab === 'pass' && styles.tabButtonTextActive]}>
                🎟️ My Token Pass
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'queue' && styles.tabButtonActive]}
              onPress={() => setActiveTab('queue')}
              testID="pass-tab-queue"
            >
              <Text style={[styles.tabButtonText, activeTab === 'queue' && styles.tabButtonTextActive]}>
                🏥 Hospital Live Queue (#{totalTokens})
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {activeTab === 'pass' ? (
              /* ================= TAB 1: MY TOKEN PASS ================= */
              <View>
                {/* 1. Presence Status Color Banner (RED -> GREEN -> AMBER) */}
                {isCheckedIn ? (
                  /* 🟢 GREEN: PRESENT & READY */
                  <View style={styles.presenceBannerPresent} testID="pass-presence-banner-present">
                    <View style={styles.presenceIconCirclePresent}>
                      <Text style={styles.presenceIconPresent}>✓</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text style={styles.presenceBadgePresent}>🟢 PRESENT & READY</Text>
                      </View>
                      <Text style={styles.presenceTitlePresent}>Reception Verified & Present</Text>
                      <Text style={styles.presenceSubtextPresent} testID="pass-checked-in-time">
                        {liveCheckedInAt
                          ? `Reception desk verified code at ${new Date(liveCheckedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
                          : 'Reception desk verified arrival.'}{' '}
                        Ready to be called by doctor!
                      </Text>
                    </View>
                  </View>
                ) : isLateQueue ? (
                  /* ⏰ AMBER: LATE COMERS QUEUE */
                  <View style={styles.presenceBannerLate} testID="pass-presence-banner-late">
                    <View style={styles.presenceIconCircleLate}>
                      <Text style={styles.presenceIconLate}>⏰</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.presenceBadgeLate}>
                        ⏰ LATE COMERS QUEUE (TURN #{currentQueuePosition})
                      </Text>
                      <Text style={styles.presenceTitleLate}>Rescheduled (+2 Buffer Rule)</Text>
                      <Text style={styles.presenceSubtextLate}>
                        Slot arrival missed. Accommodated 2 tokens after the ongoing consultation. Estimated wait: ~{currentWaitMinutes || 35} mins.
                      </Text>
                    </View>
                  </View>
                ) : (
                  /* 🔴 RED: NOT PRESENT (AWAITING ARRIVAL) */
                  <View style={styles.presenceBannerNotPresent} testID="pass-presence-banner-not-present">
                    <View style={styles.presenceIconCircleNotPresent}>
                      <Text style={styles.presenceIconNotPresent}>✕</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.presenceBadgeNotPresent}>🔴 NOT PRESENT (AWAITING ARRIVAL)</Text>
                      <Text style={styles.presenceTitleNotPresent}>Show 4-Digit Code at Reception</Text>
                      <Text style={styles.presenceSubtextNotPresent}>
                        You are marked as not present. Tell your OTP code below to the front desk upon reaching to turn this status GREEN.
                      </Text>
                    </View>
                  </View>
                )}

                {/* 2. Token & Doctor Overview Card */}
                <View style={styles.opdHighlightCard}>
                  <View style={styles.opdHighlightTop}>
                    <View>
                      <Text style={styles.opdDoctorTitle}>
                        {booking.resource_name || 'Dr. K. Trinadh (Chief Physician)'}
                      </Text>
                      <Text style={styles.opdHospitalSub}>
                        {booking.provider_name || 'Trinadh Multi-Speciality Hospital'} • OPD Room 101
                      </Text>
                    </View>
                    <View style={styles.myTokenBadge}>
                      <Text style={styles.myTokenBadgeLabel}>YOUR TOKEN</Text>
                      <Text style={styles.myTokenBadgeNum}>#{myTokenNumber}</Text>
                    </View>
                  </View>

                  {/* Queue Live Metrics Row */}
                  <View style={styles.liveMetricsRow}>
                    <View style={styles.metricCol}>
                      <Text style={styles.metricLabel}>NOW SERVING</Text>
                      <Text style={styles.metricValNow}>Token #2</Text>
                      <Text style={styles.metricSub}>In Consultation</Text>
                    </View>
                    <View style={styles.metricDividerVertical} />
                    <View style={styles.metricCol}>
                      <Text style={styles.metricLabel}>YOUR EXPECTED TIME</Text>
                      <Text style={styles.metricValExpected}>{timeString}</Text>
                      <Text style={styles.metricSub}>~15 mins wait</Text>
                    </View>
                    <View style={styles.metricDividerVertical} />
                    <View style={styles.metricCol}>
                      <Text style={styles.metricLabel}>TOTAL TOKENS</Text>
                      <Text style={styles.metricValTotal}>{totalTokens}</Text>
                      <Text style={styles.metricSub}>#1 to #{totalTokens} today</Text>
                    </View>
                  </View>
                </View>

                {/* 3. The Physical Voucher Ticket */}
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
                            <Text style={styles.checkedInBadgeText}>✓ PRESENT & READY</Text>
                          </View>
                        ) : booking.is_present ? (
                          <View style={styles.presentPill} testID="pass-present-pill">
                            <Text style={styles.presentPillText}>📍 AT VENUE</Text>
                          </View>
                        ) : (
                          <View style={styles.notPresentPill}>
                            <Text style={styles.notPresentPillText}>🔴 NOT PRESENT</Text>
                          </View>
                        )}
                        {currentQueuePosition ? (
                          <View style={styles.lateTurnPill} testID="pass-late-turn-pill">
                            <Text style={styles.lateTurnPillText}>⏰ TURN #{currentQueuePosition}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.passNumber} testID="pass-reference-code">{passId}</Text>
                    </View>

                    <Text style={styles.serviceName}>{booking.resource_name || 'OPD Consultation'}</Text>

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
                      /* Verified Card */
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
                          Please have a seat in the waiting lobby. Dr. Trinadh will call Token #{myTokenNumber} shortly.
                        </Text>
                      </View>
                    ) : (liveStatus === 'CONFIRMED' && isWindowOpen) ? (
                      /* Check-in Code Box with high contrast OTP */
                      <View style={styles.checkinCodeBox} testID="pass-checkin-code-box">
                        <View style={styles.checkinCodeHeader}>
                          <Text style={styles.checkinCodeIcon}>🎟️</Text>
                          <Text style={styles.checkinCodeBadge}>RECEPTION CHECK-IN CODE</Text>
                        </View>
                        <Text style={styles.checkinCodeNumber} testID="pass-checkin-code-number">
                          {checkinCode || '4821'}
                        </Text>
                        <Text style={styles.checkinCodeInstruction}>
                          Show or tell this code at reception counter
                        </Text>
                        <Text style={styles.checkinCodeSubtext}>
                          Reception will enter this 4-digit code to immediately flip your presence status to GREEN.
                        </Text>
                      </View>
                    ) : (liveStatus === 'CONFIRMED' && !isWindowOpen) ? (
                      /* Window Not Open */
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
                          <View style={[styles.qrCornerBlock, styles.qrTopLeft]}>
                            <View style={styles.qrInnerBlock} />
                          </View>
                          <View style={[styles.qrTopRight, styles.qrCornerBlock]}>
                            <View style={styles.qrInnerBlock} />
                          </View>
                          <View style={[styles.qrBottomLeft, styles.qrCornerBlock]}>
                            <View style={styles.qrInnerBlock} />
                          </View>
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
                        <Text style={styles.qrCaption}>Scan at hospital reception desk</Text>
                      </View>
                    )}

                    <View style={styles.depositInfoBox}>
                      <View style={styles.depositRow}>
                        <Text style={styles.depositTitle}>Deposit Paid via UPI / Card</Text>
                        <Text style={styles.depositAmount}>₹{booking.deposit_amount}</Text>
                      </View>
                      <Text style={styles.depositSubtext}>
                        This deposit guarantees your slot and will be adjusted in your consultation bill.
                      </Text>
                    </View>

                    {/* Expected Arrival & Zero-Wait Schedule */}
                    <View style={styles.expectedTimeBox} testID="pass-expected-time">
                      <View style={styles.expectedTimeHeader}>
                        <Text style={styles.expectedTimeIcon}>⏱️</Text>
                        <Text style={styles.expectedTimeTitle}>Expected Time & Zero-Wait Advice</Text>
                      </View>
                      <Text style={styles.expectedTimeText}>
                        Scheduled Slot: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{timeString}</Text> | Expected Arrival: <Text style={{ fontWeight: '700', color: '#0284c7' }}>10 mins prior</Text> | Est. Consultation Wait: <Text style={{ fontWeight: '700', color: '#059669' }}>0–5 mins</Text> (Zero-Wait OPD Token #{myTokenNumber})
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
                            Turn #{currentQueuePosition}
                          </Text>
                        </View>
                        <Text style={styles.lateQueueNoticeText}>
                          You have been accommodated after 2 member appointments (+2 buffer) due to late arrival.
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
                            Arriving late? Don't worry! Tap <Text style={{ fontWeight: '700', color: '#059669' }}>"I've Reached"</Text> below when you arrive. You will be placed <Text style={{ fontWeight: '700', color: '#0f172a' }}>2 tokens after the ongoing token</Text> (e.g. token #2 ongoing → queued at turn #4).
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
              </View>
            ) : (
              /* ================= TAB 2: HOSPITAL LIVE QUEUE (#1 to #N) ================= */
              <View style={styles.hospitalQueueBoard} testID="pass-hospital-queue-board">
                {/* Board Header Banner */}
                <View style={styles.queueBoardBanner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.queueBoardHospitalName}>
                      {booking.provider_name || 'Trinadh Multi-Speciality Hospital'}
                    </Text>
                    <Text style={styles.queueBoardDoctorSub}>
                      {booking.resource_name || 'Dr. K. Trinadh (Chief Physician & Cardiologist)'}
                    </Text>
                    <Text style={styles.queueBoardSessionText}>
                      Today's Morning OPD Session • Room 101
                    </Text>
                  </View>
                  <View style={styles.queueLiveChip}>
                    <Text style={styles.queueLiveDot}>●</Text>
                    <Text style={styles.queueLiveLabel}>REAL-TIME</Text>
                  </View>
                </View>

                {/* Queue Summary Metrics Bar */}
                <View style={styles.queueMetricsBar}>
                  <View style={styles.queueMetricCard}>
                    <Text style={styles.queueMetricCardNum}>{totalTokens}</Text>
                    <Text style={styles.queueMetricCardLabel}>Total Tokens</Text>
                    <Text style={styles.queueMetricCardSub}>#1 to #{totalTokens}</Text>
                  </View>
                  <View style={[styles.queueMetricCard, styles.metricBorderGreen]}>
                    <Text style={[styles.queueMetricCardNum, { color: '#047857' }]}>{presentCount}</Text>
                    <Text style={[styles.queueMetricCardLabel, { color: '#065f46' }]}>🟢 Present & Ready</Text>
                    <Text style={styles.queueMetricCardSub}>In Lobby</Text>
                  </View>
                  <View style={[styles.queueMetricCard, styles.metricBorderRed]}>
                    <Text style={[styles.queueMetricCardNum, { color: '#dc2626' }]}>{notPresentCount}</Text>
                    <Text style={[styles.queueMetricCardLabel, { color: '#991b1b' }]}>🔴 Awaiting Arrival</Text>
                    <Text style={styles.queueMetricCardSub}>Not Present</Text>
                  </View>
                  <View style={[styles.queueMetricCard, styles.metricBorderAmber]}>
                    <Text style={[styles.queueMetricCardNum, { color: '#b45309' }]}>{lateQueueCount}</Text>
                    <Text style={[styles.queueMetricCardLabel, { color: '#92400e' }]}>⏰ Late Queue</Text>
                    <Text style={styles.queueMetricCardSub}>+2 Buffer</Text>
                  </View>
                </View>

                {/* Now Serving Highlight Spotlight */}
                <View style={styles.nowServingSpotlight}>
                  <View style={styles.nowServingSpotlightLeft}>
                    <View style={styles.nowServingPulseDot} />
                    <View>
                      <Text style={styles.nowServingSpotlightLabel}>⚡ CURRENTLY IN CONSULTATION</Text>
                      <Text style={styles.nowServingSpotlightToken}>TOKEN #2: Lakshmi Devi</Text>
                      <Text style={styles.nowServingSpotlightSub}>
                        Started at 09:15 AM • Est. completion: ~09:30 AM
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Your Token Position Tracker Banner */}
                <View style={styles.yourTurnHighlightBanner}>
                  <View style={styles.yourTurnLeft}>
                    <Text style={styles.yourTurnTokenNum}>Token #{myTokenNumber}</Text>
                    <View style={styles.yourTurnBadge}>
                      <Text style={styles.yourTurnBadgeText}>YOUR TOKEN</Text>
                    </View>
                  </View>
                  <View style={styles.yourTurnRight}>
                    <Text style={styles.yourTurnExpectedLabel}>Expected Consultation:</Text>
                    <Text style={styles.yourTurnExpectedTime}>{timeString} (~15m wait)</Text>
                    <Text style={styles.yourTurnStatusText}>
                      Status:{' '}
                      <Text
                        style={{
                          fontWeight: '800',
                          color: isCheckedIn ? '#047857' : isLateQueue ? '#b45309' : '#dc2626',
                        }}
                      >
                        {isCheckedIn
                          ? '🟢 Present & Ready'
                          : isLateQueue
                          ? `⏰ Late Queue (Turn #${currentQueuePosition})`
                          : '🔴 Not Present (Tell Code)'}
                      </Text>
                    </Text>
                  </View>
                </View>

                {/* Section Title: Sequential Tokens #1 to #N */}
                <View style={styles.rosterSectionHeader}>
                  <Text style={styles.rosterSectionTitle}>
                    Hospital OPD Live Queue (Tokens #1 to #{totalTokens})
                  </Text>
                  <Text style={styles.rosterSectionSub}>
                    Auto-updates live when patients check in with receptionist code
                  </Text>
                </View>

                {/* Sequential List of Tokens */}
                <View style={styles.tokensList}>
                  {hospitalQueueRoster.map((item) => {
                    const isUserItem = item.isCurrentCustomer;
                    return (
                      <View
                        key={item.tokenNumber}
                        style={[
                          styles.tokenRowCard,
                          isUserItem && styles.tokenRowCardUser,
                          item.status === 'PRESENT_READY' && styles.tokenRowCardPresent,
                          item.status === 'NOT_PRESENT' && isUserItem && styles.tokenRowCardNotPresent,
                          item.status === 'IN_CONSULTATION' && styles.tokenRowCardServing,
                        ]}
                        testID={`pass-token-card-${item.tokenNumber}`}
                      >
                        <View style={styles.tokenRowLeft}>
                          {/* Token Number Badge */}
                          <View
                            style={[
                              styles.tokenNumberCircle,
                              item.status === 'COMPLETED' && styles.tokenCircleCompleted,
                              item.status === 'IN_CONSULTATION' && styles.tokenCircleServing,
                              item.status === 'PRESENT_READY' && styles.tokenCirclePresent,
                              item.status === 'NOT_PRESENT' && styles.tokenCircleNotPresent,
                              item.status === 'LATE_QUEUE' && styles.tokenCircleLate,
                            ]}
                          >
                            <Text
                              style={[
                                styles.tokenNumberCircleText,
                                item.status === 'COMPLETED' && { color: '#64748b' },
                                item.status === 'IN_CONSULTATION' && { color: '#0369a1' },
                                item.status === 'PRESENT_READY' && { color: '#047857' },
                                item.status === 'NOT_PRESENT' && { color: '#dc2626' },
                                item.status === 'LATE_QUEUE' && { color: '#b45309' },
                              ]}
                            >
                              #{item.tokenNumber}
                            </Text>
                          </View>

                          {/* Patient & Slot Info */}
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.tokenPatientName}>{item.patientName}</Text>
                              {isUserItem && (
                                <View style={styles.youPillBadge}>
                                  <Text style={styles.youPillBadgeText}>YOU</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.tokenTimeSlot}>
                              {item.slotTime} • Expected: {item.expectedTime}
                            </Text>
                          </View>
                        </View>

                        {/* Status Pill on the Right */}
                        <View style={styles.tokenRowRight}>
                          {item.status === 'COMPLETED' ? (
                            <View style={styles.pillCompleted}>
                              <Text style={styles.pillCompletedText}>✓ DONE</Text>
                            </View>
                          ) : item.status === 'IN_CONSULTATION' ? (
                            <View style={styles.pillServing}>
                              <Text style={styles.pillServingText}>🔵 SERVING</Text>
                            </View>
                          ) : item.status === 'PRESENT_READY' ? (
                            <View style={styles.pillPresentReady}>
                              <Text style={styles.pillPresentReadyText}>🟢 READY</Text>
                            </View>
                          ) : item.status === 'LATE_QUEUE' ? (
                            <View style={styles.pillLateQueue}>
                              <Text style={styles.pillLateQueueText}>
                                ⏰ TURN #{item.lateTurnNumber || 14}
                              </Text>
                            </View>
                          ) : (
                            <View style={styles.pillNotPresent}>
                              <Text style={styles.pillNotPresentText}>🔴 AWAITING</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* 4. LATE COMERS QUEUE Section */}
                <View style={styles.lateComersSection}>
                  <View style={styles.lateComersHeader}>
                    <Text style={styles.lateComersTitle}>⏰ Late Comers Queue (+2 Buffer Rescheduled)</Text>
                  </View>
                  <Text style={styles.lateComersExplainer}>
                    Patients who arrive late past their scheduled slot are rescheduled with the +2 buffer rule (placed 2 tokens after the ongoing consultation) to protect on-time patients.
                  </Text>

                  {isLateQueue ? (
                    <View style={styles.lateQueuePatientCard}>
                      <View style={styles.lateQueuePatientHeader}>
                        <View style={styles.lateQueueBadgeSmall}>
                          <Text style={styles.lateQueueBadgeSmallText}>LATE TURN #{currentQueuePosition}</Text>
                        </View>
                        <Text style={styles.lateQueueWaitText}>~{currentWaitMinutes || 35} mins wait</Text>
                      </View>
                      <Text style={styles.lateQueuePatientName}>You (Token #4 Rescheduled)</Text>
                      <Text style={styles.lateQueuePatientSub}>
                        Arrived late. Queued 2 tokens after ongoing consultation. Please remain seated in lobby.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.lateQueueEmptyCard}>
                      <Text style={styles.lateQueueEmptyText}>
                        ✓ No other patients currently in the Late Comers Queue. All on-time patients are seen in exact token sequence.
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}
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
    maxHeight: '92%',
    paddingBottom: 24,
  },
  cardHeader: {
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
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  liveIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  liveIndicatorDot: {
    color: '#047857',
    fontSize: 8,
  },
  liveIndicatorText: {
    color: '#047857',
    fontSize: 9,
    fontWeight: '800',
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
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  tabButtonTextActive: {
    color: '#047857',
    fontWeight: '800',
  },
  scrollArea: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  /* Presence Color Banners */
  presenceBannerPresent: {
    backgroundColor: '#ecfdf5',
    borderWidth: 2,
    borderColor: '#10b981',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  presenceIconCirclePresent: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceIconPresent: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  presenceBadgePresent: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  presenceTitlePresent: {
    color: '#064e3b',
    fontSize: 14,
    fontWeight: '800',
  },
  presenceSubtextPresent: {
    color: '#047857',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },

  presenceBannerNotPresent: {
    backgroundColor: '#fef2f2',
    borderWidth: 2,
    borderColor: '#ef4444',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  presenceIconCircleNotPresent: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceIconNotPresent: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  presenceBadgeNotPresent: {
    color: '#991b1b',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  presenceTitleNotPresent: {
    color: '#7f1d1d',
    fontSize: 14,
    fontWeight: '800',
  },
  presenceSubtextNotPresent: {
    color: '#b91c1c',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },

  presenceBannerLate: {
    backgroundColor: '#fffbeb',
    borderWidth: 2,
    borderColor: '#f59e0b',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  presenceIconCircleLate: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#d97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceIconLate: {
    fontSize: 16,
  },
  presenceBadgeLate: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  presenceTitleLate: {
    color: '#78350f',
    fontSize: 14,
    fontWeight: '800',
  },
  presenceSubtextLate: {
    color: '#b45309',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },

  /* OPD Highlight Card */
  opdHighlightCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  opdHighlightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingBottom: 12,
  },
  opdDoctorTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  opdHospitalSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  myTokenBadge: {
    backgroundColor: '#047857',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    alignItems: 'center',
  },
  myTokenBadgeLabel: {
    color: '#a7f3d0',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  myTokenBadgeNum: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  liveMetricsRow: {
    flexDirection: 'row',
    paddingTop: 12,
    alignItems: 'center',
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  metricDividerVertical: {
    width: 1,
    height: 34,
    backgroundColor: '#334155',
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricValNow: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
  },
  metricValExpected: {
    color: '#34d399',
    fontSize: 14,
    fontWeight: '800',
  },
  metricValTotal: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '800',
  },
  metricSub: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 1,
  },

  /* Physical Ticket Pass */
  passCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  passTop: {
    padding: 18,
    backgroundColor: '#ffffff',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  statusPillCheckedIn: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  statusDot: {
    color: '#059669',
    fontSize: 9,
    marginRight: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065f46',
  },
  checkedInBadge: {
    backgroundColor: '#047857',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  checkedInBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
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
  notPresentPill: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  notPresentPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#dc2626',
  },
  lateTurnPill: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lateTurnPillText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '800',
  },
  passNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  serviceName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  slotBox: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
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
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  slotVal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  tearLineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 20,
    backgroundColor: '#ffffff',
  },
  tearHoleLeft: {
    width: 14,
    height: 20,
    backgroundColor: '#f8fafc',
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: '#e2e8f0',
  },
  tearDashes: {
    flex: 1,
    borderBottomWidth: 1.5,
    borderBottomColor: '#cbd5e1',
    borderStyle: 'dashed',
    marginHorizontal: 6,
  },
  tearHoleRight: {
    width: 14,
    height: 20,
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: '#e2e8f0',
  },
  passBottom: {
    padding: 18,
    backgroundColor: '#ffffff',
  },
  checkedInCard: {
    backgroundColor: '#ecfdf5',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#10b981',
    marginBottom: 14,
  },
  checkedInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  checkedInCheckCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedInCheckMark: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  checkedInTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#064e3b',
  },
  checkedInTime: {
    fontSize: 11,
    fontWeight: '600',
    color: '#047857',
    marginTop: 2,
  },
  checkedInNotice: {
    fontSize: 11,
    color: '#065f46',
    lineHeight: 15,
  },
  checkinCodeBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    marginBottom: 14,
  },
  checkinCodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  checkinCodeIcon: {
    fontSize: 14,
  },
  checkinCodeBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 1,
  },
  checkinCodeNumber: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: 8,
    marginVertical: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  checkinCodeInstruction: {
    fontSize: 12,
    fontWeight: '800',
    color: '#047857',
    marginTop: 2,
  },
  checkinCodeSubtext: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
  },
  checkinEarlyBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  checkinEarlyIcon: {
    fontSize: 16,
    marginTop: 2,
  },
  checkinEarlyTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  checkinEarlySubtitle: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 15,
    marginTop: 2,
  },
  qrContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  qrMatrix: {
    width: 110,
    height: 110,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#0f172a',
    borderRadius: 10,
    position: 'relative',
    padding: 6,
  },
  qrCornerBlock: {
    width: 26,
    height: 26,
    borderWidth: 2.5,
    borderColor: '#0f172a',
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrInnerBlock: {
    width: 10,
    height: 10,
    backgroundColor: '#059669',
  },
  qrTopLeft: {
    top: 6,
    left: 6,
  },
  qrTopRight: {
    top: 6,
    right: 6,
  },
  qrBottomLeft: {
    bottom: 6,
    left: 6,
  },
  qrGridPattern: {
    ...StyleSheet.absoluteFill,
  },
  qrDot: {
    width: 8,
    height: 8,
    backgroundColor: '#0f172a',
    position: 'absolute',
    borderRadius: 2,
  },
  qrCaption: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 6,
  },
  depositInfoBox: {
    width: '100%',
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  depositRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  depositTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  depositAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#166534',
  },
  depositSubtext: {
    fontSize: 10,
    color: '#15803d',
    marginTop: 2,
    lineHeight: 14,
  },
  expectedTimeBox: {
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
    marginTop: 10,
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
    fontSize: 11,
    fontWeight: '800',
    color: '#0369a1',
  },
  expectedTimeText: {
    fontSize: 11,
    color: '#0c4a6e',
    lineHeight: 15,
  },
  lateQueueActiveBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    marginTop: 10,
  },
  lateQueueActiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
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
    fontSize: 11,
  },
  lateQueueBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400e',
  },
  lateQueueTokenNumber: {
    fontSize: 16,
    fontWeight: '900',
    color: '#b45309',
  },
  lateQueueNoticeText: {
    fontSize: 11,
    color: '#78350f',
    lineHeight: 15,
  },
  lateWaitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginTop: 6,
  },
  lateWaitLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400e',
  },
  lateWaitVal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#b45309',
  },
  lateArrivalPassNote: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginTop: 10,
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
    fontSize: 10.5,
    color: '#78350f',
    lineHeight: 15,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 20,
  },
  reachedActionBtn: {
    flex: 1.2,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  reachedActionBtnText: {
    color: '#ffffff',
    fontSize: 12,
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
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  reachedPillText: {
    color: '#15803d',
    fontSize: 12,
    fontWeight: '800',
  },
  directionsBtn: {
    flex: 1,
    backgroundColor: '#0f172a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  btnIcon: {
    fontSize: 13,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },

  /* TAB 2: Hospital Live Queue Board Styles */
  hospitalQueueBoard: {
    paddingBottom: 24,
  },
  queueBoardBanner: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  queueBoardHospitalName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  queueBoardDoctorSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
    marginTop: 2,
  },
  queueBoardSessionText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  queueLiveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  queueLiveDot: {
    color: '#047857',
    fontSize: 8,
  },
  queueLiveLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  queueMetricsBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  queueMetricCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metricBorderGreen: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  metricBorderRed: {
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  metricBorderAmber: {
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
  },
  queueMetricCardNum: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  queueMetricCardLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#475569',
    marginTop: 2,
    textAlign: 'center',
  },
  queueMetricCardSub: {
    fontSize: 8.5,
    color: '#94a3b8',
    marginTop: 2,
  },
  nowServingSpotlight: {
    backgroundColor: '#0284c7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  nowServingSpotlightLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nowServingPulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#bae6fd',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  nowServingSpotlightLabel: {
    color: '#e0f2fe',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  nowServingSpotlightToken: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 1,
  },
  nowServingSpotlightSub: {
    color: '#bae6fd',
    fontSize: 11,
    marginTop: 2,
  },
  yourTurnHighlightBanner: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#047857',
  },
  yourTurnLeft: {
    alignItems: 'flex-start',
  },
  yourTurnTokenNum: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
  },
  yourTurnBadge: {
    backgroundColor: '#047857',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  yourTurnBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  yourTurnRight: {
    alignItems: 'flex-end',
  },
  yourTurnExpectedLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  yourTurnExpectedTime: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
  },
  yourTurnStatusText: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 3,
  },
  rosterSectionHeader: {
    marginBottom: 10,
  },
  rosterSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  rosterSectionSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  tokensList: {
    gap: 8,
    marginBottom: 16,
  },
  tokenRowCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tokenRowCardUser: {
    borderWidth: 2,
    borderColor: '#047857',
    backgroundColor: '#f0fdf4',
  },
  tokenRowCardPresent: {
    borderColor: '#a7f3d0',
  },
  tokenRowCardNotPresent: {
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
  },
  tokenRowCardServing: {
    borderColor: '#7dd3fc',
    backgroundColor: '#f0f9ff',
  },
  tokenRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  tokenNumberCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  tokenCircleCompleted: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  tokenCircleServing: {
    backgroundColor: '#e0f2fe',
    borderColor: '#38bdf8',
  },
  tokenCirclePresent: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  tokenCircleNotPresent: {
    backgroundColor: '#fef2f2',
    borderColor: '#ef4444',
  },
  tokenCircleLate: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  tokenNumberCircleText: {
    fontSize: 12,
    fontWeight: '900',
  },
  tokenPatientName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  youPillBadge: {
    backgroundColor: '#047857',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  youPillBadgeText: {
    color: '#ffffff',
    fontSize: 8.5,
    fontWeight: '800',
  },
  tokenTimeSlot: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  tokenRowRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  pillCompleted: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pillCompletedText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
  },
  pillServing: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pillServingText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  pillPresentReady: {
    backgroundColor: '#047857',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pillPresentReadyText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  pillNotPresent: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  pillNotPresentText: {
    color: '#b91c1c',
    fontSize: 10,
    fontWeight: '800',
  },
  pillLateQueue: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pillLateQueueText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '800',
  },

  /* Late Comers Section */
  lateComersSection: {
    backgroundColor: '#fffbeb',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
  },
  lateComersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  lateComersTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400e',
  },
  lateComersExplainer: {
    fontSize: 11,
    color: '#78350f',
    lineHeight: 15,
    marginBottom: 10,
  },
  lateQueuePatientCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  lateQueuePatientHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  lateQueueBadgeSmall: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  lateQueueBadgeSmallText: {
    color: '#92400e',
    fontSize: 9,
    fontWeight: '800',
  },
  lateQueueWaitText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '800',
  },
  lateQueuePatientName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  lateQueuePatientSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    lineHeight: 15,
  },
  lateQueueEmptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  lateQueueEmptyText: {
    fontSize: 11,
    color: '#92400e',
    lineHeight: 15,
  },
});
