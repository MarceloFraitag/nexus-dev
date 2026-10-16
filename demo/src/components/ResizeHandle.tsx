import { useEffect, useRef } from 'react';

type Props = {
  label: string; value: number; min: number; max: number;
  onChange: (value: number) => void; axis?: 'x' | 'y'; reverse?: boolean; className?: string;
};

// A captura mantém o arraste ativo mesmo fora da divisória.
export function ResizeHandle({ label, value, min, max, onChange, axis = 'x', reverse = false, className = '' }: Props) {
  const drag = useRef<{ coordinate: number; value: number } | null>(null);
  const pending = useRef<number | null>(null);
  useEffect(() => () => { if (pending.current !== null) cancelAnimationFrame(pending.current); }, []);
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return <div className={`resize-handle resize-${axis} ${className}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { coordinate: axis === 'x' ? event.clientX : event.clientY, value };
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      const next = drag.current.value + ((axis === 'x' ? event.clientX : event.clientY) - drag.current.coordinate) * (reverse ? -1 : 1);
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = requestAnimationFrame(() => { update(next); pending.current = null; });
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const direction = axis === 'x' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
      const delta = direction[event.key as keyof typeof direction];
      if (delta) { event.preventDefault(); update(value + delta * (reverse ? -1 : 1) * 20); }
      if (event.key === 'Home') { event.preventDefault(); update(min); }
      if (event.key === 'End') { event.preventDefault(); update(max); }
    }}/ >;
}
