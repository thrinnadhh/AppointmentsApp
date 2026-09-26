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

  const VerticalIcon = verticalConfig.id === 'salons' 
    ? Scissors 
    : verticalConfig.id === 'gaming' 
    ? Gamepad2 
    : verticalConfig.id === 'restaurants'
    ? Utensils
    : Stethoscope;

  const navItems = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    ...(isSuperAdmin ? [{ href: '/admin', label: 'Platform Admin', icon: ShieldCheck }] : []),
    { href: '/venues', label: isLocked ? 'My Venue' : 'Venues', icon: Building2 },
    { href: '/resources', label: `${verticalConfig.resourceLabelSingular}s`, icon: Users },
    { href: '/bookings', label: 'Bookings', icon: CalendarDays },
    { href: '/schedule', label: 'Schedule', icon: Clock },
    { href: '/team', label: 'Team', icon: UserCheck },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname.startsWith('/admin/login');

  const logoMark = (
    <div
      style={{
        height: 36,
        width: 36,
        borderRadius: 9,
        background: 'linear-gradient(135deg, #047857 0%, #065f46 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(4,120,87,0.28)',
        flexShrink: 0,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
      }}
      className="group-hover:scale-105"
    >
      <VerticalIcon className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
    </div>
  );

  if (isAuthPage) {
    return (
      <header style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }} className="sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-8">
          <div className="flex justify-between items-center" style={{ height: 60 }}>
            <Link href="/login" className="flex items-center gap-3 group">
              {logoMark}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                  Tirupati Merchant Hub
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-tertiary)', lineHeight: 1.3 }}>Merchant Onboarding &amp; Workspace</div>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/login?mode=register" className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }}>
                Register Venue
              </Link>
              <Link href="/login?mode=signin" className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 14px' }}>
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  const hasPortalAccess = Boolean(currentUser && (activeProvider || isSuperAdmin));
  const userInitials = currentUser?.fullName ? currentUser.fullName.substring(0, 2).toUpperCase() : 'ME';

  return (
    <header style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }} className="sticky top-0 z-40">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-8">
        <div className="flex justify-between items-center" style={{ height: 60 }}>

          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 group" style={{ textDecoration: 'none' }}>
            {logoMark}
            <div>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.02em' }}>
                  Tirupati Merchant Hub
                </span>
                {hasPortalAccess && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 99,
                    background: 'var(--color-primary-light)',
                    color: 'var(--color-primary)',
                    border: '1px solid var(--color-primary-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    letterSpacing: '0.01em',
                  }}>
                    <ShieldCheck style={{ width: 10, height: 10 }} />
                    Verified
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-tertiary)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                <Activity style={{ width: 10, height: 10, color: 'var(--color-primary)', flexShrink: 0 }} className="animate-pulse" />
                <span style={{ fontWeight: 500, color: 'var(--color-ink-secondary)', fontSize: 11 }}>
                  {activeProvider?.name || 'Private Merchant Space'}
                </span>
                {activeProvider && (
                  <span style={{ fontSize: 10, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 99 }}>
                    {verticalConfig.badgeLabel}
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* Desktop Nav */}
          {hasPortalAccess && (
            <nav className="hidden lg:flex items-center" style={{ gap: 2 }}>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-link"
                    style={isActive ? {
                      background: 'var(--color-primary-light)',
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                    } : {}}
                  >
                    <Icon style={{ width: 14, height: 14, flexShrink: 0, color: isActive ? 'var(--color-primary)' : 'var(--color-ink-tertiary)' }} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}

          {/* Right Actions */}
          <div className="flex items-center" style={{ gap: 10 }}>
            {hasPortalAccess && (
              <Link
                href="/"
                className="btn btn-ghost"
                title="Notifications"
                style={{ padding: '7px', borderRadius: 'var(--radius-md)', position: 'relative' }}
              >
                <Bell style={{ width: 17, height: 17 }} />
                <span style={{
                  position: 'absolute',
                  top: 7,
                  right: 7,
                  width: 7,
                  height: 7,
                  background: 'var(--color-primary)',
                  borderRadius: '50%',
                  border: '1.5px solid white',
                }} />
              </Link>
            )}

            {currentUser ? (
              <div className="flex items-center" style={{ paddingLeft: 12, borderLeft: '1px solid var(--color-border)', gap: 10 }}>
                <div className="hidden sm:block text-right">
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)', lineHeight: 1.2 }}>{currentUser.fullName}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-ink-tertiary)', display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginTop: 2 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-primary)', display: 'inline-block' }} />
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                      {currentUser.role === 'admin' ? 'Super Admin' : `${verticalConfig.badgeLabel} Owner`}
                    </span>
                  </div>
                </div>
                <div
                  title={currentUser.email}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: 'var(--color-primary-light)',
                    border: '1.5px solid var(--color-primary-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--color-primary)',
                    flexShrink: 0,
                    fontFamily: 'var(--font-mono)',
                    cursor: 'default',
                  }}
                >
                  {userInitials}
                </div>
                <button
                  onClick={handleSignOut}
                  className="btn btn-ghost"
                  title="Sign Out"
                  style={{ padding: '7px', color: 'var(--color-ink-tertiary)' }}
                  onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--color-error)')}
                  onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--color-ink-tertiary)')}
                >
                  <LogOut style={{ width: 15, height: 15 }} />
                </button>
              </div>
            ) : (
              <div className="flex items-center" style={{ gap: 8 }}>
                <Link href="/login?mode=register" className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }}>
                  Register Venue
                </Link>
                <Link href="/login?mode=signin" className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <LogIn style={{ width: 13, height: 13 }} />
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile scrollable sub-nav */}
      {hasPortalAccess && (
        <div
          className="lg:hidden flex overflow-x-auto scrollbar-none"
          style={{
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            padding: '6px 16px',
            gap: 4,
          }}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                  background: isActive ? 'var(--color-primary)' : 'var(--color-surface-raised)',
                  color: isActive ? '#fff' : 'var(--color-ink-secondary)',
                  border: `1px solid ${isActive ? 'transparent' : 'var(--color-border)'}`,
                  transition: 'background 100ms, color 100ms',
                }}
              >
                <Icon style={{ width: 13, height: 13 }} />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
