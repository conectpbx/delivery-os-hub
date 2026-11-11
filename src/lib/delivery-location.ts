import { geocodeAddress, reverseGeocodeAddress } from "./geo";

export function validCoordinates(lat: unknown, lng: unknown): [number, number] | null {
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const a = Number(lat),
    b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180
    ? [a, b]
    : null;
}
export function coordinateAddress(address: string) {
  const match = address.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  return match ? validCoordinates(match[1], match[2]) : null;
}
export async function resolveDeliveryLocation<
  T extends { address: string; lat: number | null; lng: number | null },
>(stop: T): Promise<T> {
  const coordinates = validCoordinates(stop.lat, stop.lng) ?? coordinateAddress(stop.address);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (coordinates) {
    const [lat, lng] = coordinates;
    if (stop.address.trim() && !coordinateAddress(stop.address)) return { ...stop, lat, lng };
    const place = offline ? null : await reverseGeocodeAddress(lat, lng);
    return { ...stop, lat, lng, address: place?.address || "" };
  }
  if (offline || !stop.address.trim()) return stop;
  const place = await geocodeAddress(stop.address);
  return place ? { ...stop, lat: place.lat, lng: place.lng } : stop;
}
