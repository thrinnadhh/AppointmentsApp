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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bookings: {
        Row: {
          created_at: string
          customer_id: string
          deposit_amount: number
          platform_fee: number | null
          platform_fee_gst: number | null
          total_amount: number | null
          gateway_payment_id: string | null
          gateway_order_id: string | null
          hold_expires_at: string | null
          id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          provider_id: string
          reference_code: string | null
          resource_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          attachment_url: string | null
          reminder_1h_sent_at: string | null
          reminder_30m_sent_at: string | null
          is_present: boolean
          customer_arrived_at: string | null
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          customer_id: string
          deposit_amount: number
          platform_fee?: number | null
          platform_fee_gst?: number | null
          total_amount?: number | null
          gateway_payment_id?: string | null
          gateway_order_id?: string | null
          hold_expires_at?: string | null
          id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          provider_id: string
          reference_code?: string | null
          reminder_1h_sent_at?: string | null
          reminder_30m_sent_at?: string | null
          is_present?: boolean
          customer_arrived_at?: string | null
          resource_id: string
          slot_end: string
          slot_start: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          customer_id?: string
          deposit_amount?: number
          platform_fee?: number | null
          platform_fee_gst?: number | null
          total_amount?: number | null
          gateway_payment_id?: string | null
          gateway_order_id?: string | null
          hold_expires_at?: string | null
          id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          provider_id?: string
          reference_code?: string | null
          reminder_1h_sent_at?: string | null
          reminder_30m_sent_at?: string | null
          is_present?: boolean
          customer_arrived_at?: string | null
          resource_id?: string
          slot_end?: string
          slot_start?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
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
          country: string
          id: string
          latitude: number
          longitude: number
          merchant_target: number
          metadata: Json
          name: string
          radius_km: number
          state: string
          status: "ACTIVE" | "EXPANDING" | "PLANNED" | "PAUSED"
          updated_at: string
        }
        Insert: {
          created_at?: string
          country?: string
          id: string
          latitude: number
          longitude: number
          merchant_target?: number
          metadata?: Json
          name: string
          radius_km?: number
          state?: string
          status?: "ACTIVE" | "EXPANDING" | "PLANNED" | "PAUSED"
          updated_at?: string
        }
        Update: {
          created_at?: string
          country?: string
          id?: string
          latitude?: number
          longitude?: number
          merchant_target?: number
          metadata?: Json
          name?: string
          radius_km?: number
          state?: string
          status?: "ACTIVE" | "EXPANDING" | "PLANNED" | "PAUSED"
          updated_at?: string
        }
        Relationships: []
      }
      city_waitlist: {
        Row: {
          city_id: string
          contact_info: string
          created_at: string
          id: string
          notes: string | null
          role_interest: string
          user_id: string | null
        }
        Insert: {
          city_id: string
          contact_info: string
          created_at?: string
          id?: string
          notes?: string | null
          role_interest?: string
          user_id?: string | null
        }
        Update: {
          city_id?: string
          contact_info?: string
          created_at?: string
          id?: string
          notes?: string | null
          role_interest?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "city_waitlist_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
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
        ]
      }
      merchant_memberships: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          role: 'owner' | 'manager' | 'staff'
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          role?: 'owner' | 'manager' | 'staff'
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          role?: 'owner' | 'manager' | 'staff'
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
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_provider_id: string | null
          email: string | null
          full_name: string | null
          id: string
          is_flagged: boolean
          no_show_count: number
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_provider_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_flagged?: boolean
          no_show_count?: number
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_provider_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_flagged?: boolean
          no_show_count?: number
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          address: string
          category_id: string
          city: string
          city_id: string | null
          closing_time: string
          created_at: string
          description: string | null
          email: string | null
          id: string
          latitude: number
          longitude: number
          name: string
          opening_time: string
          owner_id: string | null
          phone: string
          photos: string[] | null
          status: Database["public"]["Enums"]["provider_status"]
          sub_category_id: string | null
          cancellation_strikes: number
          strike_reset_date: string
          penalty_balance: number
          is_booking_frozen: boolean
          is_active: boolean
          auto_accept_bookings: boolean
          daily_booking_limit: number
          weekly_hours: Json
          updated_at: string
        }
        Insert: {
          address: string
          category_id: string
          city?: string
          city_id?: string | null
          closing_time?: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          latitude: number
          longitude: number
          name: string
          opening_time?: string
          owner_id?: string | null
          phone: string
          photos?: string[] | null
          status?: Database["public"]["Enums"]["provider_status"]
          sub_category_id?: string | null
          cancellation_strikes?: number
          strike_reset_date?: string
          penalty_balance?: number
          is_booking_frozen?: boolean
          is_active?: boolean
          auto_accept_bookings?: boolean
          daily_booking_limit?: number
          weekly_hours?: Json
          updated_at?: string
        }
        Update: {
          address?: string
          category_id?: string
          city?: string
          city_id?: string | null
          closing_time?: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          opening_time?: string
          owner_id?: string | null
          phone?: string
          photos?: string[] | null
          status?: Database["public"]["Enums"]["provider_status"]
          sub_category_id?: string | null
          cancellation_strikes?: number
          strike_reset_date?: string
          penalty_balance?: number
          is_booking_frozen?: boolean
          is_active?: boolean
          auto_accept_bookings?: boolean
          daily_booking_limit?: number
          weekly_hours?: Json
          updated_at?: string
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
            foreignKeyName: "resources_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
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
          ip_address: string | null
          purpose: string
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          id?: string
          ip_address?: string | null
          purpose: string
          user_agent?: string | null
          user_id: string
          version?: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          ip_address?: string | null
          purpose?: string
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      account_deletion_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          id: string
          reason: string | null
          requested_at: string
          scheduled_for: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          scheduled_for?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          scheduled_for?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_audit_logs: {
        Row: {
          id: string
          admin_id: string | null
          admin_name: string | null
          admin_email: string | null
          action: string
          target_type: string
          target_id: string | null
          details: Json
          ip_address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          admin_id?: string | null
          admin_name?: string | null
          admin_email?: string | null
          action: string
          target_type: string
          target_id?: string | null
          details?: Json
          ip_address?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          admin_id?: string | null
          admin_name?: string | null
          admin_email?: string | null
          action?: string
          target_type?: string
          target_id?: string | null
          details?: Json
          ip_address?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      cancel_booking: {
        Args: {
          p_booking_id: string
          p_initiated_by?: string
          p_reason?: string
        }
        Returns: Json
      }
      check_and_send_booking_reminders: {
        Args: Record<PropertyKey, never>
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
      dispatch_booking_notification: {
        Args: {
          p_booking_id: string
          p_event_type: string
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
      get_nearby_providers: {
        Args: {
          p_lat: number
          p_lng: number
          p_category?: string | null
          p_radius_meters?: number
        }
        Returns: Json
      }
      get_active_cities: {
        Args: {
          p_include_expanding?: boolean
        }
        Returns: Json
      }
      get_admin_city_stats: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_admin_velocity_analytics: {
        Args: {
          p_city_id?: string | null
          p_time_window?: string
        }
        Returns: Json
      }
      update_city_status: {
        Args: {
          p_city_id: string
          p_status: string
          p_target?: number | null
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      record_no_show: { Args: { p_booking_id: string }; Returns: Json }
      reassign_booking_resource: {
        Args: {
          p_booking_id: string
          p_new_resource_id: string
          p_reason?: string
        }
        Returns: Json
      }
      reset_test_provider_strikes: {
        Args: {
          p_provider_id: string
          p_count?: number
        }
        Returns: Json
      }
      release_expired_holds: { Args: never; Returns: Json }
      reschedule_booking_slot: {
        Args: {
          p_booking_id: string
          p_new_slot_end: string
          p_new_slot_start: string
        }
        Returns: Json
      }
      search_directory: {
        Args: {
          p_query?: string
        }
        Returns: Json
      }
      set_booking_slot_for_reminder: {
        Args: {
          p_booking_id: string
          p_minutes_from_now?: number
        }
        Returns: Json
      }
      sync_customer_profile: {
        Args: {
          p_email?: string | null
          p_full_name?: string | null
          p_phone?: string | null
        }
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
      payment_status: "PENDING" | "CAPTURED" | "REFUNDED" | "REFUND_PENDING" | "REFUND_FAILED" | "FORFEITED"
      provider_status: "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED"
      user_role: "customer" | "merchant" | "admin"
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
  public: {
    Enums: {
      booking_status: [
        "HELD",
        "PENDING_PAYMENT",
        "CONFIRMED",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW",
      ],
      payment_status: ["PENDING", "CAPTURED", "REFUNDED", "REFUND_PENDING", "REFUND_FAILED", "FORFEITED"],
      provider_status: ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED"],
      user_role: ["customer", "merchant", "admin"],
    },
  },
} as const
