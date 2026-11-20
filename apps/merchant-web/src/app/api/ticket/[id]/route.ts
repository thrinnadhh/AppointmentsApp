import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking } from "@/lib/auth-admin";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id || typeof id !== "string" || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: "Invalid booking ID parameter" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch booking
    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select("id, reference_code, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, platform_fee_amount, consultation_fee_amount, platform_payment_status, consultation_payment_status, consultation_collected_at, is_present, queue_position, checked_in_at, checked_in_method, customer_id, provider_id, resource_id, booked_for, patient_name, patient_age, patient_relationship, is_minor, booking_note")
      .eq("id", id)
      .maybeSingle();

    if (bErr || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // 2. Determine authorization level
    const caller = await verifyAuthenticatedUser(req);
    const searchParams = req.nextUrl?.searchParams;
    const phoneLast4 = searchParams?.get("phone_last4") || null;

    const isBookingOwner = Boolean(caller && caller.id === booking.customer_id);
    const isStaffAuthorized = caller ? await isCallerAuthorizedForBooking(caller.id, booking, false) : false;
    const isFullyAuthorized = isBookingOwner || isStaffAuthorized;

    let isPhoneVerified = false;

    if (!isFullyAuthorized && phoneLast4 && typeof phoneLast4 === "string") {
      const { data: custProfile } = await supabaseAdmin
        .from("profiles")
        .select("phone")
        .eq("id", booking.customer_id)
        .maybeSingle();

      const rawPhone = custProfile?.phone || "";
      const digitsOnly = rawPhone.replace(/\D/g, "");
      const expectedLast4 = digitsOnly.slice(-4);

      if (expectedLast4 && phoneLast4.trim() === expectedLast4) {
        isPhoneVerified = true;
      } else {
        return NextResponse.json(
          { error: "Invalid phone verification digits", requires_verification: true },
          { status: 403 }
        );
      }
    }

    if (!isFullyAuthorized && !isPhoneVerified) {
      const { data: publicResource } = await supabaseAdmin
        .from("resources")
        .select("id, duration_minutes")
        .eq("id", booking.resource_id)
        .maybeSingle();

      return NextResponse.json({
        success: true,
        booking: {
          id: booking.id,
          resource_id: booking.resource_id,
          slot_start: booking.slot_start,
          slot_end: booking.slot_end,
          status: booking.status,
          is_present: booking.is_present,
          queue_position: booking.queue_position ?? null,
          reference_code: null,
          payment_status: null,
          deposit_amount: null,
          checked_in_at: null,
          checked_in_method: null,
        },
        customer: null,
        hospital: null,
        doctor: {
          id: publicResource?.id || booking.resource_id,
          duration_minutes: publicResource?.duration_minutes || 2,
        },
        checkin_code: null,
      });
    }

    // 3. Fetch customer profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email, phone, permanent_checkin_pin")
      .eq("id", booking.customer_id)
      .maybeSingle();

    // 4. Fetch provider
    const { data: provider } = await supabaseAdmin
      .from("providers")
      .select("name, address, phone")
      .eq("id", booking.provider_id)
      .maybeSingle();

    // 5. Fetch resource / doctor
    const { data: resource } = await supabaseAdmin
      .from("resources")
      .select("id, name, department, duration_minutes, price")
      .eq("id", booking.resource_id)
      .maybeSingle();

    // 6. Check-in code visibility gating (SPEC line 16)
    // Shown to customer from 60 minutes before slot start until check-in.
    // ONLY authenticated booking owner or authorized hospital staff can receive check-in PIN.
    // Unauthenticated phone_last4 caller must NEVER receive check-in PIN.
    const slotStartMs = new Date(booking.slot_start).getTime();
    const nowMs = Date.now();
    const isWindowOpen = nowMs >= slotStartMs - 60 * 60 * 1000;
    const windowOpensAt = new Date(slotStartMs - 60 * 60 * 1000).toISOString();
    const isCheckedIn = booking.status === "CHECKED_IN" || booking.is_present;

    let displayCode: string | null = null;
    if (isFullyAuthorized && (isWindowOpen || isCheckedIn)) {
      const { data: checkinCodeRecord } = await supabaseAdmin
        .from("appointment_checkin_codes")
        .select("code, appointment_date")
        .eq("booking_id", booking.id)
        .maybeSingle();

      displayCode = checkinCodeRecord?.code || profile?.permanent_checkin_pin || null;
    }

    // Redact sensitive PII when accessed unauthenticated with phone_last4:
    let customerPhone = profile?.phone || null;
    let customerEmail = profile?.email || null;
    let bookingNote = booking.booking_note || null;

    if (!isFullyAuthorized) {
      // Strip clinical notes / complaints
      bookingNote = null;

      // Mask phone (e.g. '******' + last4)
      if (customerPhone) {
        const digits = customerPhone.replace(/\D/g, "");
        const last4 = digits.slice(-4);
        customerPhone = `******${last4}`;
      }

      // Mask email
      if (customerEmail) {
        const parts = customerEmail.split('@');
        if (parts.length === 2) {
          const namePart = parts[0];
          const maskedName = namePart.length > 1 ? `${namePart[0]}***` : '***';
          customerEmail = `${maskedName}@${parts[1]}`;
        } else {
          customerEmail = null;
        }
      }
    }

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        reference_code: booking.reference_code,
        slot_start: booking.slot_start,
        slot_end: booking.slot_end,
        status: booking.status,
        payment_status: booking.payment_status,
        deposit_amount: booking.deposit_amount,
        platform_fee_amount: booking.platform_fee_amount,
        consultation_fee_amount: booking.consultation_fee_amount,
        platform_payment_status: booking.platform_payment_status,
        consultation_payment_status: booking.consultation_payment_status,
        consultation_collected_at: booking.consultation_collected_at,
        is_present: booking.is_present,
        queue_position: booking.queue_position ?? null,
        checked_in_at: booking.checked_in_at,
        checked_in_method: booking.checked_in_method,
        booked_for: booking.booked_for || 'self',
        patient_name: booking.patient_name || null,
        patient_age: booking.patient_age ?? null,
        patient_relationship: booking.patient_relationship || null,
        is_minor: Boolean(booking.is_minor),
        booking_note: bookingNote,
      },
      customer: {
        id: booking.customer_id,
        name: profile?.full_name || "Patient",
        full_name: profile?.full_name || "Patient",
        email: customerEmail,
        phone: customerPhone,
      },
      hospital: {
        id: booking.provider_id,
        name: provider?.name || "Tirupati Hospital",
        address: provider?.address || "Tirupati, AP",
        phone: provider?.phone || "+91-877-2200000",
      },
      doctor: {
        id: resource?.id || booking.resource_id,
        name: resource?.name || "Specialist Consultant",
        department: resource?.department || "General Medicine",
        duration_minutes: resource?.duration_minutes || 2,
        price: resource?.price || 500,
      },
      is_window_open: isWindowOpen,
      window_opens_at: windowOpensAt,
      checkin_code: displayCode,
    });
  } catch (error) {
    console.error("Error fetching ticket data:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
