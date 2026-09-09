import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
} from 'react-native';
import { Resource, Slot } from '@appointments/shared';
import { MOCK_PROVIDERS, generateAvailableSlots, fetchProviderById } from '../services/api';

interface ProviderDetailScreenProps {
  providerId: string;
  onBack: () => void;
  onProceedToHold: (resource: Resource, slot: Slot) => void;
}

export default function ProviderDetailScreen({
  providerId,
  onBack,
  onProceedToHold,
}: ProviderDetailScreenProps) {
  const initialProvider = MOCK_PROVIDERS.find((p) => p.id === providerId) || MOCK_PROVIDERS[0];
  const [provider, setProvider] = useState(initialProvider);
  const [selectedResource, setSelectedResource] = useState<Resource>(
    initialProvider.resources?.[0] || MOCK_PROVIDERS[0].resources[0]
  );
  const [selectedDateIndex, setSelectedDateIndex] = useState<number>(0);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const p = await fetchProviderById(providerId);
      if (isMounted && p) {
        setProvider(p as any);
        if (p.resources && p.resources.length > 0) {
          setSelectedResource(p.resources[0]);
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [providerId]);

  // Generate 3 date options (Today, Tomorrow, Day after)
  const dates = [0, 1, 2].map((offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  });

  const availableSlots = selectedResource ? generateAvailableSlots(selectedResource, dates[selectedDateIndex]) : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {provider.name}
        </Text>
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
          <Text style={styles.hours}>
            🕒 Hours: {provider.opening_time.slice(0, 5)} - {provider.closing_time.slice(0, 5)}
          </Text>
          <Text style={styles.description}>{provider.description}</Text>
        </View>

        {/* 1. Select Resource / Staff */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Select Staff / Unit</Text>
          <View style={styles.resourceList}>
            {provider.resources.map((res) => {
              const isSelected = selectedResource.id === res.id;
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
                  style={[styles.dateCard, isSelected && styles.dateCardSelected]}
                  onPress={() => {
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
          <View style={styles.slotGrid}>
            {availableSlots.map((slot, index) => {
              const timeString = new Date(slot.start_time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const isSelected = selectedSlot?.start_time === slot.start_time;

              return (
                <TouchableOpacity
                  key={index}
                  disabled={!slot.is_available}
                  style={[
                    styles.slotChip,
                    isSelected && styles.slotChipSelected,
                    !slot.is_available && styles.slotChipDisabled,
                  ]}
                  onPress={() => setSelectedSlot(slot)}
                >
                  <Text
                    style={[
                      styles.slotTimeText,
                      isSelected && styles.slotTimeTextSelected,
                      !slot.is_available && styles.slotTimeTextDisabled,
                    ]}
                  >
                    {timeString}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Sticky Bottom Hold & Checkout Action */}
      <View style={styles.stickyFooter}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerLabel}>Deposit to hold:</Text>
          <Text style={styles.footerPrice}>₹{selectedResource?.deposit_amount || 0}</Text>
        </View>

        <TouchableOpacity
          style={[styles.holdButton, !selectedSlot && styles.holdButtonDisabled]}
          disabled={!selectedSlot}
          onPress={() => selectedSlot && onProceedToHold(selectedResource, selectedSlot)}
        >
          <Text style={styles.holdButtonText}>
            {selectedSlot ? 'Hold Slot & Pay Deposit →' : 'Select a Time Slot'}
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
  topBarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    maxWidth: 200,
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
});
