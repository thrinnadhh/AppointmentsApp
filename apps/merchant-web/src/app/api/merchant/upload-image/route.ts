import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { checkRateLimit } from '@/lib/redis';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Inspects file buffer magic bytes for JPEG, PNG, and WebP formats.
 */
function detectImageFormat(buffer: Buffer): { ext: string; mime: string } | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // 2. PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }

  // 3. WebP: RIFF (52 49 46 46) ... WEBP (57 45 42 50)
  const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
  const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  if (isRiff && isWebp) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user via Supabase session
    const caller = await verifyAuthenticatedUser(request);
    if (!caller) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required to upload files' },
        { status: 401 }
      );
    }

    // 2. Rate limit: max 15 uploads per merchant per minute
    const rateLimit = await checkRateLimit(`upload:${caller.id}`, 15, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many upload attempts. Please wait a minute.' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No image file provided in request.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Image file size exceeds the 5MB maximum limit.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Deep inspection of magic bytes (reject spoofed client mime types)
    const detectedFormat = detectImageFormat(buffer);
    if (!detectedFormat) {
      return NextResponse.json(
        { error: 'Invalid file format. Magic-byte verification failed for JPG, PNG, or WebP.' },
        { status: 400 }
      );
    }

    // 3. Scope storage path prefix to authenticated user's ID
    const merchantId = caller.id;
    const randomId = crypto.randomBytes(6).toString('hex');
    const timestamp = Date.now();
    const storagePath = `${merchantId}/${timestamp}-${randomId}.${detectedFormat.ext}`;

    const supabaseAdmin = getSupabaseAdmin();

    // 4. Upload with blind overwriting disabled (upsert: false)
    const { data, error: uploadError } = await supabaseAdmin.storage
      .from('venue-assets')
      .upload(storagePath, buffer, {
        contentType: detectedFormat.mime,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Upload Image Storage Error]:', uploadError);
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('venue-assets')
      .getPublicUrl(data?.path || storagePath);

    return NextResponse.json({
      success: true,
      publicUrl: urlData.publicUrl,
      path: data?.path || storagePath,
    });
  } catch (err: unknown) {
    console.error('[Upload Image Exception]:', err);
    const message = err instanceof Error ? err.message : 'Internal server error during upload';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

