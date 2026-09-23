import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | Appointments4u',
  description: 'Terms and conditions for using the Appointments4u booking platform.',
};

export default function TermsOfServicePage() {
  const lastUpdated = '22 September 2026';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-emerald-700 font-medium mb-6 hover:text-emerald-900 transition-colors">
            ← Back to Dashboard
          </Link>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">Terms of Service</h1>
              <p className="text-sm text-slate-500 mt-1">Last updated {lastUpdated}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">

        {/* IT Act §79 Safe Harbour Notice */}
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-700 leading-relaxed">
          <strong className="text-slate-900">Intermediary Disclaimer (IT Act 2000, Section 79):</strong> Appointments4u is a technology intermediary platform. We do not own, operate, or provide any of the services listed on this platform. We are not a party to the transaction between you and the service provider. Actual service quality and delivery is solely the responsibility of the merchant.
        </div>

        <Section title="1. Acceptance of Terms">
          <p>By creating an account, making a booking, or registering as a merchant on Appointments4u, you agree to these Terms of Service. If you do not agree, you must not use the platform.</p>
          <p className="mt-3">These terms are governed by the laws of India, including the Information Technology Act 2000, the Consumer Protection Act 2019, and the Digital Personal Data Protection Act 2023.</p>
        </Section>

        <Section title="2. The Platform">
          <p>Appointments4u provides a technology platform that enables:</p>
          <ul className="mt-3 list-disc list-inside space-y-1.5 text-slate-700">
            <li>Customers to discover and book appointment slots with local service providers</li>
            <li>Merchants to list their business, manage bookable resources, and handle appointments</li>
            <li>Secure deposit collection and automated refund processing via Razorpay/PayU</li>
          </ul>
          <p className="mt-3">We operate exclusively in Tirupati, Andhra Pradesh, India at the time of these terms.</p>
        </Section>

        <Section title="3. Booking Deposits">
          <p>Bookings on Appointments4u require a small <strong>refundable deposit</strong> (₹50–₹200, set individually by each merchant) to confirm a slot. This deposit is:</p>
          <ul className="mt-3 list-disc list-inside space-y-1.5 text-slate-700">
            <li><strong>Not</strong> the full price of the service — the remainder is paid at the venue</li>
            <li>Captured via Razorpay at the time of booking confirmation</li>
            <li>Refundable under the conditions described in our <Link href="/refund-policy" className="text-emerald-700 underline font-medium">Refund Policy</Link></li>
          </ul>
        </Section>

        <Section title="4. Cancellation and No-Show Policy">
          <div className="space-y-4">
            <PolicyCard
              title="Free Cancellation Window"
              color="emerald"
              items={[
                'Customer or merchant may cancel or reschedule for free up to 1 hour before the slot start time.',
                'On free cancellation: full deposit refund to the customer (processed within 5–7 business days).',
                'On free reschedule: deposit carries over to the new slot — no re-payment required.',
              ]}
            />
            <PolicyCard
              title="Late Cancellation or No-Show (Customer)"
              color="amber"
              items={[
                'Cancelling inside the 1-hour window, or failing to attend without cancelling, is treated as a no-show.',
                'The booking deposit is forfeited to the merchant (minus platform fee).',
                'After 4 no-shows within a 12-month rolling window, your account may be temporarily restricted.',
              ]}
            />
            <PolicyCard
              title="Business-Initiated Changes (Always Customer-Friendly)"
              color="slate"
              items={[
                'If a merchant cancels or reschedules your booking at any time — including inside the 1-hour window — you are always refunded in full.',
                'The customer is never penalised for a merchant-initiated change.',
              ]}
            />
          </div>
        </Section>

        <Section title="5. Merchant Obligations">
          <p>By registering as a merchant partner, you agree to:</p>
          <ul className="mt-3 list-disc list-inside space-y-1.5 text-slate-700">
            <li>Provide accurate business information and keep it current</li>
            <li>Honour confirmed bookings except in genuine emergencies</li>
            <li>Treat all customers equally regardless of background</li>
            <li>Comply with all applicable local, state, and central government regulations for your category (PCPNDT for clinics, FSSAI for restaurants, etc.)</li>
            <li>Not use the platform to collect payments outside the Appointments4u system</li>
          </ul>
          <p className="mt-3 text-slate-600">Merchants who receive excessive customer complaints, repeated no-shows, or engage in fraudulent activity may be suspended or permanently removed from the platform.</p>
        </Section>

        <Section title="6. Medical Disclaimer">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 leading-relaxed">
            <strong>Appointments4u is a scheduling platform, not a healthcare provider.</strong> We do not verify the credentials, qualifications, or outcomes of any clinic, doctor, or healthcare professional listed on the platform. In a medical emergency, call <strong>108 (Ambulance)</strong> immediately. Do not rely on appointment slots in emergencies. Appointment times are approximate and subject to the clinic's operational schedule.
          </div>
        </Section>

        <Section title="7. Platform Fee">
          <p>Appointments4u charges a small platform convenience fee per booking (₹10–₹50 depending on category) to sustain operations. This fee is:</p>
          <ul className="mt-3 list-disc list-inside space-y-1.5 text-slate-700">
            <li>Disclosed at checkout before payment</li>
            <li>Non-refundable (unless the booking is cancelled by the merchant)</li>
            <li>Subject to GST at the applicable rate once the platform is GST-registered</li>
          </ul>
        </Section>

        <Section title="8. Limitation of Liability">
          <p className="text-slate-700">To the maximum extent permitted by law, Appointments4u&apos;s total liability for any claim arising from use of the platform is limited to the amount of the booking deposit paid for the specific booking giving rise to the claim. We are not liable for the quality, safety, or outcome of any service delivered by a merchant.</p>
        </Section>

        <Section title="9. Contact and Disputes">
          <p className="text-slate-700">
            For disputes, write to <a href="mailto:support@appointments4u.in" className="text-emerald-700 underline">support@appointments4u.in</a>. We aim to resolve all disputes within 15 working days. These Terms are governed by the courts of Tirupati / Chittoor district, Andhra Pradesh, India.
          </p>
        </Section>

        {/* Footer links */}
        <div className="border-t border-slate-200 pt-8 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/privacy" className="hover:text-emerald-700 transition-colors">Privacy Policy</Link>
          <Link href="/refund-policy" className="hover:text-emerald-700 transition-colors">Refund Policy</Link>
          <a href="mailto:support@appointments4u.in" className="hover:text-emerald-700 transition-colors">Contact Support</a>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900 mb-3 pb-2 border-b border-slate-200">{title}</h2>
      <div className="text-sm text-slate-700 leading-relaxed">{children}</div>
    </section>
  );
}

function PolicyCard({
  title,
  color,
  items,
}: {
  title: string;
  color: 'emerald' | 'amber' | 'slate';
  items: string[];
}) {
  const colorMap = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber:   'border-amber-200 bg-amber-50 text-amber-900',
    slate:   'border-slate-200 bg-slate-50 text-slate-900',
  };
  const dotMap = {
    emerald: 'bg-emerald-500',
    amber:   'bg-amber-500',
    slate:   'bg-slate-400',
  };
  return (
    <div className={`rounded-xl border px-5 py-4 ${colorMap[color]}`}>
      <p className="font-semibold text-sm mb-2">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotMap[color]}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
