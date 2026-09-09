'use client';

import React, { useState } from 'react';
import {
  Building2,
  CreditCard,
  Bell,
  ShieldCheck,
  Save,
  CheckCircle2,
  Mail,
  Smartphone,
  MapPin,
  Key,
} from 'lucide-react';

type SettingsTab = 'profile' | 'payments' | 'notifications' | 'policies';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [saved, setSaved] = useState(false);

  // Profile State
  const [businessName, setBusinessName] = useState('Tirupati Appointments Operations Hub');
  const [supportPhone, setSupportPhone] = useState('+91 877 2255889');
  const [supportEmail, setSupportEmail] = useState('contact@appointments-tirupati.com');
  const [jurisdiction, setJurisdiction] = useState('Tirupati Municipal Corporation (TMC), AP');
  const [gstin, setGstin] = useState('37AAAAA0000A1Z5');

  // Payment & Payout State
  const [razorpayKeyId, setRazorpayKeyId] = useState('rzp_test_TirupatiAppointments');
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(true);
  const [payoutUpi, setPayoutUpi] = useState('merchant.ops@upi');
  const [bankAccount, setBankAccount] = useState('•••• •••• 9821 (SBI Tirupati Main Branch)');
  const [minDeposit, setMinDeposit] = useState('50');

  // Notification State
  const [smsAlerts, setSmsAlerts] = useState(true);
  const [whatsappConfirmations, setWhatsappConfirmations] = useState(true);
  const [autoConfirmHolds, setAutoConfirmHolds] = useState(true);
  const [reminderOffsetHours, setReminderOffsetHours] = useState('2');

  // Policy State
  const [cancellationWindowHours, setCancellationWindowHours] = useState('1');
  const [forfeitOnNoShow, setForfeitOnNoShow] = useState(true);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              System Administration
            </span>
            <span className="text-xs text-slate-500">• Platform Master Configuration</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Settings & Profile
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage organization credentials, payment gateway keys, deposit rules, and notification channels.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-xs"
        >
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-200" />
              Settings Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </button>
      </div>

      {/* Success Toast */}
      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="font-semibold">Configurations successfully persisted to platform preferences.</span>
          </div>
          <span className="text-xs font-mono bg-emerald-100 px-2 py-0.5 rounded text-emerald-800">
            SYNCED
          </span>
        </div>
      )}

      {/* Settings Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-2 sm:space-x-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('profile')}
          className={`pb-3 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'profile'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Business Profile
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`pb-3 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'payments'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Payments & Gateway
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`pb-3 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'notifications'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Bell className="w-4 h-4" />
          Notifications & Alerts
        </button>
        <button
          onClick={() => setActiveTab('policies')}
          className={`pb-3 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'policies'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Deposit & Refund Rules
        </button>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* TAB 1: BUSINESS PROFILE */}
        {activeTab === 'profile' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
              Organization & Operating Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="business-name-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Business Legal Name
                </label>
                <input
                  id="business-name-input"
                  name="businessName"
                  aria-label="Business Legal Name"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="gstin-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  GSTIN / Registration Number
                </label>
                <input
                  id="gstin-input"
                  name="gstin"
                  aria-label="GSTIN Registration Number"
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label htmlFor="support-phone-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Support Telephone
                </label>
                <div className="relative">
                  <Smartphone className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    id="support-phone-input"
                    name="supportPhone"
                    aria-label="Support Telephone"
                    type="text"
                    value={supportPhone}
                    onChange={(e) => setSupportPhone(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="support-email-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Support Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    id="support-email-input"
                    name="supportEmail"
                    aria-label="Support Email"
                    type="email"
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="jurisdiction-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Regional Jurisdiction
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    id="jurisdiction-input"
                    name="jurisdiction"
                    aria-label="Regional Jurisdiction"
                    type="text"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PAYMENTS & GATEWAY */}
        {activeTab === 'payments' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
              Payment Gateway & Merchant Payout Routing
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="razorpay-key-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Razorpay API Key ID
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    id="razorpay-key-input"
                    name="razorpayKey"
                    aria-label="Razorpay API Key ID"
                    type="text"
                    value={razorpayKeyId}
                    onChange={(e) => setRazorpayKeyId(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="webhook-enforced-checkbox" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Webhook Signature Verification
                </label>
                <div className="flex items-center justify-between p-2.5 border border-slate-200 rounded-xl bg-slate-50">
                  <span className="text-xs font-medium text-slate-700">HMAC SHA256 Enforced</span>
                  <input
                    id="webhook-enforced-checkbox"
                    name="webhookEnforced"
                    aria-label="Enforce HMAC SHA256 Webhook Verification"
                    type="checkbox"
                    checked={webhookSecretConfigured}
                    onChange={(e) => setWebhookSecretConfigured(e.target.checked)}
                    className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="payout-upi-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Settlement UPI ID
                </label>
                <input
                  id="payout-upi-input"
                  name="payoutUpi"
                  aria-label="Settlement UPI ID"
                  type="text"
                  value={payoutUpi}
                  onChange={(e) => setPayoutUpi(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="bank-account-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Designated Bank Account
                </label>
                <input
                  id="bank-account-input"
                  name="bankAccount"
                  aria-label="Designated Bank Account"
                  type="text"
                  value={bankAccount}
                  readOnly
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 font-mono"
                />
              </div>

              <div>
                <label htmlFor="min-deposit-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Minimum Default Deposit (₹)
                </label>
                <input
                  id="min-deposit-input"
                  name="minDeposit"
                  aria-label="Minimum Default Deposit in Rupees"
                  type="number"
                  value={minDeposit}
                  onChange={(e) => setMinDeposit(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: NOTIFICATIONS */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
              Automated Messaging & Real-Time Alerts
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition">
                <div>
                  <p className="text-sm font-bold text-slate-900">SMS Booking Notifications</p>
                  <p className="text-xs text-slate-500">Send instant SMS with appointment time and venue address to customer upon deposit confirmation.</p>
                </div>
                <input
                  id="sms-alerts-checkbox"
                  name="smsAlerts"
                  aria-label="Enable SMS Booking Notifications"
                  type="checkbox"
                  checked={smsAlerts}
                  onChange={(e) => setSmsAlerts(e.target.checked)}
                  className="h-5 w-5 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition">
                <div>
                  <p className="text-sm font-bold text-slate-900">WhatsApp Appointment Confirmation</p>
                  <p className="text-xs text-slate-500">Deliver digital appointment voucher and Google Maps directions via verified WhatsApp Business API.</p>
                </div>
                <input
                  id="whatsapp-confirm-checkbox"
                  name="whatsappConfirmations"
                  aria-label="Enable WhatsApp Appointment Confirmations"
                  type="checkbox"
                  checked={whatsappConfirmations}
                  onChange={(e) => setWhatsappConfirmations(e.target.checked)}
                  className="h-5 w-5 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition">
                <div>
                  <p className="text-sm font-bold text-slate-900">Auto-Confirm Paid Holds</p>
                  <p className="text-xs text-slate-500">Automatically switch slot status from HELD to CONFIRMED immediately when deposit webhook verifies payment.</p>
                </div>
                <input
                  id="auto-confirm-holds-checkbox"
                  name="autoConfirmHolds"
                  aria-label="Auto-Confirm Paid Holds"
                  type="checkbox"
                  checked={autoConfirmHolds}
                  onChange={(e) => setAutoConfirmHolds(e.target.checked)}
                  className="h-5 w-5 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                />
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <label htmlFor="reminder-offset-select" className="block text-sm font-bold text-slate-900">
                  Customer Reminder Lead Time (Hours)
                </label>
                <select
                  id="reminder-offset-select"
                  name="reminderOffsetHours"
                  aria-label="Customer Reminder Lead Time"
                  value={reminderOffsetHours}
                  onChange={(e) => setReminderOffsetHours(e.target.value)}
                  className="w-full sm:w-64 px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                >
                  <option value="1">1 Hour Before Slot</option>
                  <option value="2">2 Hours Before Slot (Recommended)</option>
                  <option value="4">4 Hours Before Slot</option>
                  <option value="24">24 Hours Before Slot</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: POLICIES */}
        {activeTab === 'policies' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
              Cancellation, Reschedule & Deposit Forfeiture Terms
            </h2>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <label htmlFor="cancellation-window-select" className="block text-sm font-bold text-slate-900">
                  Full Refund Cancellation Window
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Deposits are 100% refundable if cancelled before this threshold. Inside this window, deposits forfeit to the merchant.
                </p>
                <select
                  id="cancellation-window-select"
                  name="cancellationWindowHours"
                  aria-label="Full Refund Cancellation Window"
                  value={cancellationWindowHours}
                  onChange={(e) => setCancellationWindowHours(e.target.value)}
                  className="w-full sm:w-64 px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                >
                  <option value="1">1 Hour Prior (Tirupati Standard Policy)</option>
                  <option value="2">2 Hours Prior</option>
                  <option value="4">4 Hours Prior</option>
                </select>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition">
                <div>
                  <p className="text-sm font-bold text-slate-900">Auto-Forfeit Deposit on Verified No-Show</p>
                  <p className="text-xs text-slate-500">When clinic manager marks patient as No-Show, lock deposit into merchant ledger and flag profile.</p>
                </div>
                <input
                  id="forfeit-no-show-checkbox"
                  name="forfeitOnNoShow"
                  aria-label="Auto-Forfeit Deposit on Verified No-Show"
                  type="checkbox"
                  checked={forfeitOnNoShow}
                  onChange={(e) => setForfeitOnNoShow(e.target.checked)}
                  className="h-5 w-5 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
