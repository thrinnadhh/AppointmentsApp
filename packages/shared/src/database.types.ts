export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
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
          component: string | null
          created_at: string
          device_info: Json | null
          id: string
          level: string
          message: string
          metadata: Json | null
          platform: string
          session_id: string | null
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          component?: string | null
          created_at?: string
          device_info?: Json | null
          id?: string
          level: string
          message: string
          metadata?: Json | null
          platform: string
          session_id?: string | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          component?: string | null
          created_at?: string
          device_info?: Json | null
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
          platform?: string
          session_id?: string | null
          stack_trace?: string | null
          user_id?: string | null
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
          created_at: string
          id: string
          merchant_id: string
          metadata: Json
          target: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          merchant_id: string
          metadata?: Json
          target: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          merchant_id?: string
          metadata?: Json
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
          booking_for_someone_else: boolean
          checked_in_at: string | null
          checked_in_by: string | null
          checked_in_method: string | null
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
          followup_original_booking_id: string | null
          gateway_order_id: string | null
          gateway_payment_id: string | null
          gstin_platform: string | null
          hold_expires_at: string | null
          id: string
          invoice_generated_at: string | null
          invoice_number: string | null
          is_followup: boolean
          is_present: boolean
          patient_name: string | null
          patient_phone: string | null
          patient_relationship: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          platform_fee: number | null
          platform_fee_gst: number
          provider_id: string
          queue_position: number | null
          reference_code: string | null
          reminder_1h_sent_at: string | null
          reminder_30m_sent_at: string | null
          resource_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number | null
          total_charged: number | null
          updated_at: string
          version: number
        }
        Insert: {
          attachment_url?: string | null
          booking_for_someone_else?: boolean
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_in_method?: string | null
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
          followup_original_booking_id?: string | null
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gstin_platform?: string | null
          hold_expires_at?: string | null
          id?: string
          invoice_generated_at?: string | null
          invoice_number?: string | null
          is_followup?: boolean
          is_present?: boolean
          patient_name?: string | null
          patient_phone?: string | null
          patient_relationship?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          platform_fee?: number | null
          platform_fee_gst?: number
          provider_id: string
          queue_position?: number | null
          reference_code?: string | null
          reminder_1h_sent_at?: string | null
          reminder_30m_sent_at?: string | null
          resource_id: string
          slot_end: string
          slot_start: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number | null
          total_charged?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          attachment_url?: string | null
          booking_for_someone_else?: boolean
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_in_method?: string | null
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
          followup_original_booking_id?: string | null
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gstin_platform?: string | null
          hold_expires_at?: string | null
          id?: string
          invoice_generated_at?: string | null
          invoice_number?: string | null
          is_followup?: boolean
          is_present?: boolean
          patient_name?: string | null
          patient_phone?: string | null
          patient_relationship?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          platform_fee?: number | null
          platform_fee_gst?: number
          provider_id?: string
          queue_position?: number | null
          reference_code?: string | null
          reminder_1h_sent_at?: string | null
          reminder_30m_sent_at?: string | null
          resource_id?: string
          slot_end?: string
          slot_start?: string
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
          city_id: string | null
          city_name: string
          consent_given: boolean
          consent_timestamp: string | null
          contact_info: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          phone: string | null
          purge_after: string | null
          role_interest: string | null
          vertical_interest: string | null
        }
        Insert: {
          city_id?: string | null
          city_name: string
          consent_given?: boolean
          consent_timestamp?: string | null
          contact_info?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          purge_after?: string | null
          role_interest?: string | null
          vertical_interest?: string | null
        }
        Update: {
          city_id?: string | null
          city_name?: string
          consent_given?: boolean
          consent_timestamp?: string | null
          contact_info?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          purge_after?: string | null
          role_interest?: string | null
          vertical_interest?: string | null
        }
        Relationships: []
      }
      contact_reveal_audit: {
        Row: {
          booking_id: string | null
          id: string
          revealed_at: string
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          id?: string
          revealed_at?: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          id?: string
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
      notification_logs: {
        Row: {
          booking_id: string
          channel: string
          created_at: string
          event_type: string
          id: string
          message_content: string
          provider_response: Json | null
          recipient_name: string | null
          recipient_phone: string
          sent_at: string
          status: string
        }
        Insert: {
          booking_id: string
          channel: string
          created_at?: string
          event_type: string
          id?: string
          message_content: string
          provider_response?: Json | null
          recipient_name?: string | null
          recipient_phone: string
          sent_at?: string
          status?: string
        }
        Update: {
          booking_id?: string
          channel?: string
          created_at?: string
          event_type?: string
          id?: string
          message_content?: string
          provider_response?: Json | null
          recipient_name?: string | null
          recipient_phone?: string
          sent_at?: string
          status?: string
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
          user_id: string
        }
        Update: {
          created_at?: string
          device_type?: string
          id?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          address: string
          auto_accept_bookings: boolean
          cancellation_strikes: number
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
          id: string
          is_active: boolean
          is_booking_frozen: boolean
          latitude: number
          longitude: number
          name: string
          opening_time: string
          owner_id: string | null
          penalty_balance: number
          phone: string
          photos: string[] | null
          status: Database["public"]["Enums"]["provider_status"]
          strike_reset_date: string
          sub_category_id: string | null
          tos_accepted_at: string | null
          tos_version: string | null
          updated_at: string
          weekly_hours: Json | null
        }
        Insert: {
          address: string
          auto_accept_bookings?: boolean
          cancellation_strikes?: number
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
          id?: string
          is_active?: boolean
          is_booking_frozen?: boolean
          latitude: number
          longitude: number
          name: string
          opening_time?: string
          owner_id?: string | null
          penalty_balance?: number
          phone: string
          photos?: string[] | null
          status?: Database["public"]["Enums"]["provider_status"]
          strike_reset_date?: string
          sub_category_id?: string | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
          weekly_hours?: Json | null
        }
        Update: {
          address?: string
          auto_accept_bookings?: boolean
          cancellation_strikes?: number
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
          id?: string
          is_active?: boolean
          is_booking_frozen?: boolean
          latitude?: number
          longitude?: number
          name?: string
          opening_time?: string
          owner_id?: string | null
          penalty_balance?: number
          phone?: string
          photos?: string[] | null
          status?: Database["public"]["Enums"]["provider_status"]
          strike_reset_date?: string
          sub_category_id?: string | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
          weekly_hours?: Json | null
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
      merchant_bookings: {
        Row: {
          attachment_url: string | null
          created_at: string | null
          customer_arrived_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          department_id: string | null
          department_name: string | null
          deposit_amount: number | null
          gateway_payment_id: string | null
          gstin_platform: string | null
          hold_expires_at: string | null
          id: string | null
          invoice_number: string | null
          is_present: boolean | null
          no_show_count: number | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          platform_fee: number | null
          platform_fee_gst: number | null
          provider_id: string | null
          provider_name: string | null
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
      admin_fetch_merchants: { Args: { p_city_id?: string }; Returns: Json }
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
      admin_update_resource_status: {
        Args: {
          p_admin_token?: string
          p_is_active: boolean
          p_resource_id: string
        }
        Returns: Json
      }
      anonymize_user_data: { Args: { p_user_id: string }; Returns: Json }
      auto_link_merchant_by_email: {
        Args: { p_email: string; p_user_id: string }
        Returns: undefined
      }
      cancel_booking: {
        Args: {
          p_booking_id: string
          p_initiated_by?: string
          p_reason?: string
        }
        Returns: Json
      }
      check_and_send_booking_reminders: { Args: never; Returns: Json }
      check_cooling_period_eligibility: {
        Args: {
          p_customer_id: string
          p_provider_id: string
          p_target_slot?: string
        }
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
          p_customer_id: string
          p_resource_id: string
          p_slot_end: string
          p_slot_start: string
        }
        Returns: Json
      }
      dispatch_booking_notification: {
        Args: { p_booking_id: string; p_event_type: string }
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
      get_provider_details: { Args: { p_provider_id: string }; Returns: Json }
      get_user_authorized_providers: {
        Args: { p_user_id?: string }
        Returns: string[]
      }
      get_user_department_id: {
        Args: { p_merchant_id: string; p_user_id: string }
        Returns: string
      }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
      is_hospital_owner: {
        Args: { p_merchant_id: string; p_user_id: string }
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
          p_component?: string
          p_device_info?: Json
          p_level: string
          p_message: string
          p_metadata?: Json
          p_platform: string
          p_session_id?: string
          p_stack_trace?: string
        }
        Returns: string
      }
      mark_customer_reached: { Args: { p_booking_id: string }; Returns: Json }
      mark_present_manually: { Args: { p_booking_id: string }; Returns: Json }
      mask_customer_phone: { Args: { p_phone: string }; Returns: string }
      merchant_register_shop_for_user: {
        Args: {
          p_address?: string
          p_category_id: string
          p_full_name?: string
          p_phone: string
          p_photo_url?: string
          p_shop_name: string
          p_user_id: string
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
      process_expired_account_deletions: { Args: never; Returns: number }
      purge_expired_waitlist_entries: { Args: never; Returns: number }
      purge_old_app_logs: {
        Args: { p_retention_days?: number }
        Returns: number
      }
      reassign_booking_resource: {
        Args: {
          p_booking_id: string
          p_new_resource_id: string
          p_reason?: string
        }
        Returns: Json
      }
      record_no_show: { Args: { p_booking_id: string }; Returns: Json }
      release_expired_holds: { Args: never; Returns: Json }
      remove_stale_push_token: {
        Args: { p_token: string }
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
      reveal_customer_contact: { Args: { p_booking_id: string }; Returns: Json }
      search_directory: { Args: { p_query?: string }; Returns: Json }
      search_directory_public: { Args: { p_query?: string }; Returns: Json }
      set_booking_slot_for_reminder: {
        Args: { p_booking_id: string; p_minutes_from_now?: number }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sync_customer_profile: {
        Args: { p_email?: string; p_full_name?: string; p_phone?: string }
        Returns: Json
      }
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
        | "ADMITTED"
      payment_status:
        | "PENDING"
        | "CAPTURED"
        | "REFUNDED"
        | "FORFEITED"
        | "REFUND_PENDING"
        | "REFUND_FAILED"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "ADMITTED",
      ],
      payment_status: [
        "PENDING",
        "CAPTURED",
        "REFUNDED",
        "FORFEITED",
        "REFUND_PENDING",
        "REFUND_FAILED",
      ],
      provider_status: ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED"],
      user_role: ["customer", "merchant", "admin", "city_director"],
    },
  },
} as const
