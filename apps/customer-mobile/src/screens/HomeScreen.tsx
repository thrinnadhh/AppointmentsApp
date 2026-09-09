import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
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
  onOpenProfile?: () => void;
}

export default function HomeScreen({
  onSelectProvider,
  onOpenMyBookings,
  onOpenProfile,
}: HomeScreenProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
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

  const filteredProviders = providers.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchName = p.name?.toLowerCase().includes(q);
    const matchDesc = p.description?.toLowerCase().includes(q);
    const matchAddr = p.address?.toLowerCase().includes(q);
    const matchResource = p.resources?.some(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.attributes as Record<string, string | undefined>)?.specialization?.toLowerCase().includes(q) ||
        (r as unknown as { department?: string }).department?.toLowerCase().includes(q)
    );
    return matchName || matchDesc || matchAddr || matchResource;
  });

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

        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.myBookingsButton}
            onPress={onOpenMyBookings}
            accessibilityLabel="My Bookings"
          >
            <Text style={styles.myBookingsIcon}>📅</Text>
            <Text style={styles.myBookingsText}>Bookings</Text>
          </TouchableOpacity>

          {onOpenProfile && (
            <TouchableOpacity
              style={styles.profileButton}
              onPress={onOpenProfile}
              accessibilityLabel="Customer Profile"
            >
              <Text style={styles.profileIcon}>👤</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Real-time Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search doctors, salons, restaurants, turfs..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchBtn}
              accessibilityLabel="Clear search"
            >
              <Text style={styles.clearSearchText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
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
        <View style={styles.listHeaderRow}>
          <Text style={styles.sectionHeading}>
            {searchQuery ? `Search Results (${filteredProviders.length})` : `Nearby in Tirupati (${filteredProviders.length})`}
          </Text>
          {loading && <ActivityIndicator size="small" color="#059669" />}
        </View>

        {filteredProviders.length === 0 ? (
          <View style={styles.emptyResults}>
            <Text style={styles.emptyResultsIcon}>🔎</Text>
            <Text style={styles.emptyResultsTitle}>No providers found</Text>
            <Text style={styles.emptyResultsSubtitle}>
              Try searching for a different doctor, turf, clinic, or clear your search term.
            </Text>
            <TouchableOpacity
              style={styles.resetFilterBtn}
              onPress={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
            >
              <Text style={styles.resetFilterBtnText}>Reset Filters</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredProviders.map((provider) => (
            <TouchableOpacity
              key={provider.id}
              style={styles.providerCard}
              activeOpacity={0.85}
              onPress={() => onSelectProvider(provider.id)}
            >
              <Image
                source={{
                  uri:
                    provider.photos?.[0] ||
                    'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=400',
                }}
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
          ))
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
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: {
    fontSize: 16,
  },
  searchBarContainer: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    padding: 0,
  },
  clearSearchBtn: {
    padding: 4,
  },
  clearSearchText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '700',
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
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyResults: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },
  emptyResultsIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyResultsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  emptyResultsSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  resetFilterBtn: {
    marginTop: 16,
    backgroundColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  resetFilterBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
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
