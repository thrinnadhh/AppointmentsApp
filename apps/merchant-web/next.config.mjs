import './src/env.mjs';
import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['@appointments/shared'],
  env: {
    ALLOW_MOCK_AUTH: process.env.ALLOW_MOCK_AUTH || (process.env.NODE_ENV !== 'production' ? 'true' : 'false'),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Content-Security-Policy',
            value: (() => {
              const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
              const supabaseWs = supabaseUrl ? supabaseUrl.replace(/^http/, 'ws') : '';
              const scopedSupabase = supabaseUrl ? `${supabaseUrl} ${supabaseWs}` : 'https://*.supabase.co wss://*.supabase.co';

              return process.env.NODE_ENV === 'production'
                ? `default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://sdk.cashfree.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://api.cashfree.com https://sandbox.cashfree.com ${scopedSupabase} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io; frame-src 'self' https://api.razorpay.com https://sdk.cashfree.com https://sandbox.cashfree.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';`
                : `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://checkout.razorpay.com https://sdk.cashfree.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' http://127.0.0.1:54321 http://localhost:54321 ws://127.0.0.1:54321 ws://localhost:54321 https://api.cashfree.com https://sandbox.cashfree.com ${scopedSupabase} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io; frame-src 'self' https://api.razorpay.com https://sdk.cashfree.com https://sandbox.cashfree.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';`;
            })(),
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://checkout.razorpay.com https://sdk.cashfree.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://api.cashfree.com https://sandbox.cashfree.com; frame-src 'self' https://api.razorpay.com https://sdk.cashfree.com https://sandbox.cashfree.com; report-uri /api/csp-report;`,
          },
          {
            key: 'Cross-Origin-Opener-Policy-Report-Only',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  disableLogger: true,
});

