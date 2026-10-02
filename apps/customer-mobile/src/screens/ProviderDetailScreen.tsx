import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Resource, Slot, DayOfWeek, CoolingPeriodEligibilityResult } from '@appointments/shared';
import {
  generateAvailableSlots,
  fetchProviderById,
  fetchBookedSlots,
  checkCoolingPeriodEligibility,
  ProviderWithDetails,
} from '../services/api';

interface ProviderDetailScreenProps {
  providerId: string;
  customerId?: string;
  onBack: () => void;
  onProceedToHold: (
    resource: Resource,
    slot: Slot,
    providerName?: string,
    coolingPeriodDays?: number,
    providerId?: string
  ) => void;
}

export default function ProviderDetailScreen({
  providerId,
  customerId = '99999999-9999-9999-9999-999999999991',
  onBack,
  onProceedToHold,
}: ProviderDetailScreenProps) {
  const [provider, setProvider] = useState<ProviderWithDetails | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [selectedDateIndex, setSelectedDateIndex] = useState(0); // 0 = today, 1 = tomorrow, 2 = day after
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [coolingEligibility, setCoolingEligibility] = useState<CoolingPeriodEligibilityResult | null>(null);
  const [checkingCooling, setCheckingCooling] = useState<boolean>(false);
  const lastBookedQueryId = useRef(0);

  // Generate 3 date options (Today, Tomorrow, Day after)
  const dates = [0, 1, 2].map((offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  });

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      // Always fetch real data first — real resource IDs + deposit_amount from DB
      const p = await fetchProviderById(providerId);
      if (!isMounted) return;
      if (p) {
        setProvider(p);
        if (p.resources && p.resources.length > 0) {
          setSelectedResource(p.resources[0]);
        }
      } else {
        setProvider(null);
        setSelectedResource(null);
      }
      setLoading(false);
    }
    load();
    return () => { isMounted = false; };
  }, [providerId]);

  const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayDay = dayNames[new Date().getDay()];
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowDay = dayNames[tomorrowDate.getDay()];

  const formatTimeStr = (t?: string) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const period = (h || 0) >= 12 ? 'PM' : 'AM';
    const hour12 = (h || 0) % 12 || 12;
    return `${hour12}:${String(m || 0).padStart(2, '0')} ${period}`;
  };

  const todaySched = provider?.weekly_hours?.[todayDay];
  const tomorrowSched = provider?.weekly_hours?.[tomorrowDay];

  const todayHoursStr = todaySched
    ? (todaySched.is_closed ? 'Closed today' : `${formatTimeStr(todaySched.open)} - ${formatTimeStr(todaySched.close)}`)
    : provider ? `${provider.opening_time.slice(0, 5)} - ${provider.closing_time.slice(0, 5)}` : '—';

  const tomorrowHoursStr = tomorrowSched
    ? (tomorrowSched.is_closed ? 'Closed' : `${formatTimeStr(tomorrowSched.open)} - ${formatTimeStr(tomorrowSched.close)}`)
    : null;

  const selectedDate = dates[selectedDateIndex];
  const selectedDayName = selectedDate ? dayNames[selectedDate.getDay()] : null;
  const isSelectedDateClosed = Boolean(provider?.weekly_hours && selectedDayName && provider.weekly_hours[selectedDayName]?.is_closed);

  useEffect(() => {
    if (selectedResource && dates[selectedDateIndex]) {
      const qId = ++lastBookedQueryId.current;
      setSlotsLoading(true);
      fetchBookedSlots(selectedResource.id, dates[selectedDateIndex])
        .then((res) => {
          if (qId === lastBookedQueryId.current) {
            setBookedSlots(res);
            setSlotsLoading(false);
          }
        })
        .catch(() => {
          if (qId === lastBookedQueryId.current) {
            setSlotsLoading(false);
          }
        });
    } else {
      setBookedSlots([]);
      setSlotsLoading(false);
    }
  }, [selectedResource?.id, selectedDateIndex]);

  const availableSlots = selectedResource && provider
    ? generateAvailableSlots(selectedResource, dates[selectedDateIndex], provider, bookedSlots)
    : [];

  useEffect(() => {
    let isMounted = true;
    const coolingDays = provider?.cooling_period_days ?? 0;
    if (coolingDays > 0 && customerId && providerId) {
      setCheckingCooling(true);
      const targetTime = selectedSlot ? selectedSlot.start_time : dates[selectedDateIndex]?.toISOString();
      checkCoolingPeriodEligibility(customerId, providerId, targetTime)
        .then((res) => {
          if (isMounted) setCoolingEligibility(res);
        })
        .catch(() => {
          if (isMounted) setCoolingEligibility(null);
        })
        .finally(() => {
          if (isMounted) setCheckingCooling(false);
        });
    } else {
      setCoolingEligibility(null);
      setCheckingCooling(false);
    }
    return () => {
      isMounted = false;
    };
  }, [customerId, providerId, provider?.cooling_period_days, selectedDateIndex, selectedSlot?.start_time]);

  const isFreeAppointment = Boolean(coolingEligibility?.eligible);

  // Loading state — show spinner while fetching real data
  if (loading || !provider) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={{ fontSize: 13, color: '#64748b', fontWeight: '600' }}>Loading venue details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {provider.name}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Hero Header */}
        <Image
          source={{ uri: provider.photos?.[0] || 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800' }}
          style={styles.heroImage}
        />

        <View style={styles.headerInfo}>
          <Text style={styles.name}>{provider.name}</Text>
          <Text style={styles.address}>📍 {provider.address}</Text>
          <Text style={styles.hours} testID="customer-provider-hours">
            🕒 Today: {todayHoursStr} {tomorrowHoursStr ? `• Tomorrow: ${tomorrowHoursStr}` : ''}
          </Text>
          <Text style={styles.description}>{provider.description}</Text>
        </View>

        {/* Cooling Period / Hospital Free Follow-up Policy Banner */}
        {Boolean(provider.cooling_period_days && provider.cooling_period_days > 0) && (
          coolingEligibility?.eligible ? (
            <View style={styles.coolingPeriodCardEligible} testID="customer-provider-cooling-period-banner">
              <View style={styles.coolingPeriodHeader}>
                <Text style={styles.coolingPeriodIcon}>🎁</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.coolingPeriodTitleRow}>
                    <Text style={styles.coolingPeriodTitleEligible}>
                      Free Appointment Applied!
                    </Text>
                    <View style={styles.coolingPeriodBadgeEligible}>
                      <Text style={styles.coolingPeriodBadgeTextEligible}>₹0 FREE</Text>
                    </View>
                  </View>
                  <Text style={styles.coolingPeriodSubtitleEligible}>
                    As your appointment date is within the {provider.cooling_period_days}-day cooling period (&lt; {coolingEligibility.days_remaining ?? provider.cooling_period_days} days remaining from your previous consultation on {new Date(coolingEligibility.original_slot_start || '').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}), this appointment is completely FREE!
                  </Text>
                </View>
              </View>
            </View>
          ) : coolingEligibility?.prior_slot_start ? (
            <View style={styles.coolingPeriodCardExpired} testID="customer-provider-cooling-period-banner">
              <View style={styles.coolingPeriodHeader}>
                <Text style={styles.coolingPeriodIcon}>ℹ️</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.coolingPeriodTitleRow}>
                    <Text style={styles.coolingPeriodTitleExpired}>
                      {provider.cooling_period_days}-Day Cooling Period Expired
                    </Text>
                    <View style={styles.coolingPeriodBadgeExpired}>
                      <Text style={styles.coolingPeriodBadgeTextExpired}>STANDARD FEE</Text>
                    </View>
                  </View>
                  <Text style={styles.coolingPeriodSubtitleExpired}>
                    Previous visit was on {new Date(coolingEligibility.prior_slot_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. As your appointment date exceeds the {provider.cooling_period_days}-day cooling window, standard booking charges apply.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.coolingPeriodCard} testID="customer-provider-cooling-period-banner">
              <View style={styles.coolingPeriodHeader}>
                <Text style={styles.coolingPeriodIcon}>🏥</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.coolingPeriodTitleRow}>
                    <Text style={styles.coolingPeriodTitle}>
                      {provider.cooling_period_days}-Day Free Follow-up Policy
                    </Text>
                    <View style={styles.coolingPeriodBadge}>
                      <Text style={styles.coolingPeriodBadgeText}>₹0 RE-VISIT</Text>
                    </View>
                  </View>
                  <Text style={styles.coolingPeriodSubtitle}>
                    Patients who book within {provider.cooling_period_days} days of any consultation here pay ₹0 deposit and ₹0 platform fee.
                  </Text>
                </View>
              </View>
            </View>
          )
        )}

        {/* Suspended Venue Warning */}
        {provider.status === 'SUSPENDED' && (
          <View style={styles.suspendedBanner} testID="customer-provider-suspended-banner">
            <Text style={styles.suspendedBannerTitle}>⚠️ Business Temporarily Suspended</Text>
            <Text style={styles.suspendedBannerText}>
              This venue has been blocked by platform administration and is not accepting new appointments at this time.
            </Text>
          </View>
        )}

        {/* 1. Select Resource / Staff */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Select Staff / Unit</Text>
          <View style={styles.resourceList}>
            {provider.resources.map((res) => {
              const isSelected = selectedResource?.id === res.id;
              return (
                <TouchableOpacity
                  key={res.id}
                  style={[styles.resourceCard, isSelected && styles.resourceCardSelected]}
                  onPress={() => {
                    setSelectedResource(res);
                    setSelectedSlot(null);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resourceName, isSelected && styles.resourceNameSelected]}>
                      {res.name}
                    </Text>
                    <Text style={styles.resourceMeta}>
                      {res.duration_minutes} min slot • Max {res.capacity} person
                    </Text>
                  </View>
                  <View style={styles.depositBadge}>
                    <Text style={styles.depositBadgeText}>₹{res.deposit_amount}</Text>
                    <Text style={styles.depositSub}>deposit</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 2. Select Date */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Choose Date</Text>
          <View style={styles.dateRow}>
            {dates.map((d, index) => {
              const isSelected = selectedDateIndex === index;
              const dayName = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' });
              return (
                <TouchableOpacity
                  key={index}
                  testID={`customer-date-card-${index}`}
                  style={[styles.dateCard, isSelected && styles.dateCardSelected]}
                  onPress={() => {
                    if (selectedDateIndex === index) return;
                    setSlotsLoading(true);
                    setSelectedDateIndex(index);
                    setSelectedSlot(null);
                  }}
                >
                  <Text style={[styles.dateDayName, isSelected && styles.dateTextSelected]}>
                    {dayName}
                  </Text>
                  <Text style={[styles.dateNumber, isSelected && styles.dateTextSelected]}>
                    {d.getDate()} {d.toLocaleDateString('en-IN', { month: 'short' })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 3. Slot Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Available Slots</Text>
          {slotsLoading ? (
            <View style={{ padding: 24, alignItems: 'center', justifyContent: 'center' }} testID="customer-slots-loading">
              <ActivityIndicator size="small" color="#059669" />
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 8, fontWeight: '500' }}>
                Checking live slot availability...
              </Text>
            </View>
          ) : isSelectedDateClosed ? (
            <View style={styles.closedDayBanner} testID="customer-day-closed-notice">
              <Text style={styles.closedDayTitle}>🚫 Venue Closed on This Day</Text>
              <Text style={styles.closedDaySub}>
                {provider.name} is marked closed on {selectedDateIndex === 0 ? 'today' : selectedDateIndex === 1 ? 'tomorrow' : selectedDate?.toLocaleDateString('en-IN', { weekday: 'long' })} (weekly off or holiday). Please select another date for your visit.
              </Text>
            </View>
          ) : availableSlots.length > 0 && availableSlots.every((s) => !s.is_available) ? (
            <View style={styles.closedDayBanner} testID="customer-all-slots-past-notice">
              <Text style={styles.closedDayTitle}>
                {selectedDateIndex === 0 ? '🌙 All Slots for Today Concluded' : '🌙 All Slots for This Day Booked'}
              </Text>
              <Text style={styles.closedDaySub}>
                {selectedDateIndex === 0
                  ? 'All booking slots for today have already passed. Please tap "Tomorrow" above to view available appointments.'
                  : 'All booking slots for this date are fully reserved. Please select another date for your visit.'}
              </Text>
            </View>
          ) : (
            <View style={styles.slotGrid}>
              {availableSlots.map((slot, index) => {
                const timeString = new Date(slot.start_time).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const isSelected = selectedSlot?.start_time === slot.start_time;
                const isAvailable = Boolean(slot.is_available);

                return (
                  <TouchableOpacity
                    key={index}
                    testID={`customer-slot-${index}`}
                    disabled={!isAvailable}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !isAvailable }}
                    aria-disabled={!isAvailable}
                    style={[
                      styles.slotChip,
                      isSelected && styles.slotChipSelected,
                      !isAvailable && styles.slotChipDisabled,
                    ]}
                    onPress={() => isAvailable && setSelectedSlot(slot)}
                  >
                    <Text
                      style={[
                        styles.slotTimeText,
                        isSelected && styles.slotTimeTextSelected,
                        !isAvailable && styles.slotTimeTextDisabled,
                      ]}
                    >
                      {timeString}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Free appointment indicator if slot is selected and within cooling period */}
          {Boolean(selectedSlot && isFreeAppointment) && (
            <View style={styles.freeSlotNoticeBox} testID="customer-free-slot-notice">
              <Text style={styles.freeSlotNoticeText}>
                🎁 As appointment date is within the {provider.cooling_period_days}-day cooling period &rarr; Free Appointment (₹0 Fee)
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Bottom Hold & Checkout Action */}
      <View style={styles.stickyFooter}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerLabel}>Deposit to hold:</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={[styles.footerPrice, isFreeAppointment && { color: '#047857' }]}>
              {isFreeAppointment ? '₹0' : `₹${selectedResource?.deposit_amount || 0}`}
            </Text>
            {isFreeAppointment && (
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#047857' }}>
                (Free Appointment)
              </Text>
            )}
          </View>
          {isFreeAppointment && (
            <Text style={{ fontSize: 10, color: '#059669', fontWeight: '600', marginTop: 1 }}>
              As appointment date &lt; cooling period time
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.holdButton,
            isFreeAppointment && styles.holdButtonFree,
            (!selectedSlot || provider.status === 'SUSPENDED') && styles.holdButtonDisabled,
          ]}
          disabled={!selectedSlot || !selectedResource || provider.status === 'SUSPENDED'}
          onPress={() => {
            if (selectedSlot && selectedResource && provider.status !== 'SUSPENDED') {
              onProceedToHold(
                selectedResource,
                selectedSlot,
                provider.name,
                provider.cooling_period_days,
                provider.id
              );
            }
          }}
        >
          <Text style={styles.holdButtonText}>
            {provider.status === 'SUSPENDED'
              ? 'Bookings Suspended'
              : !selectedSlot
              ? 'Select a Time Slot'
              : isFreeAppointment
              ? 'Confirm Free Appointment (₹0) →'
              : 'Hold Slot & Pay Deposit →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  topBarCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    marginHorizontal: 8,
  },
  topBarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    maxWidth: 220,
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 120,
  },
  heroImage: {
    width: '100%',
    height: 180,
    backgroundColor: '#e2e8f0',
  },
  headerInfo: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  address: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  hours: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  description: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
    marginTop: 8,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  resourceList: {
    gap: 10,
  },
  resourceCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resourceCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#f0fdf4',
  },
  resourceName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  resourceNameSelected: {
    color: '#065f46',
  },
  resourceMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  depositBadge: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  depositBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  depositSub: {
    fontSize: 9,
    color: '#166534',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateCard: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  dateCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#059669',
  },
  dateDayName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  dateNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  dateTextSelected: {
    color: '#ffffff',
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  slotChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  slotChipSelected: {
    borderColor: '#059669',
    backgroundColor: '#059669',
  },
  slotChipDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    opacity: 0.5,
  },
  slotTimeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  slotTimeTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  slotTimeTextDisabled: {
    color: '#94a3b8',
    textDecorationLine: 'line-through',
  },
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
  },
  footerSummary: {
    flex: 1,
  },
  footerLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  footerPrice: {
    fontSize: 18,
    fontWeight: '800',
    color: '#059669',
  },
  holdButton: {
    backgroundColor: '#059669',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  holdButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  holdButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  suspendedBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff1f2',
    borderWidth: 1.5,
    borderColor: '#fca5a5',
  },
  suspendedBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#9f1239',
    marginBottom: 4,
  },
  suspendedBannerText: {
    fontSize: 12,
    color: '#be123c',
    lineHeight: 17,
  },
  closedDayBanner: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fffbeb',
    borderWidth: 1.5,
    borderColor: '#fde68a',
    marginVertical: 6,
  },
  closedDayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 4,
  },
  closedDaySub: {
    fontSize: 12,
    color: '#b45309',
    lineHeight: 18,
  },
  coolingPeriodCard: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
  },
  coolingPeriodCardEligible: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    borderWidth: 2,
    borderColor: '#059669',
  },
  coolingPeriodCardExpired: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  coolingPeriodHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  coolingPeriodIcon: {
    fontSize: 18,
    marginTop: 1,
  },
  coolingPeriodTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  coolingPeriodTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065f46',
  },
  coolingPeriodTitleEligible: {
    fontSize: 13,
    fontWeight: '800',
    color: '#047857',
  },
  coolingPeriodTitleExpired: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  coolingPeriodBadge: {
    backgroundColor: '#047857',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coolingPeriodBadgeEligible: {
    backgroundColor: '#047857',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coolingPeriodBadgeExpired: {
    backgroundColor: '#64748b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coolingPeriodBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  coolingPeriodBadgeTextEligible: {
    fontSize: 9,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  coolingPeriodBadgeTextExpired: {
    fontSize: 9,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  coolingPeriodSubtitle: {
    fontSize: 11,
    color: '#047857',
    marginTop: 3,
    lineHeight: 15,
  },
  coolingPeriodSubtitleEligible: {
    fontSize: 11,
    color: '#047857',
    marginTop: 3,
    lineHeight: 15,
  },
  coolingPeriodSubtitleExpired: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 3,
    lineHeight: 15,
  },
  freeSlotNoticeBox: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
    alignItems: 'center',
  },
  freeSlotNoticeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065f46',
    textAlign: 'center',
  },
  holdButtonFree: {
    backgroundColor: '#047857',
  },
});
