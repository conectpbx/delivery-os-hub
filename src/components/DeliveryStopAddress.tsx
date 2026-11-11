import { useQuery } from "@tanstack/react-query";
import { coordinateAddress, resolveDeliveryLocation } from "@/lib/delivery-location";
import { stopLocation, type StoredStop } from "@/lib/delivery-records";

export function DeliveryStopAddress({ stop }: { stop: StoredStop }) {
  const needsAddress = !stop.address?.trim() || Boolean(coordinateAddress(stop.address));
  const address = useQuery({
    queryKey: ["delivery-stop-address", stop.lat, stop.lng, stop.address],
    enabled: needsAddress,
    queryFn: () => resolveDeliveryLocation(stop),
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
  return <>{stopLocation(address.data ?? stop)}</>;
}
