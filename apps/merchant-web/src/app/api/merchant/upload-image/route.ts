import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const providerId = (formData.get('providerId') as string) || 'onboarding';

    if (!file) {
      return NextResponse.json(
        { error: 'No image file provided in request.' },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file format. Please upload a JPG, PNG, or WebP image.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Image file size exceeds the 5MB maximum limit.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${providerId}/${Date.now()}-${sanitizedFileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, error: uploadError } = await supabaseAdmin.storage
      .from('venue-assets')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
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
