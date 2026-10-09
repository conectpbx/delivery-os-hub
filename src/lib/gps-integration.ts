import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GpsDevice = {
  id: string;
  device_name: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
};

export type GpsDeviceState = {
  token_id: string;
  source: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  speed_kmh: number | null;
  trip_km: number;
  total_km: number;
  captured_at: string;
  sent_at: string;
  received_at: string;
};

export type CreatedGpsDevice = GpsDevice & { token: string };

export function useGpsDevices() {
  return useQuery({
    queryKey: ["gps-devices"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_gps_devices");
      if (error) throw error;
      return (data ?? []) as GpsDevice[];
    },
    staleTime: 30_000,
  });
}

export function useGpsDeviceState(tracking = false, tokenId?: string) {
  return useQuery({
    queryKey: ["gps-device-state", tokenId ?? "latest"],
    queryFn: async () => {
      let query = supabase
        .from("gps_device_state")
        .select(
          "token_id,source,latitude,longitude,accuracy_m,speed_kmh,trip_km,total_km,captured_at,sent_at,received_at",
        );
      if (tokenId) query = query.eq("token_id", tokenId);
      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as GpsDeviceState | null;
    },
    refetchInterval: tracking ? 2_000 : 10_000,
    refetchIntervalInBackground: tracking,
    staleTime: 5_000,
  });
}

export function useCreateGpsDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deviceName: string) => {
      const { data, error } = await supabase.rpc("create_my_gps_device_token", {
        _device_name: deviceName.trim(),
      });
      if (error) throw error;
      const created = data?.[0];
      if (!created) throw new Error("Não foi possível criar a conexão.");
      return { ...created, is_active: true, last_used_at: null } as CreatedGpsDevice;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gps-devices"] }),
  });
}

export function useRevokeGpsDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      const { data, error } = await supabase.rpc("revoke_my_gps_device_token", {
        _token_id: tokenId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gps-devices"] });
      await queryClient.invalidateQueries({ queryKey: ["gps-device-state"] });
    },
  });
}
