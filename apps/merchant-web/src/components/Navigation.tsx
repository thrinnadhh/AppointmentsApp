'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  CalendarDays, 
  Users, 
  LayoutDashboard, 
  Building2, 
  ShieldCheck, 
  Bell, 
  UserCheck, 
  LogOut, 
  LogIn, 
  Activity,
  Clock,
  Settings,
  MapPin,
  Scissors,
  Stethoscope,
  Gamepad2,
  Utensils
} from 'lucide-react';
import { supabase, getCurrentUserProfile, signOutMerchant } from '@/lib/supabase';
import { useMerchantTenant } from '@/contexts/MerchantTenantContext';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeProvider, verticalConfig, isSuperAdmin, isLocked } = useMerchantTenant();

  const [currentUser, setCurrentUser] = useState<{
    email?: string;
    fullName?: string;
    role?: string;
  } | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const userProfile = await getCurrentUserProfile();
        if (userProfile?.profile) {
          setCurrentUser({
            email: userProfile.profile.email || userProfile.user.email,
            fullName: userProfile.profile.full_name || 'Admin User',
            role: userProfile.profile.role,
          });
        } else if (userProfile?.user) {
          setCurrentUser({
            email: userProfile.user.email,
            fullName: (userProfile.user.user_metadata?.full_name as string) || 'Authorized Staff',
            role: (userProfile.user.user_metadata?.role as string) || 'merchant',
          });
        } else {
          setCurrentUser(null);
        }
      } catch (err) {
        console.warn('Auth check fallback:', err);
      }
    }
    loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUser({
          email: session.user.email,
          fullName: (session.user.user_metadata?.full_name as string) || 'Authorized Staff',
          role: (session.user.user_metadata?.role as string) || 'merchant',
        });
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await signOutMerchant();
    setCurrentUser(null);
    router.push('/login');
  };

  // Determine vertical icon
  const VerticalIcon = verticalConfig.id === 'salons' 
    ? Scissors 
    : verticalConfig.id === 'gaming' 
    ? Gamepad2 
    : verticalConfig.id === 'restaurants'
    ? Utensils
    : Stethoscope;

  // Adaptive nav items: verticalized resource label, conditionally include /admin for Super Admin only
  const navItems = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    ...(isSuperAdmin ? [{ href: '/admin', label: 'Platform Admin', icon: ShieldCheck }] : []),
    { href: '/venues', label: isLocked ? 'My Venue' : 'Venues & Businesses', icon: Building2 },
    { href: '/resources', label: `${verticalConfig.resourceLabelSingular}s & Services`, icon: Users },
    { href: '/bookings', label: 'Bookings Queue', icon: CalendarDays },
    { href: '/schedule', label: 'Availability & Hours', icon: Clock },
    { href: '/team', label: 'Team & Access', icon: UserCheck },
    { href: '/settings', label: 'Settings & Profile', icon: Settings },
  ];

  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname.startsWith('/admin/login');

  if (isAuthPage) {
    return (
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/login" className="flex items-center space-x-3 group">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-slate-900 tracking-tight text-base">
                  Tirupati Merchant Hub
                </span>
                <p className="text-xs text-slate-500">Merchant Onboarding & Workspace</p>
              </div>
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/login?mode=register"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition"
              >
                Register Venue
              </Link>
              <Link
                href="/login?mode=signin"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  const hasPortalAccess = Boolean(currentUser && (activeProvider || isSuperAdmin));

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand Logo & Platform Title */}
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
              <VerticalIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 tracking-tight text-base group-hover:text-emerald-700 transition-colors">
                  Tirupati Merchant Hub
                </span>
                {hasPortalAccess && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
                    Verified Portal
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
                <span className="font-semibold text-slate-700">{activeProvider?.name || 'Private Merchant Space'}</span>
                {activeProvider && (
                  <span className="text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded ml-1 font-medium">
                    {verticalConfig.badgeLabel}
                  </span>
                )}
              </p>
            </div>
          </Link>

          {/* Desktop Navigation Links - only visible when user has an active registered venue or is super admin */}
          {hasPortalAccess && (
            <nav className="hidden lg:flex space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200/60 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mr-2 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}

          {/* Right Status Actions & User Account */}
          <div className="flex items-center space-x-3">
            {hasPortalAccess && (
              <Link
                href="/"
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg relative"
                title="Notifications & System Alerts"
              >
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-white"></span>
              </Link>
            )}

            {currentUser ? (
              <div className="flex items-center pl-3 border-l border-slate-200 gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-slate-900">{currentUser.fullName}</p>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
                      {currentUser.role === 'admin' ? 'Super Admin' : `${verticalConfig.badgeLabel} Owner`}
                    </p>
                  </div>
                </div>
                <div 
                  className="w-9 h-9 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-xs font-bold text-emerald-800 shadow-xs"
                  title={currentUser.email}
                >
                  {currentUser.fullName ? currentUser.fullName.substring(0, 2).toUpperCase() : 'ME'}
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login?mode=register"
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
                >
                  Register Venue
                </Link>
                <Link
                  href="/login?mode=signin"
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5 mr-1" />
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Sub-Navigation Bar - only visible when portal access is active */}
      {hasPortalAccess && (
        <div className="lg:hidden flex overflow-x-auto border-t border-slate-100 px-2 py-1.5 bg-slate-50/80 gap-1 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5 mr-1.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
