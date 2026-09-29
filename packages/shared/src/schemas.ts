/**
 * Shared API & Domain Request/Response Schemas for Hyperlocal Booking Platform
 */

export interface CreateHoldRequest {
  resource_id: string;
  slot_start: string;
  slot_end: string;
  customer_id: string;
}

export interface CreateHoldResponse {
  success: boolean;
  booking_id?: string;
  deposit_amount?: number;
  hold_expires_at?: string;
  error?: string;
}

export interface ConfirmPaymentRequest {
  booking_id: string;
  gateway_payment_id?: string;
  deposit_amount?: number;
}

export interface ConfirmPaymentResponse {
  success: boolean;
  booking_id?: string;
  status?: string;
  payment_status?: string;
  error?: string;
}

export interface CancelBookingRequest {
  booking_id: string;
  reason?: string;
  initiated_by: 'CUSTOMER' | 'MERCHANT';
}

export interface CancelBookingResponse {
  success: boolean;
  booking_id?: string;
  status?: string;
  payment_status?: string;
  refund_eligible?: boolean;
  refund_amount?: number;
  refund_gateway_paise?: number;
  merchant_strikes?: number;
  penalty_applied?: boolean;
  penalty_amount?: number;
  is_booking_frozen?: boolean;
  error?: string;
}

export interface ReassignResourceRequest {
  booking_id: string;
  new_resource_id: string;
  reason?: string;
}

export interface ReassignResourceResponse {
  success: boolean;
  booking_id?: string;
  old_resource_id?: string;
  old_resource_name?: string;
  new_resource_id?: string;
  new_resource_name?: string;
  slot_start?: string;
  slot_end?: string;
  status?: string;
  error?: string;
}

export interface RescheduleBookingRequest {
  booking_id: string;
  new_slot_start: string;
  new_slot_end: string;
}

export interface RescheduleBookingResponse {
  success: boolean;
  booking_id?: string;
  slot_start?: string;
  slot_end?: string;
  status?: string;
  error?: string;
}

export interface RecordNoShowRequest {
  booking_id: string;
  merchant_notes?: string;
}

export interface RecordNoShowResponse {
  success: boolean;
  booking_id?: string;
  no_show_count?: number;
  penalty_applied?: boolean;
  payment_status?: 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'FORFEITED';
  refund_amount?: number;
  is_flagged?: boolean;
  error?: string;
}

export interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: {
      entity?: {
        id: string;
        amount: number;
        currency: string;
        status: string;
        notes?: {
          booking_id?: string;
          customer_id?: string;
        };
      };
    };
  };
}

/**
 * 60-Minute Cancellation Cutoff Policy Helper
 * - Merchant-initiated cancellation: ALWAYS 100% full refund (Customer protected: deposit + fees)
 * - Customer-initiated cancellation: 100% full refund IF requested > 60 minutes before slot_start
 * - Customer-initiated cancellation: Deposit FORFEITED IF requested <= 60 minutes before slot_start
 */
export function isEligibleForFullRefund(
  slotStartIso: string,
  initiatedBy: 'CUSTOMER' | 'MERCHANT'
): { eligible: boolean; minutesUntilSlot: number; rule: string } {
  if (initiatedBy === 'MERCHANT') {
    return {
      eligible: true,
      minutesUntilSlot: 0,
      rule: 'Merchant-initiated cancellations are always refunded in full.',
    };
  }

  const slotTime = new Date(slotStartIso).getTime();
  const now = Date.now();
  const diffMinutes = Math.round((slotTime - now) / (1000 * 60));

  if (diffMinutes > 60) {
    return {
      eligible: true,
      minutesUntilSlot: diffMinutes,
      rule: `Cancelled with ${diffMinutes}m remaining (> 60m required for full refund).`,
    };
  }

  return {
    eligible: false,
    minutesUntilSlot: diffMinutes,
    rule: `Late cancellation (${diffMinutes}m before slot). Deposits are forfeited within 60 minutes of slot start.`,
  };
}
