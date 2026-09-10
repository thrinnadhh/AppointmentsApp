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
          gateway_payment_id: string | null
          hold_expires_at: string | null
          id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          provider_id: string
          resource_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          deposit_amount: number
          gateway_payment_id?: string | null
          hold_expires_at?: string | null
          id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          provider_id: string
          resource_id: string
          slot_end: string
          slot_start: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          deposit_amount?: number
          gateway_payment_id?: string | null
          hold_expires_at?: string | null
          id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          provider_id?: string
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
      profiles: {
        Row: {
          created_at: string
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
          updated_at: string
        }
        Insert: {
          address: string
          category_id: string
          city?: string
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
          updated_at?: string
        }
        Update: {
          address?: string
          category_id?: string
          city?: string
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
      create_booking_hold: {
        Args: {
          p_customer_id: string
          p_resource_id: string
          p_slot_end: string
          p_slot_start: string
        }
        Returns: Json
      }
      record_no_show: { Args: { p_booking_id: string }; Returns: Json }
      release_expired_holds: { Args: never; Returns: Json }
    }
    Enums: {
      booking_status:
        | "HELD"
        | "PENDING_PAYMENT"
        | "CONFIRMED"
        | "COMPLETED"
        | "CANCELLED"
        | "NO_SHOW"
      payment_status: "PENDING" | "CAPTURED" | "REFUNDED" | "FORFEITED"
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
      payment_status: ["PENDING", "CAPTURED", "REFUNDED", "FORFEITED"],
      provider_status: ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED"],
      user_role: ["customer", "merchant", "admin"],
    },
  },
} as const
