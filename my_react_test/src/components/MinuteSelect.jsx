import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const QUICK_PRESETS = [25, 45, 60, 90];

// Total minutes settings (value is STILL total minutes)
const MIN_TOTAL = 1;
const MAX_TOTAL = 600;

// Wheel settings
const ITEM_H = 36;
const WHEEL_VISIBLE = 5; // keep odd
const CENTER_ROW = Math.floor(WHEEL_VISIBLE / 2); // 2
const WHEEL_PAD = CENTER_ROW * ITEM_H; // 72px top/bottom pad to make 58/59 easier

function clamp(n, a, b) {
  return Math.max(a, Math.min(n, b));
}

function buildRange(min, max) {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
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
  value, // total minutes
  onChange,
  disabled,
  ariaLabel = "Minutes",

  // positioning
  anchorRef, // optional external anchor
  placement = "anchor", // "anchor" | "edit"

  // refs + callbacks
  buttonRef, // optional ref passed from parent
  onDone, // optional: Enter while open => close + notify parent (not used in your EditForm now)

  onOpenChange, // ✅ NEW: report open state to parent
}) {
  const MAX_HOURS = Math.floor(MAX_TOTAL / 60);
  const hoursOptions = useMemo(() => buildRange(0, MAX_HOURS), [MAX_HOURS]);
  const minutesOptions = useMemo(() => buildRange(0, 59), []);

  const [open, setOpen] = useState(false);

  const rootRef = useRef(null);
  const hourWheelRef = useRef(null);
  const minWheelRef = useRef(null);

  const programmaticRef = useRef(false);
  const rafRef = useRef(0);

  const [pos, setPos] = useState({ top: 0, left: 0, width: 180 });

  const [hourHighlightTop, setHourHighlightTop] = useState(CENTER_ROW * ITEM_H);
  const [minHighlightTop, setMinHighlightTop] = useState(CENTER_ROW * ITEM_H);

  // ✅ IMPORTANT: always use this to open/close so parent can track timeOpen
  const setOpenSafe = (next) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const getAnchorEl = () => {
    const fallbackBtn = rootRef.current?.querySelector(".minute-btn");
    return anchorRef?.current || buttonRef?.current || fallbackBtn;
  };

  const updatePosition = () => {
    const popW = 180;
    const popH = 290;
    const gap = 6;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const el = getAnchorEl();
    if (!el) return;

    const r = el.getBoundingClientRect();

    // ✅ placement="edit": show under the time button (and clamp)
    if (placement === "edit") {
      const gap2 = 10;

      let top = Math.round(r.bottom + gap2);
      let left = Math.round(r.left + r.width / 2 - popW / 2);

      left = Math.max(8, Math.min(left, vw - popW - 8));
      top = Math.max(8, Math.min(top, vh - popH - 8));

      setPos({ top, left, width: popW });
      return;
    }

    // ✅ default dropdown behavior (anchor)
    const openUp = vh - r.bottom < popH + gap;

    let top = openUp ? r.top - gap - popH : r.bottom + gap;
    let left = r.right - popW;

    left = Math.max(8, Math.min(left, vw - popW - 8));
    top = Math.max(8, Math.min(top, vh - popH - 8));

    setPos({ top, left, width: popW });
  };

  // close on outside click
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

  // ✅ KEYBOARD (works even when focus is inside the portal)
  // capture + stopPropagation => EditForm will NOT receive Enter when picker is open
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
          MAX_TOTAL
        );

        onChange(next);

        const { h, m } = splitTotalMinutes(next);
        scrollToIdx(hourWheelRef.current, h, "smooth");
        scrollToIdx(minWheelRef.current, m, "smooth");
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, disabled, value, onChange, onDone, onOpenChange]);

  // wheel scroll speed boost
  useEffect(() => {
    if (!open) return;

    const SPEED = 2.4;

    const bindWheel = (el) => {
      if (!el) return () => {};
      const onWheel = (e) => {
        if (e.ctrlKey) return;
        e.preventDefault();
        el.scrollTop += e.deltaY * SPEED;
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    };

    const offH = bindWheel(hourWheelRef.current);
    const offM = bindWheel(minWheelRef.current);

    return () => {
      offH();
      offM();
    };
  }, [open]);

  const maxScrollTop = (wheel) => {
    if (!wheel) return 0;
    return wheel.scrollHeight - wheel.clientHeight;
  };

  const idxFromScrollTop = (optionsLen, scrollTop) => {
    const idx = Math.round(
      (scrollTop - WHEEL_PAD + CENTER_ROW * ITEM_H) / ITEM_H
    );
    return clamp(idx, 0, optionsLen - 1);
  };

  const scrollToIdx = (wheel, idx, behavior = "auto") => {
    if (!wheel) return;

    const maxScroll = maxScrollTop(wheel);
    const ideal = WHEEL_PAD + idx * ITEM_H - CENTER_ROW * ITEM_H;
    const top = clamp(ideal, 0, Math.max(0, maxScroll));

    programmaticRef.current = true;
    wheel.scrollTo({ top, behavior });

    window.setTimeout(
      () => {
        programmaticRef.current = false;
      },
      behavior === "auto" ? 0 : 220
    );
  };

  const updateHighlight = (wheel, optionsLen, setHighlightTop) => {
    if (!wheel) return;

    const idx = idxFromScrollTop(optionsLen, wheel.scrollTop);
    const itemTop = WHEEL_PAD + idx * ITEM_H - wheel.scrollTop;

    const maxScroll = maxScrollTop(wheel);
    const ideal = WHEEL_PAD + idx * ITEM_H - CENTER_ROW * ITEM_H;
    const clamped = clamp(ideal, 0, Math.max(0, maxScroll));
    const isEdge = clamped !== ideal;

    setHighlightTop(isEdge ? itemTop : WHEEL_PAD + CENTER_ROW * ITEM_H);
  };

  const setByHM = (h, m, behavior = "auto") => {
    const total = clamp(h * 60 + m, MIN_TOTAL, MAX_TOTAL);
    onChange(total);

    const { h: hh, m: mm } = splitTotalMinutes(total);
    scrollToIdx(hourWheelRef.current, hh, behavior);
    scrollToIdx(minWheelRef.current, mm, behavior);

    updateHighlight(
      hourWheelRef.current,
      hoursOptions.length,
      setHourHighlightTop
    );
    updateHighlight(
      minWheelRef.current,
      minutesOptions.length,
      setMinHighlightTop
    );
  };

  // open: position + center wheels
  useEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);

    requestAnimationFrame(() => {
      const { h, m } = splitTotalMinutes(value);
      scrollToIdx(hourWheelRef.current, h, "auto");
      scrollToIdx(minWheelRef.current, m, "auto");

      updateHighlight(
        hourWheelRef.current,
        hoursOptions.length,
        setHourHighlightTop
      );
      updateHighlight(
        minWheelRef.current,
        minutesOptions.length,
        setMinHighlightTop
      );
    });

    return () => window.removeEventListener("resize", updatePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // value change: sync wheels
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const { h, m } = splitTotalMinutes(value);
      scrollToIdx(hourWheelRef.current, h, "auto");
      scrollToIdx(minWheelRef.current, m, "auto");

      updateHighlight(
        hourWheelRef.current,
        hoursOptions.length,
        setHourHighlightTop
      );
      updateHighlight(
        minWheelRef.current,
        minutesOptions.length,
        setMinHighlightTop
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open]);

  // scroll -> live select (hours)
  useEffect(() => {
    if (!open) return;
    const wheel = hourWheelRef.current;
    if (!wheel) return;

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        updateHighlight(wheel, hoursOptions.length, setHourHighlightTop);
        if (programmaticRef.current) return;

        const hIdx = idxFromScrollTop(hoursOptions.length, wheel.scrollTop);
        const h = hoursOptions[hIdx];

        const { m } = splitTotalMinutes(value);
        setByHM(h, m, "auto");
      });
    };

    wheel.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafRef.current);
      wheel.removeEventListener("scroll", onScroll);
    };
  }, [open, hoursOptions, value]);

  // scroll -> live select (minutes)
  useEffect(() => {
    if (!open) return;
    const wheel = minWheelRef.current;
    if (!wheel) return;

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        updateHighlight(wheel, minutesOptions.length, setMinHighlightTop);
        if (programmaticRef.current) return;

        const mIdx = idxFromScrollTop(minutesOptions.length, wheel.scrollTop);
        const m = minutesOptions[mIdx];

        const { h } = splitTotalMinutes(value);
        setByHM(h, m, "auto");
      });
    };

    wheel.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafRef.current);
      wheel.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, minutesOptions, value]);

  // Only for: closed state -> Enter/Space opens (optional)
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
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
      }}
    >
      <div className="minute-pop-header">Minutes</div>

      <div className="minute-quick-row">
        {QUICK_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={`minute-quick ${Number(value) === m ? "active" : ""}`}
            onClick={() => {
              onChange(m);
              const { h, m: mm } = splitTotalMinutes(m);
              scrollToIdx(hourWheelRef.current, h, "smooth");
              scrollToIdx(minWheelRef.current, mm, "smooth");
            }}
          >
            {m}m
          </button>
        ))}
      </div>

      <div className="minute-divider" />

      <div className="minute-slider-row">
        <input
          className="minute-slider"
          type="range"
          min={MIN_TOTAL}
          max={MAX_TOTAL}
          value={Number(value)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(v);

            const { h, m } = splitTotalMinutes(v);
            scrollToIdx(hourWheelRef.current, h, "auto");
            scrollToIdx(minWheelRef.current, m, "auto");
          }}
        />
        <div className="minute-slider-value">{formatBtnLabel(value)}</div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {/* Hours wheel */}
        <div
          className="minute-wheel"
          ref={hourWheelRef}
          aria-label="Hour picker"
          style={{
            width: "50%",
            paddingTop: WHEEL_PAD,
            paddingBottom: WHEEL_PAD,
          }}
        >
          {hoursOptions.map((h) => {
            const activeH = splitTotalMinutes(value).h;
            return (
              <button
                key={h}
                type="button"
                className={`minute-wheel-item ${activeH === h ? "active" : ""}`}
                onClick={() => {
                  const { m } = splitTotalMinutes(value);
                  setByHM(h, m, "smooth");
                }}
              >
                {h}h
              </button>
            );
          })}

          <div
            className="minute-wheel-highlight"
            style={{ top: `${hourHighlightTop}px` }}
            aria-hidden="true"
          />
        </div>

        {/* Minutes wheel */}
        <div
          className="minute-wheel"
          ref={minWheelRef}
          aria-label="Minute picker"
          style={{
            width: "50%",
            paddingTop: WHEEL_PAD,
            paddingBottom: WHEEL_PAD,
          }}
        >
          {minutesOptions.map((m) => {
            const activeM = splitTotalMinutes(value).m;
            return (
              <button
                key={m}
                type="button"
                className={`minute-wheel-item ${activeM === m ? "active" : ""}`}
                onClick={() => {
                  const { h } = splitTotalMinutes(value);
                  setByHM(h, m, "smooth");
                }}
              >
                {m}m
              </button>
            );
          })}

          <div
            className="minute-wheel-highlight"
            style={{ top: `${minHighlightTop}px` }}
            aria-hidden="true"
          />
        </div>
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
        onClick={() => setOpenSafe(!open)} // ✅ IMPORTANT
      >
        <span>{formatBtnLabel(value)}</span>
        <span className="chev">▾</span>
      </button>

      {open ? createPortal(popover, document.body) : null}
    </div>
  );
}
