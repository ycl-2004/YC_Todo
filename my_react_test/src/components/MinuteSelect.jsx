import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const QUICK_PRESETS = [25, 45, 60, 90];

function buildMinuteOptions() {
  const fine = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
  const coarse = Array.from({ length: 18 }, (_, i) => 35 + i * 5); // 35..120
  return Array.from(new Set([...QUICK_PRESETS, ...fine, ...coarse])).sort(
    (a, b) => a - b,
  );
}

export default function MinuteSelect({
  value,
  onChange,
  disabled,
  ariaLabel = "Minutes",
}) {
  const baseOptions = useMemo(() => buildMinuteOptions(), []);
  const options = useMemo(() => {
    const set = new Set(baseOptions);
    set.add(Number(value));
    return Array.from(set).sort((a, b) => a - b);
  }, [baseOptions, value]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  // popover position (fixed)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 180 });

  const updatePosition = () => {
    const btn = rootRef.current?.querySelector(".minute-btn");
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const popW = 200; // dropdown width
    const popH = 240; // approx height (header + list max-height)
    const gap = 8;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // prefer open down; if not enough space, open up
    const spaceBelow = vh - r.bottom;
    const openUp = spaceBelow < popH + gap;

    let top = openUp ? r.top - gap - popH : r.bottom + gap;

    // align right edge with button right edge
    let left = r.right - popW;

    // clamp within viewport
    left = Math.max(8, Math.min(left, vw - popW - 8));
    top = Math.max(8, Math.min(top, vh - popH - 8));

    setPos({ top, left, width: popW });
  };

  // click outside to close
  useEffect(() => {
    const onDocDown = (e) => {
      if (!rootRef.current) return;
      const pop = document.getElementById("minute-popover");
      if (rootRef.current.contains(e.target)) return;
      if (pop && pop.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  // when open: position + keep selected visible + listen resize
  useEffect(() => {
    if (!open) return;

    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);

    // small delay so DOM is ready
    setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-value="${value}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }, 0);

    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const handleKeyDown = (e) => {
    if (disabled) return;

    if (!open && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const idx = options.indexOf(Number(value));
      const next =
        e.key === "ArrowDown"
          ? options[Math.min(options.length - 1, idx + 1)]
          : options[Math.max(0, idx - 1)];
      onChange(next);
    }
  };

  const popover = open && !disabled && (
    <div
      id="minute-popover"
      className="minute-pop"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
      }}
      role="listbox"
      ref={listRef}
    >
      <div className="minute-pop-header">Minutes</div>

      <div className="minute-pop-list">
        {QUICK_PRESETS.map((m) => (
          <button
            key={`q-${m}`}
            type="button"
            className={`minute-item ${Number(value) === m ? "active" : ""}`}
            data-value={m}
            onClick={() => {
              onChange(m);
              setOpen(false);
            }}
          >
            <span>{m}m</span>
            {Number(value) === m && <span className="tick">✓</span>}
          </button>
        ))}

        <div className="minute-divider" />

        {options.map((m) => (
          <button
            key={m}
            type="button"
            className={`minute-item ${Number(value) === m ? "active" : ""}`}
            data-value={m}
            onClick={() => {
              onChange(m);
              setOpen(false);
            }}
          >
            <span>{m}m</span>
            {Number(value) === m && <span className="tick">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className={`minute-select ${disabled ? "is-disabled" : ""}`}
      ref={rootRef}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="minute-btn"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value}m</span>
        <span className="chev">▾</span>
      </button>

      {open ? createPortal(popover, document.body) : null}
    </div>
  );
}
