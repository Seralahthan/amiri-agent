import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/** Custom Warm Alabaster + Forest Emerald dropdown replacing native OS <select> in filter bars.
 *  Snug fit-content trigger (no dead whitespace), smooth 160ms ease-out popover, emerald selection & Staging the Focus hover. */
export function SelectMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(() => Math.max(0, options.findIndex(o => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find(o => o.value === value) ?? options[0];

  const hiRef = useRef(hi);
  hiRef.current = hi;
  // on opening, the highlight starts on the current value (once: not again after each arrow key or hover)
  useEffect(() => { if (open) setHi(Math.max(0, options.findIndex(o => o.value === value))); }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      const root = rootRef.current, at = document.activeElement;
      if (!root?.contains(at)) return;  // keys typed elsewhere on the page aren't the dropdown's
      if (e.key === "ArrowDown") { e.preventDefault(); setHi(i => Math.min(options.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHi(i => Math.max(0, i - 1)); }
      // on a focused option, the button's own click picks it; on the trigger, Enter picks the highlighted one
      else if (e.key === "Enter" && !(at as HTMLElement).closest(".eos-dd-opt") && options[hiRef.current]) {
        e.preventDefault(); onChange(options[hiRef.current].value); setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, options, onChange]);

  return (
    <div className="eos-dd" ref={rootRef} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="eos-dd-btn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        data-active={value !== "" ? "true" : "false"}
        onClick={() => setOpen(o => !o)}
      >
        {current?.icon}
        <span>{current?.label ?? label}</span>
        <Icon name="chevron" className="eos-dd-chev" />
      </button>
      {open && (
        <ul className="eos-dd-menu" id={listId} role="listbox" aria-label={label}>
          {options.map((opt, idx) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value || "__all"} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className="eos-dd-opt"
                  data-selected={selected ? "true" : "false"}
                  data-hi={idx === hi ? "true" : "false"}
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {opt.icon}
                    <span>{opt.label}</span>
                  </span>
                  {selected && <Icon name="check" className="eos-dd-chk" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
