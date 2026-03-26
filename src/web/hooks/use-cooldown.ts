import { useState, useRef, useCallback } from 'react';

/**
 * 쿨다운 훅
 * @param ms 쿨다운 시간 (ms), 기본 10초
 * @returns { trigger, remaining, ready }
 *   - trigger(fn): 쿨다운 중이면 무시, 아니면 fn 실행 후 쿨다운 시작
 *   - remaining: 남은 초 (0이면 ready)
 *   - ready: 쿨다운 아니면 true
 */
export function useCooldown(ms = 10_000) {
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endRef = useRef<number>(0);

  const trigger = useCallback((fn: () => void) => {
    if (remaining > 0) return;
    fn();
    endRef.current = Date.now() + ms;
    setRemaining(Math.ceil(ms / 1000));
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const left = Math.ceil((endRef.current - Date.now()) / 1000);
      if (left <= 0) {
        setRemaining(0);
        timerRef.current && clearInterval(timerRef.current);
      } else {
        setRemaining(left);
      }
    }, 500);
  }, [remaining, ms]);

  return { trigger, remaining, ready: remaining === 0 };
}
