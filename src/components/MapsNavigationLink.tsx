import { useEffect, useState, type ReactNode } from "react";
import { mapsLink } from "@/lib/maps-link";

export function MapsNavigationLink({
  href,
  children,
  ...props
}: {
  href: string;
  children: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"a">, "href" | "children" | "target">) {
  const [android, setAndroid] = useState(false);
  useEffect(() => {
    setAndroid(/Android/i.test(navigator.userAgent));
  }, []);
  const destination = mapsLink(href, android);
  return (
    <a
      {...props}
      href={destination}
      target={destination.startsWith("intent:") ? undefined : "_blank"}
      rel="noopener noreferrer"
      title="Abrir rota no Google Maps"
    >
      {children}
    </a>
  );
}
