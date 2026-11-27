// Unified SearchInput with Variation 1: Emerald Scan Beam + Morphing Spinner + Clear Button.
import { useEffect, useRef, useState } from "react";

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  count,
  loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  count?: number;
  loading?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [typing, setTyping] = useState(false);
  const timerRef = useRef<number>(0);
  const prevVal = useRef(value);

  useEffect(() => {
    if (value === prevVal.current) return;
    prevVal.current = value;
    window.clearTimeout(timerRef.current);
    if (!value.trim()) {
      setTyping(false);
      return;
    }
    setTyping(true);
    timerRef.current = window.setTimeout(() => setTyping(false), 360);
    return () => window.clearTimeout(timerRef.current);
  }, [value]);

  const hasVal = value.trim().length > 0;
  const searching = loading || typing;

  return (
    <div className={`eos-search${searching ? " is-searching" : ""}${hasVal ? " has-val" : ""}`}>
      <svg className="eos-s-mag" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="4.8" />
        <path d="m10.7 10.7 3.2 3.2" />
      </svg>
      <svg className="eos-s-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M8 2a6 6 0 1 1-4.24 1.76" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
      />
      {hasVal && !searching && count !== undefined && (
        <span className="eos-s-cnt" aria-hidden="true">{count} found</span>
      )}
      <span className="sr" role="status" aria-live="polite">{hasVal && !searching && count !== undefined ? `${count} found` : ""}</span>
      {hasVal && (
        <button
          type="button"
          className="eos-s-clr"
          aria-label="Clear search"
          title="Clear"
          onClick={() => { onChange(""); inputRef.current?.focus(); }}
        >
          ×
        </button>
      )}
      <span className="eos-s-beam" aria-hidden="true" />
    </div>
  );
}
