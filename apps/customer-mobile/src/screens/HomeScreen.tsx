import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { VERTICALS } from '@appointments/shared';
import { MOCK_PROVIDERS, fetchProvidersByCategory } from '../services/api';

interface HomeScreenProps {
  onSelectProvider: (providerId: string) => void;
  onOpenMyBookings: () => void;
}

export default function HomeScreen({ onSelectProvider, onOpenMyBookings }: HomeScreenProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [providers, setProviders] = useState(MOCK_PROVIDERS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchProvidersByCategory(selectedCategory);
        if (isMounted && data && data.length > 0) {
          setProviders(data);
        }
      } catch (e) {
        console.warn('Error loading providers:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [selectedCategory]);

  const filteredProviders = providers;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.locationBadge}>
            <Text style={styles.locationDot}>📍</Text>
            <Text style={styles.locationCity}>Tirupati, AP</Text>
          </View>
          <Text style={styles.appTitle}>Instant Appointments</Text>
        </View>

        <TouchableOpacity style={styles.myBookingsButton} onPress={onOpenMyBookings}>
          <Text style={styles.myBookingsIcon}>📅</Text>
          <Text style={styles.myBookingsText}>Bookings</Text>
        </TouchableOpacity>
      </View>

      {/* Category Pills Bar */}
      <View style={styles.categoryContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === 'all' && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategory('all')}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === 'all' && styles.categoryChipTextActive,
              ]}
            >
              All Categories
            </Text>
          </TouchableOpacity>

          {VERTICALS.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.categoryChip,
                selectedCategory === cat.id && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategory(cat.id)}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === cat.id && styles.categoryChipTextActive,
                ]}
              >
                {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Trust Notice */}
      <View style={styles.trustBanner}>
        <Text style={styles.trustBannerText}>
          ⚡ Small ₹50–₹200 deposit guarantees your slot with zero waiting at venue.
        </Text>
      </View>

      {/* Providers List */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionHeading}>Nearby in Tirupati ({filteredProviders.length})</Text>

        {filteredProviders.map((provider) => (
          <TouchableOpacity
            key={provider.id}
            style={styles.providerCard}
            activeOpacity={0.85}
            onPress={() => onSelectProvider(provider.id)}
          >
            <Image
              source={{ uri: provider.photos?.[0] || 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=400' }}
              style={styles.providerImage}
            />

            <View style={styles.providerContent}>
              <View style={styles.providerHeader}>
                <Text style={styles.providerName} numberOfLines={1}>
                  {provider.name}
                </Text>
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceText}>{provider.distance_km} km</Text>
                </View>
              </View>

              <Text style={styles.providerAddress} numberOfLines={1}>
                {provider.address}
              </Text>

              <View style={styles.cardFooter}>
                <View style={styles.slotIndicator}>
                  <Text style={styles.slotClock}>🕒</Text>
                  <Text style={styles.slotText}>{provider.next_slot}</Text>
                </View>

                <View style={styles.depositPill}>
                  <Text style={styles.depositLabel}>Deposit from </Text>
                  <Text style={styles.depositAmount}>
                    ₹{provider.resources[0]?.deposit_amount || 50}
                  </Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        ))}
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDot: {
    fontSize: 12,
    marginRight: 4,
  },
  locationCity: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  myBookingsButton: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  myBookingsIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  myBookingsText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  categoryContainer: {
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  categoryScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  categoryChipActive: {
    backgroundColor: '#059669',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#ffffff',
  },
  trustBanner: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#d1fae5',
  },
  trustBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#065f46',
    textAlign: 'center',
  },
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  providerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  providerImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#e2e8f0',
  },
  providerContent: {
    padding: 14,
  },
  providerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  providerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    marginRight: 8,
  },
  distanceBadge: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  distanceText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  providerAddress: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
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
  slotIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slotClock: {
    fontSize: 12,
    marginRight: 4,
  },
  slotText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  depositPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  depositLabel: {
    fontSize: 11,
    color: '#166534',
  },
  depositAmount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
});
