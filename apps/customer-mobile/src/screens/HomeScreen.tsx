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
import { VERTICALS, normCategory } from '@appointments/shared';
import {
  MOCK_PROVIDERS,
  fetchProvidersByCategory,
  ProviderWithDetails,
  getCachedProvidersByCategory,
  searchDirectoryOnSupabase,
} from '../services/api';

interface VerticalVisual {
  emoji: string;
  tag: string;
  bg: string;
  iconBg: string;
  color: string;
  borderColor: string;
}

const VERTICAL_VISUALS: Record<string, VerticalVisual> = {
  clinics: {
    emoji: '🏥',
    tag: 'Doctors & Care',
    bg: '#ecfdf5',
    iconBg: '#d1fae5',
    color: '#059669',
    borderColor: '#a7f3d0',
  },
  salons: {
    emoji: '✂️',
    tag: 'Hair & Beauty',
    bg: '#fff1f2',
    iconBg: '#ffe4e6',
    color: '#e11d48',
    borderColor: '#fecdd3',
  },
  restaurants: {
    emoji: '🍽️',
    tag: 'Dining & Booths',
    bg: '#fffbeb',
    iconBg: '#fef3c7',
    color: '#d97706',
    borderColor: '#fde68a',
  },
  gaming: {
    emoji: '🏏',
    tag: 'Turfs & Courts',
    bg: '#eff6ff',
    iconBg: '#dbeafe',
    color: '#2563eb',
    borderColor: '#bfdbfe',
  },
  pets: {
    emoji: '🐾',
    tag: 'Vets & Pets',
    bg: '#faf5ff',
    iconBg: '#f3e8ff',
    color: '#7c3aed',
    borderColor: '#e9d5ff',
  },
};

// The exactly 5 core service categories in preferred order
const FIVE_CATEGORIES = [
  VERTICALS.find((v) => v.id === 'clinics')!,
  VERTICALS.find((v) => v.id === 'salons')!,
  VERTICALS.find((v) => v.id === 'restaurants')!,
  VERTICALS.find((v) => v.id === 'gaming')!,
  VERTICALS.find((v) => v.id === 'pets')!,
].filter(Boolean);

function getVerticalVisual(categoryId?: string): VerticalVisual {
  if (!categoryId) return VERTICAL_VISUALS.clinics;
  const key = categoryId.toLowerCase().replace(/s$/, '');
  if (key === 'clinic' || key === 'hospital') return VERTICAL_VISUALS.clinics;
  if (key === 'salon' || key === 'spa') return VERTICAL_VISUALS.salons;
  if (key === 'restaurant' || key === 'dining') return VERTICAL_VISUALS.restaurants;
  if (key === 'gaming' || key === 'turf') return VERTICAL_VISUALS.gaming;
  if (key === 'pet') return VERTICAL_VISUALS.pets;
  return VERTICAL_VISUALS[categoryId] || VERTICAL_VISUALS.clinics;
}

function getVerticalInfo(categoryId?: string) {
  if (!categoryId) return null;
  const norm = categoryId.toLowerCase().replace(/s$/, '');
  return VERTICALS.find((v) => v.id.replace(/s$/, '') === norm) || null;
}

interface HomeScreenProps {
  selectedCategory?: string | null;
  onSelectCategory?: (categoryId: string | null) => void;
  onSelectProvider: (providerId: string) => void;
  onOpenMyBookings: () => void;
  onOpenProfile?: () => void;
}

export default function HomeScreen({
  selectedCategory: propCategory,
  onSelectCategory: propOnSelectCategory,
  onSelectProvider,
  onOpenMyBookings,
  onOpenProfile,
}: HomeScreenProps) {
  // First page shows only the 5 category mini logos when selectedCategory is null
  const [internalCategory, setInternalCategory] = useState<string | null>(null);
  const selectedCategory = propCategory !== undefined ? propCategory : internalCategory;
  const setSelectedCategory = (cat: string | null) => {
    if (propOnSelectCategory) {
      propOnSelectCategory(cat);
    } else {
      setInternalCategory(cat);
    }
  };
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fuzzyResults, setFuzzyResults] = useState<ProviderWithDetails[] | null>(null);
  const [providers, setProviders] = useState<ProviderWithDetails[]>(() => {
    const cached = getCachedProvidersByCategory(selectedCategory || undefined);
    if (cached && cached.length > 0) return cached;
    if (selectedCategory) {
      const norm = selectedCategory.toLowerCase().replace(/s$/, '');
      const filtered = MOCK_PROVIDERS.filter((p) => p.category_id.toLowerCase().replace(/s$/, '') === norm);
      if (filtered.length > 0) return filtered;
    }
    return MOCK_PROVIDERS;
  });
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({
    clinics: 29,
    salons: 1,
    restaurants: 1,
    gaming: 28,
    pets: 1,
  });
  const [loading, setLoading] = useState(false);

  // Load category venue counts on mount
  useEffect(() => {
    let isMounted = true;
    async function loadAllCounts() {
      try {
        const allData = await fetchProvidersByCategory('all');
        if (isMounted && allData && allData.length > 0) {
          const counts: Record<string, number> = {};
          allData.forEach((p) => {
            const norm = p.category_id.toLowerCase().replace(/s$/, '');
            const key =
              norm === 'clinic' || norm === 'hospital'
                ? 'clinics'
                : norm === 'salon' || norm === 'spa'
                ? 'salons'
                : norm === 'restaurant' || norm === 'dining'
                ? 'restaurants'
                : norm === 'gaming' || norm === 'turf'
                ? 'gaming'
                : norm === 'pet'
                ? 'pets'
                : p.category_id;
            counts[key] = (counts[key] || 0) + 1;
          });
          setCategoryCounts((prev) => ({ ...prev, ...counts }));
        }
      } catch (err) {
        console.warn('Error loading category counts:', err);
      }
    }
    loadAllCounts();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch providers when category is selected
  useEffect(() => {
    if (!selectedCategory) return;
    let isMounted = true;
    async function load() {
      const cached = getCachedProvidersByCategory(selectedCategory || undefined);
      if (!cached || cached.length === 0) {
        setLoading(true);
      }
      try {
        const data = await fetchProvidersByCategory(selectedCategory || undefined);
        if (isMounted) {
          setProviders(data);
        }
      } catch (e) {
        console.warn('Error loading providers for category:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [selectedCategory]);

  // Typo-tolerant fuzzy search via Supabase pg_trgm
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 3) {
      setFuzzyResults(null);
      return;
    }

    let isCurrent = true;
    const timeout = setTimeout(async () => {
      try {
        const results = await searchDirectoryOnSupabase(q);
        if (isCurrent && results.length > 0) {
          const scoped = selectedCategory && selectedCategory !== 'all'
            ? results.filter((p) => normCategory(p.category_id) === normCategory(selectedCategory))
            : results;
          setFuzzyResults(scoped.length > 0 ? scoped : results);
        } else if (isCurrent) {
          setFuzzyResults(null);
        }
      } catch {
        if (isCurrent) setFuzzyResults(null);
      }
    }, 250);

    return () => {
      isCurrent = false;
      clearTimeout(timeout);
    };
  }, [searchQuery, selectedCategory]);

  const filteredProviders = fuzzyResults && fuzzyResults.length > 0
    ? fuzzyResults
    : providers.filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.trim().toLowerCase();
        const matchName = p.name?.toLowerCase().includes(q);
        const matchDesc = p.description?.toLowerCase().includes(q);
        const matchAddr = p.address?.toLowerCase().includes(q);
        const matchResource = p.resources?.some(
          (r) =>
            r.name?.toLowerCase().includes(q) ||
            (r.attributes as Record<string, string | undefined>)?.specialization?.toLowerCase().includes(q) ||
            r.department?.toLowerCase().includes(q)
        );
        return matchName || matchDesc || matchAddr || matchResource;
      });

  const currentVertical = getVerticalInfo(selectedCategory || undefined);
  const currentVisual = getVerticalVisual(selectedCategory || undefined);

  const renderCategoryCard = (cat: (typeof FIVE_CATEGORIES)[0]) => {
    const visual = getVerticalVisual(cat.id);
    const count = categoryCounts[cat.id] || 1;

    return (
      <TouchableOpacity
        key={cat.id}
        style={[styles.gridCard, { borderColor: visual.borderColor }]}
        onPress={() => setSelectedCategory(cat.id)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={cat.name}
      >
        <View style={[styles.gridIconCircle, { backgroundColor: visual.iconBg }]}>
          <Text style={styles.gridCategoryEmoji}>{visual.emoji}</Text>
        </View>

        <Text style={[styles.gridCategoryName, { color: visual.color }]} numberOfLines={1}>
          {cat.name}
        </Text>

        <Text style={styles.gridCategoryDesc} numberOfLines={2}>
          {cat.description}
        </Text>

        <View style={[styles.gridCountBadge, { backgroundColor: visual.bg, borderColor: visual.borderColor }]}>
          <Text style={[styles.gridCountText, { color: visual.color }]}>
            {count} {count === 1 ? 'venue' : 'venues'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      {/* Top Header with App Logo & Location */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandLogoCircle}>
            <Text style={styles.brandLogoEmoji}>⚡</Text>
          </View>
          <View>
            <View style={styles.locationBadge}>
              <Text style={styles.locationDot}>📍</Text>
              <Text style={styles.locationCity}>Tirupati, AP</Text>
            </View>
            <Text style={styles.appTitle}>Instant Appointments</Text>
          </View>
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

      {/* ========================================================================= */}
      {/* SCREEN 1: FIRST PAGE AFTER LOGO -> ONLY THE 5 MINI LOGOS / CATEGORIES      */}
      {/* ========================================================================= */}
      {!selectedCategory ? (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.hubContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hubHeader}>
            <Text style={styles.hubTitle}>Choose a Service</Text>
            <Text style={styles.hubSubtitle}>
              Select a category to view verified venues with guaranteed zero-wait booking
            </Text>
          </View>

          {/* The Exactly Five Category Cards: 2 Columns Per Row, 5th Centered in Middle */}
          <View style={styles.categoryGrid}>
            {/* Row 1: 2 Columns */}
            <View style={styles.gridRow}>
              {renderCategoryCard(FIVE_CATEGORIES[0])}
              {renderCategoryCard(FIVE_CATEGORIES[1])}
            </View>

            {/* Row 2: 2 Columns */}
            <View style={styles.gridRow}>
              {renderCategoryCard(FIVE_CATEGORIES[2])}
              {renderCategoryCard(FIVE_CATEGORIES[3])}
            </View>

            {/* Row 3: The 5th card centered in the middle */}
            <View style={styles.gridCenterRow}>
              <View style={styles.gridCenterCardWrapper}>
                {renderCategoryCard(FIVE_CATEGORIES[4])}
              </View>
            </View>
          </View>

          {/* Trust Banner on First Page */}
          <View style={styles.trustBanner}>
            <Text style={styles.trustBannerText}>
              ⚡ Small ₹50–₹200 deposit guarantees your slot with zero waiting at venue.
            </Text>
          </View>
        </ScrollView>
      ) : (
        /* ========================================================================= */
        /* SCREEN 2: ON CLICKING CATEGORY -> RELATED DATA & VENUES                   */
        /* ========================================================================= */
        <View style={styles.categoryDataWrapper}>
          {/* Back to Categories Navigation Header */}
          <View style={[styles.activeCategoryBar, { backgroundColor: currentVisual.bg, borderColor: currentVisual.borderColor }]}>
            <TouchableOpacity
              style={styles.backToHubBtn}
              onPress={() => {
                setSelectedCategory(null);
                setSearchQuery('');
              }}
              accessibilityLabel="Back to Categories"
            >
              <Text style={styles.backToHubText}>← All Categories</Text>
            </TouchableOpacity>

            <View style={styles.activeBannerTextCol}>
              <View style={styles.activeBannerBadgeRow}>
                <Text style={styles.activeBannerEmoji}>{currentVisual.emoji}</Text>
                <Text style={[styles.activeBannerTitle, { color: currentVisual.color }]}>
                  {currentVertical?.name} in Tirupati
                </Text>
              </View>
              <Text style={styles.activeBannerDesc} numberOfLines={1}>
                {currentVertical?.description} • {filteredProviders.length} available
              </Text>
            </View>
          </View>

          {/* Quick 5 Category Mini-Logos Switcher */}
          <View style={styles.switcherContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryScroll}
            >
              {FIVE_CATEGORIES.map((cat) => {
                const visual = getVerticalVisual(cat.id);
                const isActive = selectedCategory === cat.id;

                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryCard,
                      isActive && styles.categoryCardActive,
                      isActive && { borderColor: visual.color, backgroundColor: visual.bg },
                    ]}
                    onPress={() => {
                      setSelectedCategory(cat.id);
                      setSearchQuery('');
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={cat.name}
                  >
                    <View
                      style={[
                        styles.categoryIconCircle,
                        { backgroundColor: isActive ? visual.color : visual.iconBg },
                      ]}
                    >
                      <Text style={styles.categoryEmoji}>{visual.emoji}</Text>
                    </View>

                    <Text
                      style={[
                        styles.categoryName,
                        isActive && styles.categoryNameActive,
                        isActive && { color: visual.color },
                      ]}
                    >
                      {cat.name}
                    </Text>

                    <Text
                      style={[
                        styles.categoryTag,
                        isActive && { color: visual.color, fontWeight: '700' },
                      ]}
                      numberOfLines={1}
                    >
                      {visual.tag}
                    </Text>

                    {isActive && (
                      <View style={[styles.activeIndicatorDot, { backgroundColor: visual.color }]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Search Bar for this Category */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                testID="customer-search-input"
                style={styles.searchInput}
                placeholder={`Search doctors, salons, restaurants, turfs in ${currentVertical?.name}...`}
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={`Search venues and specialists in ${currentVertical?.name}`}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  testID="clear-search-button"
                  onPress={() => setSearchQuery('')}
                  style={styles.clearSearchBtn}
                  accessibilityLabel="Clear search"
                >
                  <Text style={styles.clearSearchText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Category-Specific Providers List */}
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.listHeaderRow}>
              <Text style={styles.sectionHeading}>
                {searchQuery
                  ? `Search Results (${filteredProviders.length})`
                  : `Nearby in Tirupati (${filteredProviders.length})`}
              </Text>
              {loading && <ActivityIndicator size="small" color="#059669" />}
            </View>

            {filteredProviders.length === 0 ? (
              <View style={styles.emptyResults}>
                <Text style={styles.emptyResultsIcon}>🔎</Text>
                <Text style={styles.emptyResultsTitle}>No venues found in {currentVertical?.name}</Text>
                <Text style={styles.emptyResultsSubtitle}>
                  Try clearing your search term or explore one of the other categories.
                </Text>
                <TouchableOpacity
                  testID="reset-search-button"
                  style={styles.resetFilterBtn}
                  onPress={() => setSearchQuery('')}
                >
                  <Text style={styles.resetFilterBtnText}>Clear Search</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredProviders.map((provider) => {
                const provVisual = getVerticalVisual(provider.category_id);
                const provVertical = getVerticalInfo(provider.category_id);
                const unitLabel = provVertical?.unitName || 'Staff';
                const resourceCount = provider.resources?.length || 0;

                return (
                  <TouchableOpacity
                    key={provider.id}
                    testID="provider-card"
                    style={styles.providerCard}
                    activeOpacity={0.85}
                    onPress={() => onSelectProvider(provider.id)}
                  >
                    <View style={styles.cardImageContainer}>
                      <Image
                        source={{
                          uri:
                            provider.photos?.[0] ||
                            'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=400',
                        }}
                        style={styles.providerImage}
                      />
                      <View
                        style={[
                          styles.cardCategoryBadge,
                          { backgroundColor: provVisual.bg, borderColor: provVisual.borderColor },
                        ]}
                      >
                        <Text style={[styles.cardCategoryName, { color: provVisual.color }]}>
                          {provVisual.emoji} {provVertical?.name || provider.category_id}
                        </Text>
                      </View>
                    </View>

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

                      {resourceCount > 0 && (
                        <View style={styles.resourceTagRow}>
                          <Text style={styles.resourceTagText}>
                            ✓ {resourceCount} {unitLabel}{resourceCount > 1 ? 's' : ''} available
                          </Text>
                        </View>
                      )}

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
                );
              })
            )}
          </ScrollView>
        </View>
      )}
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogoCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  brandLogoEmoji: {
    fontSize: 18,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDot: {
    fontSize: 11,
    marginRight: 4,
  },
  locationCity: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 1,
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

  /* Hub Screen (First Page with ONLY the 5 Categories) */
  hubContent: {
    padding: 16,
    paddingBottom: 32,
  },
  hubHeader: {
    marginTop: 8,
    marginBottom: 16,
  },
  hubTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  hubSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    lineHeight: 18,
  },
  categoryGrid: {
    gap: 12,
    marginBottom: 20,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  gridCenterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  gridCenterCardWrapper: {
    width: '48.5%',
  },
  gridCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  gridIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  gridCategoryEmoji: {
    fontSize: 26,
  },
  gridCategoryName: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  gridCategoryDesc: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 14,
    marginBottom: 10,
    minHeight: 28,
  },
  gridCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  gridCountText: {
    fontSize: 10,
    fontWeight: '700',
  },

  /* Category Data View */
  categoryDataWrapper: {
    flex: 1,
  },
  activeCategoryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  backToHubBtn: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  backToHubText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
  },
  activeBannerTextCol: {
    flex: 1,
  },
  activeBannerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activeBannerEmoji: {
    fontSize: 13,
  },
  activeBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  activeBannerDesc: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },

  /* Switcher Bar */
  switcherContainer: {
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  categoryScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    minWidth: 94,
  },
  categoryCardActive: {
    elevation: 2,
  },
  categoryIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  categoryEmoji: {
    fontSize: 18,
  },
  categoryName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
  },
  categoryNameActive: {
    fontWeight: '800',
  },
  categoryTag: {
    fontSize: 9,
    color: '#94a3b8',
    marginTop: 1,
    fontWeight: '500',
    textAlign: 'center',
  },
  activeIndicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
  },

  /* Search Bar */
  searchBarContainer: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 8,
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

  /* Trust Banner */
  trustBanner: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  trustBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#065f46',
    textAlign: 'center',
  },

  /* Providers List */
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
  cardImageContainer: {
    position: 'relative',
    width: '100%',
    height: 140,
    backgroundColor: '#e2e8f0',
  },
  providerImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#e2e8f0',
  },
  cardCategoryBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardCategoryName: {
    fontSize: 10,
    fontWeight: '700',
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
  resourceTagRow: {
    marginTop: 6,
    backgroundColor: '#f0fdf4',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  resourceTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#166534',
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
