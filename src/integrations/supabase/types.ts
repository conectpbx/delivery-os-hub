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
      admin_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          target_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          target_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          target_id?: string | null
        }
        Relationships: []
      }
      ai_scan_usage: {
        Row: {
          count: number
          created_at: string
          id: string
          updated_at: string
          usage_date: string
          user_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          id?: string
          updated_at?: string
          usage_date?: string
          user_id: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          updated_at?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      apps: {
        Row: {
          color: string | null
          created_at: string
          fee_percent: number
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          fee_percent?: number
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          fee_percent?: number
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          app_name: string
          created_at: string
          distance_km: number
          dropoff_address: string | null
          duration_min: number
          earnings: number
          fee_percent: number
          gross_earnings: number
          id: string
          idle_min: number
          lat: number | null
          lng: number | null
          occurred_at: string
          payment_method: string
          pickup_address: string | null
          status: string
          stops: Json
          tip: number
          user_id: string
        }
        Insert: {
          app_name: string
          created_at?: string
          distance_km?: number
          dropoff_address?: string | null
          duration_min?: number
          earnings?: number
          fee_percent?: number
          gross_earnings?: number
          id?: string
          idle_min?: number
          lat?: number | null
          lng?: number | null
          occurred_at?: string
          payment_method?: string
          pickup_address?: string | null
          status?: string
          stops?: Json
          tip?: number
          user_id: string
        }
        Update: {
          app_name?: string
          created_at?: string
          distance_km?: number
          dropoff_address?: string | null
          duration_min?: number
          earnings?: number
          fee_percent?: number
          gross_earnings?: number
          id?: string
          idle_min?: number
          lat?: number | null
          lng?: number | null
          occurred_at?: string
          payment_method?: string
          pickup_address?: string | null
          status?: string
          stops?: Json
          tip?: number
          user_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string | null
          id: string
          occurred_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          description?: string | null
          id?: string
          occurred_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          occurred_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fuelings: {
        Row: {
          created_at: string
          id: string
          liters: number
          occurred_at: string
          odometer: number | null
          price_per_liter: number
          station: string | null
          total: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          liters?: number
          occurred_at?: string
          odometer?: number | null
          price_per_liter?: number
          station?: string | null
          total?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          liters?: number
          occurred_at?: string
          odometer?: number | null
          price_per_liter?: number
          station?: string | null
          total?: number
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          deliveries_target: number
          id: string
          month: string
          profit_target: number
          revenue_target: number
          user_id: string
        }
        Insert: {
          created_at?: string
          deliveries_target?: number
          id?: string
          month: string
          profit_target?: number
          revenue_target?: number
          user_id: string
        }
        Update: {
          created_at?: string
          deliveries_target?: number
          id?: string
          month?: string
          profit_target?: number
          revenue_target?: number
          user_id?: string
        }
        Relationships: []
      }
      maintenances: {
        Row: {
          cost: number
          created_at: string
          description: string | null
          id: string
          next_due_date: string | null
          next_due_km: number | null
          odometer: number | null
          performed_at: string
          service_type: string
          status: string
          user_id: string
        }
        Insert: {
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          next_due_date?: string | null
          next_due_km?: number | null
          odometer?: number | null
          performed_at?: string
          service_type: string
          status?: string
          user_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          next_due_date?: string | null
          next_due_km?: number | null
          odometer?: number | null
          performed_at?: string
          service_type?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          daily_goal: number | null
          fuel_efficiency: number | null
          full_name: string | null
          id: string
          monthly_goal: number | null
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          created_at?: string
          daily_goal?: number | null
          fuel_efficiency?: number | null
          full_name?: string | null
          id: string
          monthly_goal?: number | null
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          created_at?: string
          daily_goal?: number | null
          fuel_efficiency?: number | null
          full_name?: string | null
          id?: string
          monthly_goal?: number | null
          updated_at?: string
          vehicle?: string | null
        }
        Relationships: []
      }
      system_modules: {
        Row: {
          description: string
          enabled: boolean
          key: string
          name: string
          position: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string
          enabled?: boolean
          key: string
          name: string
          position?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string
          enabled?: boolean
          key?: string
          name?: string
          position?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          ai_daily_limit: number
          allow_registrations: boolean
          app_name: string
          id: boolean
          maintenance_mode: boolean
          support_email: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_daily_limit?: number
          allow_registrations?: boolean
          app_name?: string
          id?: boolean
          maintenance_mode?: boolean
          support_email?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_daily_limit?: number
          allow_registrations?: boolean
          app_name?: string
          id?: boolean
          maintenance_mode?: boolean
          support_email?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_users: {
        Args: { _limit?: number; _search?: string }
        Returns: {
          created_at: string
          delivery_count: number
          email: string
          full_name: string
          is_blocked: boolean
          last_sign_in_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      admin_overview: { Args: never; Returns: Json }
      admin_set_user_access: {
        Args: {
          _blocked: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_update_settings: {
        Args: {
          _ai_daily_limit: number
          _allow_registrations: boolean
          _app_name: string
          _maintenance_mode: boolean
          _support_email: string
        }
        Returns: {
          ai_daily_limit: number
          allow_registrations: boolean
          app_name: string
          id: boolean
          maintenance_mode: boolean
          support_email: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "system_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_ai_scan_quota: { Args: { _limit: number }; Returns: number }
      get_my_system_access: { Args: never; Returns: Json }
      is_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      super_admin_update_module: {
        Args: { _enabled: boolean; _key: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "user"
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
      app_role: ["super_admin", "admin", "user"],
    },
  },
} as const
