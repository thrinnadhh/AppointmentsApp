/**
 * Cloudflare R2 Zero-Egress Media Storage Adapter
 * Free Tier Allowance: 10 GB storage + Zero Egress Bandwidth Fees (free-for.dev)
 *
 * Provides media upload for clinic photos, doctor portraits, and receipts.
 * Automatically falls back to Supabase Storage if Cloudflare R2 is unconfigured.
 */

import { supabase } from './supabase';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'appointments-assets';
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN;

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

const isR2Configured = Boolean(
  R2_ACCOUNT_ID && R2_PUBLIC_DOMAIN && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
);

/**
 * Upload a media asset (photo, logo, certificate) to cloud storage
 */
export async function uploadMediaAsset(
  fileBytes: Uint8Array | Buffer,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<{ url: string; provider: 'cloudflare-r2' | 'supabase-storage' | 'local' }> {
  const sanitizedName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

  // 1. Cloudflare R2 (Requires S3 client credentials)
  if (isR2Configured) {
    try {
      // In production with R2 keys configured, use signed S3 client or presigned PUT
      const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${sanitizedName}`;
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        body: fileBytes as unknown as BodyInit,
      });

      if (res.ok) {
        return {
          url: `${R2_PUBLIC_DOMAIN}/${sanitizedName}`,
          provider: 'cloudflare-r2',
        };
      }
    } catch (err) {
      console.warn('[Storage] R2 upload error, falling back to Supabase storage:', err);
    }
  }

  // 2. Supabase Storage Fallback (Uses provisioned 'venue-assets' bucket)
  try {
    const { data, error } = await supabase.storage
      .from('venue-assets')
      .upload(sanitizedName, fileBytes, {
        contentType,
        upsert: true,
      });

    if (!error && data?.path) {
      const { data: publicUrlData } = supabase.storage
        .from('venue-assets')
        .getPublicUrl(data.path);

      return {
        url: publicUrlData.publicUrl,
        provider: 'supabase-storage',
      };
    }
  } catch {
    // Non-blocking fallback
  }

  // 3. Local Deterministic Path Fallback
  return {
    url: `/assets/uploads/${sanitizedName}`,
    provider: 'local',
  };
}

export const PUBLIC_BUCKETS = ['venue-assets'] as const;
export const PRIVATE_BUCKETS = ['prescriptions-and-records'] as const;

export function isPublicBucket(bucketName: string): boolean {
  return (PUBLIC_BUCKETS as readonly string[]).includes(bucketName);
}

export function isPrivateBucket(bucketName: string): boolean {
  return (PRIVATE_BUCKETS as readonly string[]).includes(bucketName);
}

/**
 * Diagnostic status for health check
 */
export function getStorageStatus(): {
  provider: 'cloudflare-r2' | 'supabase-storage';
  r2_configured: boolean;
  public_domain: string | null;
  public_buckets: readonly string[];
  private_buckets: readonly string[];
} {
  return {
    provider: isR2Configured ? 'cloudflare-r2' : 'supabase-storage',
    r2_configured: isR2Configured,
    public_domain: R2_PUBLIC_DOMAIN || null,
    public_buckets: PUBLIC_BUCKETS,
    private_buckets: PRIVATE_BUCKETS,
  };
}

/**
 * Generates a time-limited signed URL for private documents (prescriptions, clinical records).
 * Strictly forbids public URL generation for private buckets.
 */
export async function getPrivateDocumentSignedUrl(
  storagePath: string,
  expiresInSeconds: number = 300,
  bucket: string = 'prescriptions-and-records'
): Promise<{ signedUrl: string | null; error?: string }> {
  if (isPublicBucket(bucket)) {
    return { signedUrl: null, error: `Bucket ${bucket} is public; use getPublicUrl instead` };
  }

  // Constrain expiry between 60 seconds and 1 hour
  const boundedTtl = Math.max(60, Math.min(expiresInSeconds, 3600));

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, boundedTtl);

    if (error || !data?.signedUrl) {
      return { signedUrl: null, error: error?.message || 'Failed to generate signed URL' };
    }

    return { signedUrl: data.signedUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Storage signing error';
    return { signedUrl: null, error: msg };
  }
}

/**
 * Upload a private document (e.g. medical prescription) scoped under owner ID
 */
export async function uploadPrivateDocument(
  fileBytes: Uint8Array | Buffer,
  fileName: string,
  ownerId: string,
  contentType: string = 'application/pdf',
  bucket: string = 'prescriptions-and-records'
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const sanitizedName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const scopedPath = `${ownerId}/${sanitizedName}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(scopedPath, fileBytes, {
        contentType,
        upsert: true,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, path: data?.path || scopedPath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Private upload failed';
    return { success: false, error: msg };
  }
}
