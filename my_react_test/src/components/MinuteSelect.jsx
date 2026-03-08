import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const QUICK_PRESETS = [25, 45, 60, 90];
const MIN_TOTAL = 1;
const MAX_TOTAL = 600;

function clamp(n, a, b) {
  return Math.max(a, Math.min(n, b));
}

function splitTotalMinutes(total) {
  const t = clamp(Number(total) || 0, MIN_TOTAL, MAX_TOTAL);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return { h, m };
}

function formatBtnLabel(total) {
  const { h, m } = splitTotalMinutes(total);
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function MinuteSelect({
  value,
  onChange,
  disabled,
  ariaLabel = "Minutes",
  anchorRef,
  placement = "anchor",
  buttonRef,
  onDone,
  onOpenChange,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 186 });
  const [inputMinutes, setInputMinutes] = useState(String(value ?? 25));

  const rootRef = useRef(null);
  const dialRef = useRef(null);
  const draggingRef = useRef(false);

  const setOpenSafe = (next) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const getAnchorEl = () => {
    const fallbackBtn = rootRef.current?.querySelector(".minute-btn");
    return anchorRef?.current || buttonRef?.current || fallbackBtn;
  };

  const updatePosition = () => {
    const popW = 186;
    const popH = 230;
    const gap = 8;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const el = getAnchorEl();
    if (!el) return;

    const r = el.getBoundingClientRect();

    if (placement === "edit") {
      let top = Math.round(r.bottom + gap);
      let left = Math.round(r.left + r.width / 2 - popW / 2);

      left = Math.max(8, Math.min(left, vw - popW - 8));
      top = Math.max(8, Math.min(top, vh - popH - 8));

      setPos({ top, left, width: popW });
      return;
    }

    const openUp = vh - r.bottom < popH + gap;

    let top = openUp ? r.top - gap - popH : r.bottom + gap;
    let left = r.right - popW;

    left = Math.max(8, Math.min(left, vw - popW - 8));
    top = Math.max(8, Math.min(top, vh - popH - 8));

    setPos({ top, left, width: popW });
  };

  useEffect(() => {
    setInputMinutes(String(clamp(Number(value) || MIN_TOTAL, MIN_TOTAL, MAX_TOTAL)));
  }, [value]);

  useEffect(() => {
    const onDown = (e) => {
      const pop = document.getElementById("minute-popover");
      if (rootRef.current?.contains(e.target)) return;
      if (pop?.contains(e.target)) return;
      setOpenSafe(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open || disabled) return;

    const onKey = (e) => {
      if (e.isComposing) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpenSafe(false);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        setOpenSafe(false);
        onDone?.();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();

        const next = clamp(
          Number(value) + (e.key === "ArrowDown" ? 1 : -1),
          MIN_TOTAL,
          MAX_TOTAL,
        );
        onChange(next);
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, disabled, value, onChange, onDone]);

  useEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setByStep = (delta) => {
    const next = clamp(Number(value) + delta, MIN_TOTAL, MAX_TOTAL);
    onChange(next);
  };

  const onInputChange = (raw) => {
    const digits = raw.replace(/\D/g, "");
    setInputMinutes(digits);
    if (!digits) return;
    const next = clamp(Number(digits), MIN_TOTAL, MAX_TOTAL);
    onChange(next);
  };

  const commitInput = () => {
    const next = clamp(Number(inputMinutes) || MIN_TOTAL, MIN_TOTAL, MAX_TOTAL);
    setInputMinutes(String(next));
    onChange(next);
  };

  const progress = useMemo(() => {
    const v = clamp(Number(value), MIN_TOTAL, MAX_TOTAL);
    return (v - MIN_TOTAL) / (MAX_TOTAL - MIN_TOTAL);
  }, [value]);

  const R = 56;
  const C = 2 * Math.PI * R;
  const dash = C * progress;
  const angle = progress * 360;

  const toValueFromPoint = (clientX, clientY) => {
    const el = dialRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = clientX - cx;
    const dy = clientY - cy;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    deg = (deg + 450) % 360;

    const p = clamp(deg / 360, 0, 1);
    const next = Math.round(MIN_TOTAL + p * (MAX_TOTAL - MIN_TOTAL));
    onChange(clamp(next, MIN_TOTAL, MAX_TOTAL));
  };

  const handleDialPointerDown = (e) => {
    draggingRef.current = true;
    toValueFromPoint(e.clientX, e.clientY);

    const onMove = (ev) => {
      if (!draggingRef.current) return;
      toValueFromPoint(ev.clientX, ev.clientY);
    };

    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleClosedKeyDown = (e) => {
    if (disabled) return;
    if (open) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpenSafe(true);
    }
  };

  const popover = open && !disabled && (
    <div
      id="minute-popover"
      className="minute-pop"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="minute-pop-headrow">
        <div className="minute-pop-header">Minutes</div>
        <label className="minute-direct-input">
          <input
            type="text"
            inputMode="numeric"
            value={inputMinutes}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={commitInput}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              commitInput();
            }}
            aria-label="Minutes input"
          />
          <span>m</span>
        </label>
      </div>

      <div className="minute-quick-row">
        {QUICK_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={`minute-quick ${Number(value) === m ? "active" : ""}`}
            onClick={() => onChange(m)}
          >
            {m}m
          </button>
        ))}
      </div>

      <div className="minute-dial-wrap">
        <div
          ref={dialRef}
          className="minute-dial"
          onPointerDown={handleDialPointerDown}
        >
          <svg className="minute-dial-svg" viewBox="0 0 140 140" aria-hidden="true">
            <circle cx="70" cy="70" r={R} className="dial-track" />
            <circle
              cx="70"
              cy="70"
              r={R}
              className="dial-progress"
              strokeDasharray={`${dash} ${C}`}
            />
            <g transform={`rotate(${angle} 70 70)`}>
              <circle cx="70" cy="14" r="6" className="dial-knob" />
            </g>
          </svg>

          <div className="minute-dial-center">{formatBtnLabel(value)}</div>
        </div>
      </div>

      <div className="minute-slider-row">
        <input
          className="minute-slider"
          type="range"
          min={MIN_TOTAL}
          max={MAX_TOTAL}
          step={1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>

      <div className="minute-stepper-row">
        <button type="button" className="minute-step" onClick={() => setByStep(-10)}>
          -10m
        </button>
        <button type="button" className="minute-step" onClick={() => setByStep(-5)}>
          -5m
        </button>
        <button type="button" className="minute-step" onClick={() => setByStep(5)}>
          +5m
        </button>
        <button type="button" className="minute-step" onClick={() => setByStep(10)}>
          +10m
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`minute-select ${disabled ? "is-disabled" : ""}`}
      onKeyDown={handleClosedKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        className="minute-btn"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpenSafe(!open)}
      >
        <span>{formatBtnLabel(value)}</span>
        <span className="chev">▾</span>
      </button>

      {open ? createPortal(popover, document.body) : null}
    </div>
  );
}
