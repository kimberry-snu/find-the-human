import { useEffect, useState } from 'react';

export function useCountdown(endsAt: number | null): number {
  const [remaining, setRemaining] = useState(() =>
    endsAt === null ? 0 : Math.max(0, endsAt - Date.now()),
  );

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(0);
      return undefined;
    }

    const update = () => setRemaining(Math.max(0, endsAt - Date.now()));
    update();
    const intervalId = window.setInterval(update, 250);

    return () => window.clearInterval(intervalId);
  }, [endsAt]);

  return remaining;
}
