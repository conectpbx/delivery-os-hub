import { useRouter } from "@tanstack/react-router";
import { BrandLoading } from "./BrandLoader";

/** Read the already-cached profile without making navigation wait for another request. */
export function RouteLoading() {
  const router = useRouter();
  const profile = router.options.context?.queryClient.getQueryData<{ vehicle?: string | null }>([
    "profile",
  ]);
  return <BrandLoading vehicle={profile?.vehicle} label="Abrindo tela…" />;
}
