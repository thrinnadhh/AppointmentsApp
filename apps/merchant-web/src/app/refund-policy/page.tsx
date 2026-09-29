import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy | Appointments4u',
  description: 'Full refund and cancellation terms for Appointments4u bookings — Consumer Protection (E-Commerce) Rules 2020 compliant.',
};

export default function RefundPolicyPage() {
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
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">Refund & Cancellation Policy</h1>
              <p className="text-sm text-slate-500 mt-1">Last updated {lastUpdated} · Consumer Protection (E-Commerce) Rules 2020 compliant</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Summary Cards — Consumer Protection requirement: policy within 3 clicks */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Quick Summary</p>
        <div className="grid sm:grid-cols-3 gap-3 mb-10">
          <SummaryCard
            emoji="✅"
            title="Free Cancellation"
            desc="Cancel more than 1 hour before your slot for a full deposit refund."
            color="emerald"
          />
          <SummaryCard
            emoji="⚠️"
            title="Late Cancellation"
            desc="Inside the 1-hour window or no-show — deposit is forfeited to the merchant."
            color="amber"
          />
          <SummaryCard
            emoji="💰"
            title="Merchant Cancels"
            desc="Always get a full refund, no matter when the merchant cancels."
            color="slate"
          />
        </div>
      </div>

      {/* Detailed Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-10 space-y-10">

        <Section title="1. What the Deposit Covers">
          <p>When you book on Appointments4u, you pay a small <strong>booking deposit</strong> (₹50–₹200, set by each merchant). This deposit:</p>
          <ul className="mt-3 list-disc list-inside space-y-1.5 text-slate-700">
            <li>Confirms and holds your appointment slot</li>
            <li>Is <strong>not</strong> the full price of the service — you pay the remainder at the venue</li>
            <li>Is refundable based on the rules below</li>
          </ul>
          <p className="mt-3">Platform fees (₹10–₹50 per booking) are non-refundable except in the case of merchant-initiated cancellations.</p>
        </Section>

        <Section title="2. Customer Cancellation — Free Window">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-5">
            <p className="font-semibold text-emerald-900 text-sm mb-3">✅ Cancel more than 1 hour before your slot</p>
            <ul className="space-y-2">
              {[
                'Full deposit refund — no questions asked.',
                'Platform fee also refunded in full.',
                'Refund processed via Razorpay within 5–7 business days to your original payment method.',
                'You may also reschedule instead — your deposit carries over to the new slot with no re-payment.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-emerald-800">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="3. Customer Cancellation — Late or No-Show">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-5">
            <p className="font-semibold text-amber-900 text-sm mb-3">⚠️ Cancel inside the 1-hour window, or do not attend</p>
            <ul className="space-y-2">
              {[
                'Your booking deposit is forfeited and transferred to the merchant (minus the platform fee).',
                'This policy protects merchants against last-minute no-shows which directly impact their revenue.',
                '4 no-shows within a 12-month rolling window will result in a temporary booking restriction on your account.',
                'If you believe your no-show was due to an emergency, contact support@appointments4u.in within 48 hours — we review cases individually.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="4. Merchant-Initiated Cancellation or Reschedule">
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-5">
            <p className="font-semibold text-slate-900 text-sm mb-3">💰 Merchant cancels or reschedules — at any time</p>
            <ul className="space-y-2">
              {[
                'You always receive a full refund of both the deposit and the platform fee.',
                'This applies regardless of timing — even if the merchant cancels within the 1-hour window.',
                'Refund is processed automatically within 5–7 business days.',
                'If the refund does not appear after 7 business days, contact support@appointments4u.in.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="5. Refund Timeline">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="text-left px-3 py-2 rounded-tl-lg font-semibold">Scenario</th>
                <th className="text-left px-3 py-2 font-semibold">Refund Amount</th>
                <th className="text-left px-3 py-2 rounded-tr-lg font-semibold">Timeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ['Free cancellation (>1 hr)', 'Full deposit + platform fee', '5–7 business days'],
                ['Merchant cancels (any time)', 'Full deposit + platform fee', '5–7 business days'],
                ['Late cancellation / no-show', 'No refund (forfeited)', 'N/A'],
                ['Payment failed / not captured', 'Automatic void, no charge', 'Immediate'],
              ].map(([scenario, amount, timeline]) => (
                <tr key={scenario} className="bg-white odd:bg-slate-50/60">
                  <td className="px-3 py-2.5 text-slate-800">{scenario}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-700">{amount}</td>
                  <td className="px-3 py-2.5 text-slate-500">{timeline}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">Refund timelines depend on your bank and Razorpay processing. UPI refunds may appear faster (1–3 days). Credit/debit card refunds take longer.</p>
        </Section>

        <Section title="6. GST on Platform Fee">
          <p className="text-slate-700">
            The platform fee is currently charged exclusive of GST (GST registration pending). Once we obtain our GSTIN, all invoices will include an 18% GST component on the platform fee, which will be displayed explicitly at checkout before payment. Your booking receipt will include the GSTIN for your records.
          </p>
        </Section>

        <Section title="7. How to Raise a Refund Dispute">
          <ol className="list-decimal list-inside space-y-2 text-slate-700">
            <li>Email <a href="mailto:support@appointments4u.in" className="text-emerald-700 underline">support@appointments4u.in</a> with your booking reference number</li>
            <li>Include your reason and any supporting information</li>
            <li>We respond within 48 hours and aim to resolve within 15 working days</li>
          </ol>
          <p className="mt-3 text-slate-600 text-xs">If unresolved, you may approach the Consumer Forum under the Consumer Protection Act 2019 or the Online Dispute Resolution (ODR) platform at <a href="https://consumerhelpline.gov.in" target="_blank" rel="noreferrer" className="text-emerald-700 underline">consumerhelpline.gov.in</a>.</p>
        </Section>

        {/* Footer links */}
        <div className="border-t border-slate-200 pt-8 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/privacy" className="hover:text-emerald-700 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-emerald-700 transition-colors">Terms of Service</Link>
          <a href="mailto:support@appointments4u.in" className="hover:text-emerald-700 transition-colors">Contact Support</a>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ emoji, title, desc, color }: { emoji: string; title: string; desc: string; color: 'emerald' | 'amber' | 'slate' }) {
  const colorMap = {
    emerald: 'border-emerald-200 bg-emerald-50',
    amber:   'border-amber-200 bg-amber-50',
    slate:   'border-slate-200 bg-white',
  };
  return (
    <div className={`rounded-xl border px-4 py-4 ${colorMap[color]}`}>
      <div className="text-2xl mb-2">{emoji}</div>
      <p className="font-semibold text-sm text-slate-900 mb-1">{title}</p>
      <p className="text-xs text-slate-600 leading-relaxed">{desc}</p>
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
