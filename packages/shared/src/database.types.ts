export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          id: string
          last_error: string | null
          reason: string | null
          requested_at: string
          retry_count: number | null
          scheduled_for: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          last_error?: string | null
          reason?: string | null
          requested_at?: string
          retry_count?: number | null
          scheduled_for?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          last_error?: string | null
          reason?: string | null
          requested_at?: string
          retry_count?: number | null
          scheduled_for?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_logs: {
        Row: {
          app_version: string | null
          appointment_id: string | null
          category: string | null
          city_id: string | null
          component: string | null
          created_at: string
          device_info: Json | null
          device_model: string | null
          environment: string | null
          error_code: string | null
          fingerprint: string | null
          id: string
          level: string
          message: string
          metadata: Json | null
          platform: string
          platform_os: string | null
          role: string | null
          session_id: string | null
          severity: string | null
          source: string | null
          stack_trace: string | null
          user_id: string | null
          vertical: string | null
        }
        Insert: {
          app_version?: string | null
          appointment_id?: string | null
          category?: string | null
          city_id?: string | null
          component?: string | null
          created_at?: string
          device_info?: Json | null
          device_model?: string | null
          environment?: string | null
          error_code?: string | null
          fingerprint?: string | null
          id?: string
          level: string
          message: string
          metadata?: Json | null
          platform: string
          platform_os?: string | null
          role?: string | null
          session_id?: string | null
          severity?: string | null
          source?: string | null
          stack_trace?: string | null
          user_id?: string | null
          vertical?: string | null
        }
        Update: {
          app_version?: string | null
          appointment_id?: string | null
          category?: string | null
          city_id?: string | null
          component?: string | null
          created_at?: string
          device_info?: Json | null
          device_model?: string | null
          environment?: string | null
          error_code?: string | null
          fingerprint?: string | null
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
          platform?: string
          platform_os?: string | null
          role?: string | null
          session_id?: string | null
          severity?: string | null
          source?: string | null
          stack_trace?: string | null
          user_id?: string | null
          vertical?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_checkin_codes: {
        Row: {
          appointment_date: string
          booking_id: string
          code: string
          created_at: string
          customer_id: string
          id: string
          provider_id: string
        }
        Insert: {
          appointment_date: string
          booking_id: string
          code: string
          created_at?: string
          customer_id: string
          id?: string
          provider_id: string
        }
        Update: {
          appointment_date?: string
          booking_id?: string
          code?: string
          created_at?: string
          customer_id?: string
          id?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_checkin_codes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_checkin_codes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_checkin_codes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          booking_id: string | null
          created_at: string
          id: string
          merchant_id: string
          metadata: Json
          role: string | null
          target: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          booking_id?: string | null
          created_at?: string
          id?: string
          merchant_id: string
          metadata?: Json
          role?: string | null
          target: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          booking_id?: string | null
          created_at?: string
          id?: string
          merchant_id?: string
          metadata?: Json
          role?: string | null
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          attachment_url: string | null
          booked_for: string
          booking_for_someone_else: boolean
          booking_note: string | null
          cf_refund_id: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          checked_in_method: string | null
          consultation_collected_at: string | null
          consultation_collected_by: string | null
          consultation_fee_amount: number | null
          consultation_payment_status: string | null
          created_at: string
          customer_arrived_at: string | null
          customer_id: string
          department_id: string | null
          deposit_amount: number
          disclaimer_version: string | null
          emergency_cancelled: boolean
          emergency_doctor_arrived: boolean
          emergency_patient_choice: string | null
          estimated_wait_minutes: number | null
          expected_payment_amount_paise: number | null
          followup_original_booking_id: string | null
          gateway_order_id: string | null
          gateway_payment_id: string | null
          gateway_provider: string
          gstin_platform: string | null
          hold_expires_at: string | null
          id: string
          invoice_generated_at: string | null
          invoice_number: string | null
          is_followup: boolean
          is_minor: boolean | null
          is_present: boolean
          manual_checkin_reason: string | null
          merchant_share_amount: number
          patient_age: number | null
          patient_name: string | null
          patient_phone: string | null
          patient_relationship: string | null
          payment_session_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          platform_fee: number | null
          platform_fee_amount: number | null
          platform_fee_gst: number
          platform_payment_status: string | null
          provider_id: string
          queue_position: number | null
          reference_code: string | null
          reminder_1h_sent_at: string | null
          reminder_30m_sent_at: string | null
          resource_id: string
          skipped_at: string | null
          slot_end: string
          slot_start: string
          split_status: string
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number | null
          total_charged: number | null
          updated_at: string
          version: number
        }
        Insert: {
          attachment_url?: string | null
          booked_for?: string
          booking_for_someone_else?: boolean
          booking_note?: string | null
          cf_refund_id?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_in_method?: string | null
          consultation_collected_at?: string | null
          consultation_collected_by?: string | null
          consultation_fee_amount?: number | null
          consultation_payment_status?: string | null
          created_at?: string
          customer_arrived_at?: string | null
          customer_id: string
          department_id?: string | null
          deposit_amount: number
          disclaimer_version?: string | null
          emergency_cancelled?: boolean
          emergency_doctor_arrived?: boolean
          emergency_patient_choice?: string | null
          estimated_wait_minutes?: number | null
          expected_payment_amount_paise?: number | null
          followup_original_booking_id?: string | null
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gateway_provider?: string
          gstin_platform?: string | null
          hold_expires_at?: string | null
          id?: string
          invoice_generated_at?: string | null
          invoice_number?: string | null
          is_followup?: boolean
          is_minor?: boolean | null
          is_present?: boolean
          manual_checkin_reason?: string | null
          merchant_share_amount?: number
          patient_age?: number | null
          patient_name?: string | null
          patient_phone?: string | null
          patient_relationship?: string | null
          payment_session_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          platform_fee?: number | null
          platform_fee_amount?: number | null
          platform_fee_gst?: number
          platform_payment_status?: string | null
          provider_id: string
          queue_position?: number | null
          reference_code?: string | null
          reminder_1h_sent_at?: string | null
          reminder_30m_sent_at?: string | null
          resource_id: string
          skipped_at?: string | null
          slot_end: string
          slot_start: string
          split_status?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number | null
          total_charged?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          attachment_url?: string | null
          booked_for?: string
          booking_for_someone_else?: boolean
          booking_note?: string | null
          cf_refund_id?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_in_method?: string | null
          consultation_collected_at?: string | null
          consultation_collected_by?: string | null
          consultation_fee_amount?: number | null
          consultation_payment_status?: string | null
          created_at?: string
          customer_arrived_at?: string | null
          customer_id?: string
          department_id?: string | null
          deposit_amount?: number
          disclaimer_version?: string | null
          emergency_cancelled?: boolean
          emergency_doctor_arrived?: boolean
          emergency_patient_choice?: string | null
          estimated_wait_minutes?: number | null
          expected_payment_amount_paise?: number | null
          followup_original_booking_id?: string | null
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gateway_provider?: string
          gstin_platform?: string | null
          hold_expires_at?: string | null
          id?: string
          invoice_generated_at?: string | null
          invoice_number?: string | null
          is_followup?: boolean
          is_minor?: boolean | null
          is_present?: boolean
          manual_checkin_reason?: string | null
          merchant_share_amount?: number
          patient_age?: number | null
          patient_name?: string | null
          patient_phone?: string | null
          patient_relationship?: string | null
          payment_session_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          platform_fee?: number | null
          platform_fee_amount?: number | null
          platform_fee_gst?: number
          platform_payment_status?: string | null
          provider_id?: string
          queue_position?: number | null
          reference_code?: string | null
          reminder_1h_sent_at?: string | null
          reminder_30m_sent_at?: string | null
          resource_id?: string
          skipped_at?: string | null
          slot_end?: string
          slot_start?: string
          split_status?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number | null
          total_charged?: number | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_followup_original_booking_id_fkey"
            columns: ["followup_original_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_followup_original_booking_id_fkey"
            columns: ["followup_original_booking_id"]
            isOneToOne: false
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          display_order: number
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          display_order?: number
          icon?: string | null
          id: string
          name: string
        }
        Update: {
          display_order?: number
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      cities: {
        Row: {
          created_at: string
          id: string
          latitude: number
          launch_date: string | null
          longitude: number
          merchant_target: number
          name: string
          radius_km: number
          state: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          latitude: number
          launch_date?: string | null
          longitude: number
          merchant_target?: number
          name: string
          radius_km?: number
          state?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          latitude?: number
          launch_date?: string | null
          longitude?: number
          merchant_target?: number
          name?: string
          radius_km?: number
          state?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      city_settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          city_id: string
          created_at: string
          director_share: number | null
          founders_share: number | null
          gateway_fees: number
          gross_revenue: number
          id: string
          net_revenue: number | null
          notes: string | null
          paid_at: string | null
          payment_ref: string | null
          period_end: string
          period_start: string
          platform_alloc: number
          refunds: number
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          city_id: string
          created_at?: string
          director_share?: number | null
          founders_share?: number | null
          gateway_fees?: number
          gross_revenue?: number
          id?: string
          net_revenue?: number | null
          notes?: string | null
          paid_at?: string | null
          payment_ref?: string | null
          period_end: string
          period_start: string
          platform_alloc?: number
          refunds?: number
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          city_id?: string
          created_at?: string
          director_share?: number | null
          founders_share?: number | null
          gateway_fees?: number
          gross_revenue?: number
          id?: string
          net_revenue?: number | null
          notes?: string | null
          paid_at?: string | null
          payment_ref?: string | null
          period_end?: string
          period_start?: string
          platform_alloc?: number
          refunds?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_settlements_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      city_waitlist: {
        Row: {
          city_name: string
          consent_given: boolean
          consent_timestamp: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          phone: string | null
          purge_after: string | null
          vertical_interest: string | null
        }
        Insert: {
          city_name: string
          consent_given?: boolean
          consent_timestamp?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          purge_after?: string | null
          vertical_interest?: string | null
        }
        Update: {
          city_name?: string
          consent_given?: boolean
          consent_timestamp?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          purge_after?: string | null
          vertical_interest?: string | null
        }
        Relationships: []
      }
      contact_reveal_audit: {
        Row: {
          booking_id: string | null
          id: string
          reason: string | null
          revealed_at: string
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          id?: string
          reason?: string | null
          revealed_at?: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          id?: string
          reason?: string | null
          revealed_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_reveal_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_reveal_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      crash_alert_dedup: {
        Row: {
          fingerprint: string
          first_seen_at: string
          last_alerted_at: string
          last_message: string | null
          metadata: Json | null
          occurrence_count: number
          severity: string
        }
        Insert: {
          fingerprint: string
          first_seen_at?: string
          last_alerted_at?: string
          last_message?: string | null
          metadata?: Json | null
          occurrence_count?: number
          severity: string
        }
        Update: {
          fingerprint?: string
          first_seen_at?: string
          last_alerted_at?: string
          last_message?: string | null
          metadata?: Json | null
          occurrence_count?: number
          severity?: string
        }
        Relationships: []
      }
      department_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          department_id: string
          email: string
          id: string
          invite_expires_at: string
          invited_at: string
          invited_by: string | null
          merchant_id: string
          role: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          department_id: string
          email: string
          id?: string
          invite_expires_at?: string
          invited_at?: string
          invited_by?: string | null
          merchant_id: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          department_id?: string
          email?: string
          id?: string
          invite_expires_at?: string
          invited_at?: string
          invited_by?: string | null
          merchant_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_members_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          allowed_modules: string[]
          created_at: string
          id: string
          is_active: boolean
          is_preset: boolean
          merchant_id: string
          name: string
          updated_at: string
        }
        Insert: {
          allowed_modules?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_preset?: boolean
          merchant_id: string
          name: string
          updated_at?: string
        }
        Update: {
          allowed_modules?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_preset?: boolean
          merchant_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_front_desk_assignments: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          id_card_number: string | null
          provider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          id_card_number?: string | null
          provider_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          id_card_number?: string | null
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_front_desk_assignments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_front_desk_assignments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_front_desk_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_memberships: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_memberships_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_vendor_splits: {
        Row: {
          booking_id: string
          cashfree_vendor_id: string
          cf_order_id: string
          cf_transfer_id: string | null
          created_at: string
          gross_amount: number
          id: string
          merchant_share: number
          metadata: Json | null
          platform_fee: number
          provider_id: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          cashfree_vendor_id: string
          cf_order_id: string
          cf_transfer_id?: string | null
          created_at?: string
          gross_amount: number
          id?: string
          merchant_share: number
          metadata?: Json | null
          platform_fee: number
          provider_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          cashfree_vendor_id?: string
          cf_order_id?: string
          cf_transfer_id?: string | null
          created_at?: string
          gross_amount?: number
          id?: string
          merchant_share?: number
          metadata?: Json | null
          platform_fee?: number
          provider_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_vendor_splits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_vendor_splits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_vendor_splits_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          attempts: number | null
          booking_id: string | null
          channel: string
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          last_error: string | null
          message_content: string
          next_attempt_at: string | null
          provider_message_id: string | null
          provider_response: Json | null
          read_at: string | null
          recipient_name: string | null
          recipient_phone: string | null
          sent_at: string
          status: string
          template_name: string | null
          template_params: Json | null
        }
        Insert: {
          attempts?: number | null
          booking_id?: string | null
          channel: string
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          message_content: string
          next_attempt_at?: string | null
          provider_message_id?: string | null
          provider_response?: Json | null
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          sent_at?: string
          status?: string
          template_name?: string | null
          template_params?: Json | null
        }
        Update: {
          attempts?: number | null
          booking_id?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          message_content?: string
          next_attempt_at?: string | null
          provider_message_id?: string | null
          provider_response?: Json | null
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          sent_at?: string
          status?: string
          template_name?: string | null
          template_params?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          gateway_payment_id: string | null
          id: string
          metadata: Json | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          gateway_payment_id?: string | null
          id?: string
          metadata?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          gateway_payment_id?: string | null
          id?: string
          metadata?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_config: {
        Row: {
          key: string
          note: string | null
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          note?: string | null
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          note?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_city_id: string | null
          blocked_until: string | null
          created_at: string
          default_provider_id: string | null
          email: string | null
          expo_push_token: string | null
          full_name: string | null
          id: string
          is_flagged: boolean
          no_show_count: number
          permanent_checkin_pin: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          assigned_city_id?: string | null
          blocked_until?: string | null
          created_at?: string
          default_provider_id?: string | null
          email?: string | null
          expo_push_token?: string | null
          full_name?: string | null
          id: string
          is_flagged?: boolean
          no_show_count?: number
          permanent_checkin_pin?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          assigned_city_id?: string | null
          blocked_until?: string | null
          created_at?: string
          default_provider_id?: string | null
          email?: string | null
          expo_push_token?: string | null
          full_name?: string | null
          id?: string
          is_flagged?: boolean
          no_show_count?: number
          permanent_checkin_pin?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_assigned_city_id_fkey"
            columns: ["assigned_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_default_provider_id_fkey"
            columns: ["default_provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          address: string
          auto_accept_bookings: boolean
          auto_confirm_holds: boolean | null
          bank_account_holder: string | null
          bank_account_last4: string | null
          bank_ifsc: string | null
          cancellation_strikes: number
          cancellation_window_hours: number | null
          cashfree_app_id: string | null
          cashfree_vendor_id: string | null
          cashfree_vendor_status: string
          category_id: string
          city: string
          city_id: string | null
          closing_time: string
          cooling_period_days: number
          created_at: string
          daily_booking_limit: number
          description: string | null
          email: string | null
          grievance_notified: boolean | null
          gstin: string | null
          id: string
          is_active: boolean
          is_booking_frozen: boolean
          jurisdiction: string | null
          latitude: number
          longitude: number
          min_deposit_amount: number | null
          name: string
          opening_time: string
          owner_id: string | null
          pan_last4: string | null
          payout_upi_id: string | null
          penalty_balance: number
          phone: string
          photos: string[] | null
          reminder_offset_hours: number | null
          status: Database["public"]["Enums"]["provider_status"]
          strike_reset_date: string
          sub_category_id: string | null
          support_email: string | null
          support_phone: string | null
          tos_accepted_at: string | null
          tos_version: string | null
          updated_at: string
          weekly_hours: Json | null
          whatsapp_confirmations: boolean | null
        }
        Insert: {
          address: string
          auto_accept_bookings?: boolean
          auto_confirm_holds?: boolean | null
          bank_account_holder?: string | null
          bank_account_last4?: string | null
          bank_ifsc?: string | null
          cancellation_strikes?: number
          cancellation_window_hours?: number | null
          cashfree_app_id?: string | null
          cashfree_vendor_id?: string | null
          cashfree_vendor_status?: string
          category_id: string
          city?: string
          city_id?: string | null
          closing_time?: string
          cooling_period_days?: number
          created_at?: string
          daily_booking_limit?: number
          description?: string | null
          email?: string | null
          grievance_notified?: boolean | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          is_booking_frozen?: boolean
          jurisdiction?: string | null
          latitude: number
          longitude: number
          min_deposit_amount?: number | null
          name: string
          opening_time?: string
          owner_id?: string | null
          pan_last4?: string | null
          payout_upi_id?: string | null
          penalty_balance?: number
          phone: string
          photos?: string[] | null
          reminder_offset_hours?: number | null
          status?: Database["public"]["Enums"]["provider_status"]
          strike_reset_date?: string
          sub_category_id?: string | null
          support_email?: string | null
          support_phone?: string | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
          weekly_hours?: Json | null
          whatsapp_confirmations?: boolean | null
        }
        Update: {
          address?: string
          auto_accept_bookings?: boolean
          auto_confirm_holds?: boolean | null
          bank_account_holder?: string | null
          bank_account_last4?: string | null
          bank_ifsc?: string | null
          cancellation_strikes?: number
          cancellation_window_hours?: number | null
          cashfree_app_id?: string | null
          cashfree_vendor_id?: string | null
          cashfree_vendor_status?: string
          category_id?: string
          city?: string
          city_id?: string | null
          closing_time?: string
          cooling_period_days?: number
          created_at?: string
          daily_booking_limit?: number
          description?: string | null
          email?: string | null
          grievance_notified?: boolean | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          is_booking_frozen?: boolean
          jurisdiction?: string | null
          latitude?: number
          longitude?: number
          min_deposit_amount?: number | null
          name?: string
          opening_time?: string
          owner_id?: string | null
          pan_last4?: string | null
          payout_upi_id?: string | null
          penalty_balance?: number
          phone?: string
          photos?: string[] | null
          reminder_offset_hours?: number | null
          status?: Database["public"]["Enums"]["provider_status"]
          strike_reset_date?: string
          sub_category_id?: string | null
          support_email?: string | null
          support_phone?: string | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
          weekly_hours?: Json | null
          whatsapp_confirmations?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "providers_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_sub_category_id_fkey"
            columns: ["sub_category_id"]
            isOneToOne: false
            referencedRelation: "sub_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          device_type: string
          id: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_type?: string
          id?: string
          token: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          device_type?: string
          id?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resource_availability: {
        Row: {
          day_of_week: number
          end_time: string
          id: string
          resource_id: string
          slot_interval_minutes: number
          start_time: string
        }
        Insert: {
          day_of_week: number
          end_time: string
          id?: string
          resource_id: string
          slot_interval_minutes?: number
          start_time: string
        }
        Update: {
          day_of_week?: number
          end_time?: string
          id?: string
          resource_id?: string
          slot_interval_minutes?: number
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_availability_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_leaves: {
        Row: {
          created_at: string
          doctor_name: string
          id: string
          leave_date: string
          provider_id: string
          reason: string
          resource_id: string
        }
        Insert: {
          created_at?: string
          doctor_name: string
          id?: string
          leave_date: string
          provider_id: string
          reason: string
          resource_id: string
        }
        Update: {
          created_at?: string
          doctor_name?: string
          id?: string
          leave_date?: string
          provider_id?: string
          reason?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_leaves_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          attributes: Json
          capacity: number
          created_at: string
          department: string | null
          department_id: string | null
          deposit_amount: number
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          price: number | null
          provider_id: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attributes?: Json
          capacity?: number
          created_at?: string
          department?: string | null
          department_id?: string | null
          deposit_amount?: number
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          price?: number | null
          provider_id: string
          type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attributes?: Json
          capacity?: number
          created_at?: string
          department?: string | null
          department_id?: string | null
          deposit_amount?: number
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          price?: number | null
          provider_id?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_checkin_rate_limits: {
        Row: {
          failed_attempts: number
          locked_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          failed_attempts?: number
          locked_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          failed_attempts?: number
          locked_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sub_categories: {
        Row: {
          category_id: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          category_id: string
          display_order?: number
          id: string
          name: string
        }
        Update: {
          category_id?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      test_provider_clock_links: {
        Row: {
          provider_id: string
          tenant_prefix: string
        }
        Insert: {
          provider_id: string
          tenant_prefix: string
        }
        Update: {
          provider_id?: string
          tenant_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_provider_clock_links_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_provider_clock_links_tenant_prefix_fkey"
            columns: ["tenant_prefix"]
            isOneToOne: false
            referencedRelation: "test_tenant_clocks"
            referencedColumns: ["tenant_prefix"]
          },
        ]
      }
      test_tenant_clocks: {
        Row: {
          simulated_time: string
          tenant_prefix: string
          timezone: string
          updated_at: string
        }
        Insert: {
          simulated_time: string
          tenant_prefix: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          simulated_time?: string
          tenant_prefix?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          ip_address: unknown
          purpose: string
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          id?: string
          ip_address?: unknown
          purpose: string
          user_agent?: string | null
          user_id: string
          version?: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          ip_address?: unknown
          purpose?: string
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      contact_reveal_anomalies: {
        Row: {
          last_revealed_at: string | null
          reveals_last_1h: number | null
          reveals_last_24h: number | null
          staff_name: string | null
          staff_phone: string | null
          user_id: string | null
          venue_name: string | null
        }
        Relationships: []
      }
      device_push_tokens: {
        Row: {
          created_at: string | null
          id: string | null
          platform: string | null
          token: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          platform?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          platform?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      merchant_bookings: {
        Row: {
          attachment_url: string | null
          booked_for: string | null
          booking_for_someone_else: boolean | null
          booking_note: string | null
          checked_in_at: string | null
          checked_in_method: string | null
          consultation_collected_at: string | null
          consultation_collected_by: string | null
          consultation_fee_amount: number | null
          consultation_payment_status: string | null
          created_at: string | null
          customer_arrived_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          department_id: string | null
          department_name: string | null
          deposit_amount: number | null
          emergency_cancelled: boolean | null
          emergency_doctor_arrived: boolean | null
          emergency_patient_choice: string | null
          estimated_wait_minutes: number | null
          followup_original_booking_id: string | null
          gateway_payment_id: string | null
          gstin_platform: string | null
          hold_expires_at: string | null
          id: string | null
          invoice_number: string | null
          is_followup: boolean | null
          is_minor: boolean | null
          is_present: boolean | null
          no_show_count: number | null
          patient_age: number | null
          patient_name: string | null
          patient_phone: string | null
          patient_relationship: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          platform_fee: number | null
          platform_fee_amount: number | null
          platform_fee_gst: number | null
          platform_payment_status: string | null
          provider_id: string | null
          provider_name: string | null
          queue_position: number | null
          reference_code: string | null
          reminder_1h_sent_at: string | null
          reminder_30m_sent_at: string | null
          resource_id: string | null
          resource_name: string | null
          resource_type: string | null
          slot_end: string | null
          slot_start: string | null
          status: Database["public"]["Enums"]["booking_status"] | null
          total_amount: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_followup_original_booking_id_fkey"
            columns: ["followup_original_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_followup_original_booking_id_fkey"
            columns: ["followup_original_booking_id"]
            isOneToOne: false
            referencedRelation: "merchant_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _record_checkin_failure: {
        Args: { p_now: string; p_user_id: string }
        Returns: undefined
      }
      admin_create_resource: {
        Args: {
          p_attributes?: Json
          p_capacity?: number
          p_department?: string
          p_deposit_amount?: number
          p_duration_minutes?: number
          p_name: string
          p_price?: number
          p_provider_id: string
          p_type: string
        }
        Returns: Json
      }
      admin_create_user: {
        Args: {
          p_email: string
          p_full_name: string
          p_password: string
          p_phone?: string
          p_role?: string
        }
        Returns: Json
      }
      admin_create_venue: {
        Args: {
          p_address: string
          p_category_id: string
          p_closing_time?: string
          p_description?: string
          p_email?: string
          p_latitude?: number
          p_longitude?: number
          p_name: string
          p_opening_time?: string
          p_owner_id?: string
          p_phone: string
        }
        Returns: Json
      }
      admin_delete_resource: { Args: { p_resource_id: string }; Returns: Json }
      admin_fetch_city_waitlist: { Args: { p_city_id?: string }; Returns: Json }
      admin_fetch_merchants: { Args: { p_city_id?: string }; Returns: Json }
      admin_get_caller_profile: { Args: never; Returns: Json }
      admin_update_merchant_status: {
        Args: {
          p_admin_token?: string
          p_provider_id: string
          p_status: string
        }
        Returns: Json
      }
      admin_update_provider_operational_settings: {
        Args: {
          p_admin_token?: string
          p_auto_accept?: boolean
          p_daily_limit?: number
          p_is_active?: boolean
          p_provider_id: string
          p_weekly_hours?: Json
        }
        Returns: Json
      }
      advance_test_clock: {
        Args: { p_minutes: number; p_prefix: string }
        Returns: string
      }
      anonymize_user_data: { Args: { p_user_id: string }; Returns: Json }
      assert_booking_actor: {
        Args: { p_customer_id: string; p_provider_id: string }
        Returns: boolean
      }
      atomic_assign_checkin_arrival: {
        Args: { p_arrived_at?: string; p_booking_id: string }
        Returns: Json
      }
      auto_link_merchant_by_email: {
        Args: { p_email: string; p_user_id: string }
        Returns: undefined
      }
      build_template_params: {
        Args: { p_booking: Json; p_event_type: string }
        Returns: Json
      }
      cancel_booking: {
        Args: {
          p_booking_id: string
          p_initiated_by?: string
          p_reason?: string
        }
        Returns: Json
      }
      cancel_doctor_emergency: {
        Args: {
          p_doctor_arrived?: boolean
          p_doctor_resource_id: string
          p_effective_from?: string
          p_reason?: string
        }
        Returns: Json
      }
      cancel_unpaid_pending_bookings: { Args: never; Returns: Json }
      check_and_send_booking_reminders: { Args: never; Returns: Json }
      check_cooling_period_eligibility: {
        Args: {
          p_customer_id: string
          p_provider_id: string
          p_target_slot?: string
        }
        Returns: Json
      }
      check_rate_limit: {
        Args: { p_key: string; p_max_hits: number; p_window_seconds: number }
        Returns: boolean
      }
      check_user_exists_by_phone: {
        Args: { p_phone: string }
        Returns: boolean
      }
      choose_emergency_option: {
        Args: {
          p_booking_id: string
          p_choice: string
          p_new_slot_end?: string
          p_new_slot_start?: string
        }
        Returns: Json
      }
      claim_queued_notifications: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          booking_id: string
          channel: string
          created_at: string
          event_type: string
          id: string
          last_error: string
          message_content: string
          next_attempt_at: string
          recipient_name: string
          recipient_phone: string
          status: string
          template_name: string
          template_params: Json
        }[]
      }
      collect_consultation_fee: {
        Args: { p_booking_id: string; p_collected_by?: string }
        Returns: Json
      }
      complete_booking: { Args: { p_booking_id: string }; Returns: Json }
      compute_gst_for_booking: {
        Args: { p_booking_id: string }
        Returns: number
      }
      confirm_booking_by_merchant: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      confirm_booking_payment: {
        Args: {
          p_booking_id: string
          p_deposit_amount?: number
          p_gateway_payment_id: string
        }
        Returns: Json
      }
      create_booking_hold: {
        Args: {
          p_booked_for?: string
          p_booking_for_someone_else?: boolean
          p_booking_note?: string
          p_customer_id: string
          p_patient_age?: number
          p_patient_name?: string
          p_patient_phone?: string
          p_patient_relationship?: string
          p_resource_id: string
          p_slot_end: string
          p_slot_start: string
        }
        Returns: Json
      }
      cron_daily_cleanup: { Args: never; Returns: Json }
      cron_expire_no_shows: { Args: never; Returns: Json }
      cron_trigger_queue_consumers: { Args: never; Returns: Json }
      dispatch_booking_notification: {
        Args: { p_booking_id: string; p_event_type: string }
        Returns: Json
      }
      enqueue_booking_reminders: { Args: never; Returns: Json }
      enqueue_refund_request: {
        Args: { p_actor_id?: string; p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      expire_stale_standby_queue: {
        Args: { p_provider_id?: string; p_threshold_minutes?: number }
        Returns: Json
      }
      generate_appointment_checkin_code_for_booking: {
        Args: { p_booking_id: string }
        Returns: string
      }
      generate_invoice_number: {
        Args: { p_booking_id: string }
        Returns: string
      }
      get_active_cities: {
        Args: { p_include_expanding?: boolean }
        Returns: {
          active_providers_count: number
          id: string
          latitude: number
          longitude: number
          name: string
          radius_km: number
          state: string
          status: string
        }[]
      }
      get_admin_audit_logs: {
        Args: { p_admin_token?: string; p_limit?: number }
        Returns: {
          action: string
          admin_email: string
          admin_id: string
          admin_name: string
          created_at: string
          details: Json
          id: string
          ip_address: string
          target_id: string
          target_type: string
        }[]
      }
      get_admin_city_stats: {
        Args: never
        Returns: {
          city_id: string
          city_name: string
          completed_bookings: number
          deposit_volume: number
          in_progress_merchants: number
          merchant_target: number
          onboarded_merchants: number
          state: string
          status: string
          suspended_merchants: number
          total_bookings: number
          total_resources: number
          waitlist_count: number
        }[]
      }
      get_admin_velocity_analytics: {
        Args: { p_city_id?: string; p_time_window?: string }
        Returns: Json
      }
      get_city_director_stats: {
        Args: { p_from?: string; p_until?: string }
        Returns: Json
      }
      get_masked_customer_info: {
        Args: { p_customer_id: string }
        Returns: {
          customer_name: string
          customer_phone: string
          no_show_count: number
        }[]
      }
      get_merchant_bookings: {
        Args: { p_provider_id?: string }
        Returns: {
          attachment_url: string
          created_at: string
          customer_arrived_at: string
          customer_id: string
          customer_name: string
          customer_phone: string
          deposit_amount: number
          gateway_payment_id: string
          gstin_platform: string
          hold_expires_at: string
          id: string
          invoice_number: string
          is_present: boolean
          no_show_count: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          platform_fee: number
          platform_fee_gst: number
          provider_id: string
          provider_name: string
          reference_code: string
          reminder_1h_sent_at: string
          reminder_30m_sent_at: string
          resource_id: string
          resource_name: string
          resource_type: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at: string
        }[]
      }
      get_nearby_providers: {
        Args: {
          p_category?: string
          p_lat: number
          p_lng: number
          p_radius_meters?: number
        }
        Returns: Json
      }
      get_or_create_customer_checkin_pin: {
        Args: { p_customer_id: string }
        Returns: string
      }
      get_provider_details: { Args: { p_provider_id: string }; Returns: Json }
      get_template_name: { Args: { p_event_type: string }; Returns: string }
      get_test_clock: { Args: { p_provider_id: string }; Returns: string }
      get_test_clock_for_prefix: { Args: { p_prefix: string }; Returns: string }
      get_user_authorized_providers: {
        Args: { p_user_id?: string }
        Returns: string[]
      }
      get_user_department_id: {
        Args: { p_merchant_id: string; p_user_id: string }
        Returns: string
      }
      get_vault_secret_by_name: {
        Args: { p_secret_name: string }
        Returns: string
      }
      hospital_accessible_resource_ids: {
        Args: { p_provider_id: string; p_user_id?: string }
        Returns: string[]
      }
      hospital_accessible_resource_ids_for_user: {
        Args: { p_user_id?: string }
        Returns: string[]
      }
      hospital_role: {
        Args: { p_provider_id: string; p_user_id?: string }
        Returns: string
      }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
      is_caller_authorized_for_resource: {
        Args: {
          p_provider_id: string
          p_resource_id: string
          p_user_id?: string
        }
        Returns: boolean
      }
      is_city_director_for_city: {
        Args: { p_city_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_hospital_owner: {
        Args: { p_merchant_id: string; p_user_id: string }
        Returns: boolean
      }
      is_hospital_provider: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      is_merchant_owner_or_admin: {
        Args: { p_provider_id: string; p_user_id?: string }
        Returns: boolean
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_target_id: string
          p_target_type: string
        }
        Returns: string
      }
      log_client_event: {
        Args: {
          p_app_version?: string
          p_appointment_id?: string
          p_category?: string
          p_city_id?: string
          p_component?: string
          p_device_info?: Json
          p_device_model?: string
          p_environment?: string
          p_error_code?: string
          p_fingerprint?: string
          p_level: string
          p_message: string
          p_metadata?: Json
          p_platform: string
          p_platform_os?: string
          p_role?: string
          p_session_id?: string
          p_severity?: string
          p_source?: string
          p_stack_trace?: string
          p_vertical?: string
        }
        Returns: string
      }
      mark_customer_reached: { Args: { p_booking_id: string }; Returns: Json }
      mark_present_manually: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      mask_customer_phone: { Args: { p_phone: string }; Returns: string }
      mask_old_notification_logs: { Args: { p_days?: number }; Returns: number }
      merchant_add_resource_leave: {
        Args: {
          p_doctor_name: string
          p_leave_date: string
          p_provider_id: string
          p_reason?: string
          p_resource_id: unknown
        }
        Returns: Json
      }
      merchant_delete_resource: {
        Args: { p_resource_id: string }
        Returns: boolean
      }
      merchant_delete_resource_leave: {
        Args: { p_leave_id: string }
        Returns: boolean
      }
      merchant_move_booking_to_standby: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      merchant_register_shop_for_user: {
        Args: {
          p_address?: string
          p_category_id?: string
          p_city?: string
          p_full_name?: string
          p_phone?: string
          p_photo_url?: string
          p_raw_meta?: Json
          p_shop_name: string
          p_user_id: string
        }
        Returns: Json
      }
      merchant_save_operational_settings: {
        Args: {
          p_auto_confirm_holds?: boolean
          p_business_name?: string
          p_cancellation_window_hours?: number
          p_cashfree_app_id?: string
          p_cashfree_vendor_id?: string
          p_cooling_period_days?: number
          p_gstin?: string
          p_jurisdiction?: string
          p_min_deposit_amount?: number
          p_payout_upi_id?: string
          p_provider_id: string
          p_reminder_offset_hours?: number
          p_support_email?: string
          p_support_phone?: string
          p_whatsapp_confirmations?: boolean
        }
        Returns: Json
      }
      merchant_save_weekly_schedule: {
        Args: {
          p_provider_id: string
          p_schedule: Json
          p_slot_duration_minutes?: number
        }
        Returns: Json
      }
      merchant_self_register: {
        Args: {
          p_address?: string
          p_category_id: string
          p_email: string
          p_full_name: string
          p_password: string
          p_phone: string
          p_photo_url?: string
          p_shop_name: string
        }
        Returns: Json
      }
      merchant_update_cooling_period: {
        Args: { p_cooling_period_days: number; p_provider_id: string }
        Returns: Json
      }
      merchant_upsert_resource: {
        Args: {
          p_attributes?: Json
          p_capacity?: number
          p_category?: string
          p_deposit_amount?: number
          p_duration_minutes?: number
          p_name: string
          p_price?: number
          p_provider_id: string
          p_resource_id?: string
        }
        Returns: Json
      }
      normalize_phone_number: { Args: { p_phone: string }; Returns: string }
      override_hospital_queue_position: {
        Args: {
          p_booking_id: string
          p_caller_id?: string
          p_override_position: number
        }
        Returns: Json
      }
      process_expired_account_deletions: { Args: never; Returns: number }
      purge_expired_waitlist_entries: { Args: never; Returns: number }
      purge_old_app_logs: {
        Args: { p_retention_days?: number }
        Returns: number
      }
      read_queue_with_dlq: {
        Args: {
          p_dlq: string
          p_max_reads?: number
          p_qty?: number
          p_queue: string
          p_vt?: number
        }
        Returns: {
          enqueued_at: string
          message: Json
          msg_id: number
          read_ct: number
          vt: string
        }[]
      }
      reassign_booking_resource: {
        Args: {
          p_booking_id: string
          p_new_resource_id: string
          p_reason?: string
        }
        Returns: Json
      }
      reclaim_expired_hold_or_refund: {
        Args: {
          p_amount: number
          p_booking_id: string
          p_currency?: string
          p_order_id: string
          p_payment_id: string
        }
        Returns: Json
      }
      record_no_show: { Args: { p_booking_id: string }; Returns: Json }
      release_expired_holds: { Args: never; Returns: Json }
      remove_stale_push_token: { Args: { p_token: string }; Returns: Json }
      reorder_hospital_queue: {
        Args: {
          p_booking_ids: string[]
          p_caller_id?: string
          p_doctor_id: string
          p_provider_id: string
        }
        Returns: Json
      }
      replay_dlq_message: {
        Args: { p_dlq: string; p_dlq_msg_id: number; p_target_queue: string }
        Returns: Json
      }
      request_account_deletion: { Args: { p_reason?: string }; Returns: Json }
      reschedule_booking_slot: {
        Args: {
          p_booking_id: string
          p_new_slot_end: string
          p_new_slot_start: string
        }
        Returns: Json
      }
      reset_test_bookings: {
        Args: { p_customer_id?: string; p_provider_id: string }
        Returns: Json
      }
      reset_test_customer_strikes: {
        Args: { p_count?: number; p_customer_id: string }
        Returns: Json
      }
      reset_test_provider_strikes: {
        Args: { p_count?: number; p_provider_id: string }
        Returns: Json
      }
      reveal_contact: { Args: { p_booking_id: string }; Returns: Json }
      reveal_customer_contact: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      sanitize_template_param: {
        Args: { p_default?: string; p_val: string }
        Returns: string
      }
      search_directory: { Args: { p_query?: string }; Returns: Json }
      search_directory_public: { Args: { p_query?: string }; Returns: Json }
      set_booking_slot_for_reminder: {
        Args: { p_booking_id: string; p_minutes_from_now?: number }
        Returns: Json
      }
      set_test_clock: {
        Args: { p_prefix: string; p_time: string }
        Returns: string
      }
      submit_city_waitlist: {
        Args: {
          p_city_name: string
          p_notes?: string
          p_phone: string
          p_vertical_interest?: string
        }
        Returns: Json
      }
      sync_customer_profile: {
        Args: { p_email?: string; p_full_name?: string; p_phone?: string }
        Returns: Json
      }
      trigger_whatsapp_sender_cron: { Args: never; Returns: undefined }
      update_city_status: {
        Args: {
          p_admin_token?: string
          p_city_id: string
          p_status: string
          p_target?: number
        }
        Returns: Json
      }
      verify_checkin_code: {
        Args: { p_code: string; p_shop_id: string }
        Returns: Json
      }
    }
    Enums: {
      booking_status:
        | "HELD"
        | "PENDING_PAYMENT"
        | "CONFIRMED"
        | "COMPLETED"
        | "CANCELLED"
        | "NO_SHOW"
        | "CHECKED_IN"
        | "IN_CONSULTATION"
        | "WAITING"
        | "UP_NEXT"
      payment_status:
        | "PENDING"
        | "CAPTURED"
        | "REFUNDED"
        | "FORFEITED"
        | "REFUND_PENDING"
        | "REFUND_FAILED"
        | "REFUND_IN_PROGRESS"
      provider_status: "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED"
      user_role: "customer" | "merchant" | "admin" | "city_director"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booking_status: [
        "HELD",
        "PENDING_PAYMENT",
        "CONFIRMED",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW",
        "CHECKED_IN",
        "IN_CONSULTATION",
        "WAITING",
        "UP_NEXT",
      ],
      payment_status: [
        "PENDING",
        "CAPTURED",
        "REFUNDED",
        "FORFEITED",
        "REFUND_PENDING",
        "REFUND_FAILED",
        "REFUND_IN_PROGRESS",
      ],
      provider_status: ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED"],
      user_role: ["customer", "merchant", "admin", "city_director"],
    },
  },
} as const

