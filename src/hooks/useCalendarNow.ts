import { useEffect, useState } from "react";

const nextLocalDayDelay = (now: Date) => {
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(0, 0, 0, 0);
  return Math.max(1, nextDay.getTime() - now.getTime());
};

/**
 * Keeps calendar-based views current even when the application remains open
 * across midnight. Visibility and focus refreshes also cover suspended mobile
 * browser timers.
 */
export function useCalendarNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const refresh = () => {
      const current = new Date();
      setNow(current);
      clearTimeout(timeout);
      timeout = setTimeout(refresh, nextLocalDayDelay(current) + 50);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    timeout = setTimeout(refresh, nextLocalDayDelay(new Date()) + 50);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return now;
}
