import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Appointments4u',
  description: 'How Appointments4u collects, uses, and protects your personal data under the DPDPA 2023.',
};

export default function PrivacyPolicyPage() {
  const lastUpdated = '22 September 2026';
  const version = '1.0';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-emerald-700 font-medium mb-6 hover:text-emerald-900 transition-colors">
            ← Back to Dashboard
          </Link>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">Privacy Policy</h1>
              <p className="text-sm text-slate-500 mt-1">Version {version} · Last updated {lastUpdated}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">

        {/* DPDPA notice banner */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800 leading-relaxed">
          <strong>India Digital Personal Data Protection Act, 2023 (DPDPA):</strong> This policy is compliant with the DPDPA 2023 and describes how Appointments4u processes your personal data as a Data Fiduciary.
        </div>

        <Section title="1. Who We Are">
          <p>
            <strong>Appointments4u</strong> (also referred to as "the Platform", "we", "us", or "our") is a technology scheduling intermediary that operates a hyperlocal booking platform for service providers (clinics, salons, restaurants, gaming zones, and pet-care providers) in Tirupati, India.
          </p>
          <p className="mt-3">
            We are a <strong>Data Fiduciary</strong> under the DPDPA 2023. Our Grievance Officer can be reached at <a href="mailto:grievance@appointments4u.in" className="text-emerald-700 underline font-medium">grievance@appointments4u.in</a>. We respond within 48 hours.
          </p>
        </Section>

        <Section title="2. Data We Collect and Why">
          <p className="mb-4">We collect only what is necessary for the platform to function. For each purpose, we obtain your separate, affirmative consent before collecting data.</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="text-left px-3 py-2 rounded-tl-lg font-semibold">Data</th>
                <th className="text-left px-3 py-2 font-semibold">Purpose</th>
                <th className="text-left px-3 py-2 rounded-tr-lg font-semibold">Required?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-white">
                <td className="px-3 py-2.5 font-medium text-slate-800">Phone Number</td>
                <td className="px-3 py-2.5 text-slate-600">OTP-based authentication (Supabase Auth). We never use it for marketing without consent.</td>
                <td className="px-3 py-2.5"><span className="text-xs font-semibold text-white bg-slate-500 px-2 py-0.5 rounded-full">Required</span></td>
              </tr>
              <tr className="bg-slate-50/60">
                <td className="px-3 py-2.5 font-medium text-slate-800">Booking Details</td>
                <td className="px-3 py-2.5 text-slate-600">Provider name, slot time, resource, status — stored so you can manage your bookings.</td>
                <td className="px-3 py-2.5"><span className="text-xs font-semibold text-white bg-slate-500 px-2 py-0.5 rounded-full">Required</span></td>
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-2.5 font-medium text-slate-800">Approximate Location</td>
                <td className="px-3 py-2.5 text-slate-600">To show clinics, salons, and venues near you. You can search by city without enabling this.</td>
                <td className="px-3 py-2.5"><span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Optional</span></td>
              </tr>
              <tr className="bg-slate-50/60">
                <td className="px-3 py-2.5 font-medium text-slate-800">Clinical Appointment Data</td>
                <td className="px-3 py-2.5 text-slate-600">Clinic name and slot — not shared with third parties. Used only for your appointment management.</td>
                <td className="px-3 py-2.5"><span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Optional</span></td>
              </tr>
              <tr className="bg-white">
                <td className="px-3 py-2.5 font-medium text-slate-800">Marketing Preferences</td>
                <td className="px-3 py-2.5 text-slate-600">Offers and reminders from merchants you have visited. Off by default.</td>
                <td className="px-3 py-2.5"><span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Optional</span></td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="3. How Long We Keep Your Data">
          <ul className="list-disc list-inside space-y-2 text-slate-700">
            <li>Booking records: <strong>3 years</strong> (for merchant revenue audit and dispute resolution)</li>
            <li>Payment ledger: <strong>7 years</strong> (statutory requirement under Indian accounting rules)</li>
            <li>Auth logs: <strong>90 days</strong></li>
            <li>Marketing consent: Until you withdraw it or delete your account</li>
            <li>Account deletion: Data is anonymised after a <strong>30-day grace period</strong></li>
          </ul>
        </Section>

        <Section title="4. Who We Share Data With">
          <ul className="list-disc list-inside space-y-2 text-slate-700">
            <li><strong>Service Providers you book with</strong> — they see your booking details only</li>
            <li><strong>Razorpay / PayU</strong> — payment processor (their privacy policy applies to payment data)</li>
            <li><strong>MSG91 / Twilio</strong> — SMS gateway for OTPs and reminders</li>
            <li><strong>Supabase</strong> — cloud database and auth (SOC 2 Type II certified)</li>
          </ul>
          <p className="mt-3 text-slate-600">We do <strong>not</strong> sell your data to third parties. We do not use your data for advertising profiling.</p>
        </Section>

        <Section title="5. Your Rights Under DPDPA 2023">
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { right: 'Right to Access', desc: 'Request a copy of all data we hold about you.' },
              { right: 'Right to Correction', desc: 'Ask us to correct inaccurate personal data.' },
              { right: 'Right to Erasure', desc: 'Request account deletion via Settings → Account → Delete Account. 30-day grace period applies.' },
              { right: 'Right to Withdraw Consent', desc: 'Toggle optional consents off at any time in Settings → Privacy.' },
              { right: 'Right to Grievance Redressal', desc: 'Raise a concern with our Grievance Officer within 48 hours.' },
              { right: 'Right to Nominate', desc: 'Nominate another person to exercise these rights in case of death or incapacity.' },
            ].map(({ right, desc }) => (
              <div key={right} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="font-semibold text-slate-800 text-sm">{right}</p>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="6. Grievance Officer">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 leading-relaxed">
            <p><strong>Grievance Officer:</strong> Appointments4u Platform Team</p>
            <p className="mt-1"><strong>Email:</strong> <a href="mailto:grievance@appointments4u.in" className="underline">grievance@appointments4u.in</a></p>
            <p className="mt-1"><strong>Response time:</strong> Within 48 hours of receipt (DPDPA §13 compliance)</p>
            <p className="mt-2 text-amber-700 text-xs">If your grievance is not resolved within 30 days, you may approach the Data Protection Board of India.</p>
          </div>
        </Section>

        <Section title="7. Security">
          <p className="text-slate-700">All data is encrypted at rest and in transit (AES-256 / TLS 1.3). We use Row Level Security (RLS) so each user can only access their own data. Our cloud infrastructure (Supabase) is SOC 2 Type II certified.</p>
        </Section>

        <Section title="8. Changes to This Policy">
          <p className="text-slate-700">
            We will notify you via SMS or push notification at least 7 days before any material change to this policy. Continued use of the app after the effective date constitutes acceptance of the updated policy. The version number above is incremented on each change.
          </p>
        </Section>

        {/* Footer links */}
        <div className="border-t border-slate-200 pt-8 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/terms" className="hover:text-emerald-700 transition-colors">Terms of Service</Link>
          <Link href="/refund-policy" className="hover:text-emerald-700 transition-colors">Refund Policy</Link>
          <a href="mailto:grievance@appointments4u.in" className="hover:text-emerald-700 transition-colors">Contact Grievance Officer</a>
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
