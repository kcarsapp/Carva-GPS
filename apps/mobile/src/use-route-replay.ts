import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { Position } from './types';

export function useRouteReplay(deviceId: number | undefined, hours: number) {
  const [points, setPoints] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setPlaying(false);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
      const route = await api.route(deviceId, from.toISOString(), to.toISOString());
      const sorted = route.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).sort((a, b) => +new Date(a.fixTime) - +new Date(b.fixTime));
      setPoints(sorted);
      setIndex(Math.max(0, sorted.length - 1));
      setError(null);
    } catch (cause) {
      setPoints([]);
      setIndex(0);
      setError(cause instanceof Error ? cause.message : 'Route history is unavailable');
    } finally {
      setLoading(false);
    }
  }, [deviceId, hours]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!playing || points.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= points.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 420);
    return () => clearInterval(timer);
  }, [playing, points.length]);

  const activePoint = points[index];
  const progress = points.length > 1 ? index / (points.length - 1) : 0;
  const summary = useMemo(() => ({ points: points.length, startedAt: points[0]?.fixTime, endedAt: points.at(-1)?.fixTime }), [points]);
  return { points, activePoint, progress, index, setIndex, playing, setPlaying, loading, error, refresh, summary };
}
