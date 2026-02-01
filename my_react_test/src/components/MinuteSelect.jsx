import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const QUICK_PRESETS = [25, 45, 60, 90];

// Wheel settings
const MIN_MINUTES = 1;
const MAX_MINUTES = 180;
const ITEM_H = 36;
const WHEEL_VISIBLE = 5; // keep odd
const CENTER_ROW = Math.floor(WHEEL_VISIBLE / 2); // 2

function buildMinuteOptions() {
  return Array.from(
    { length: MAX_MINUTES - MIN_MINUTES + 1 },
    (_, i) => MIN_MINUTES + i,
  );
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(n, b));
}

export default function MinuteSelect({
  value,
  onChange,
  disabled,
  ariaLabel = "Minutes",
}) {
  const options = useMemo(() => buildMinuteOptions(), []);
  const [open, setOpen] = useState(false);

  const rootRef = useRef(null);
  const wheelRef = useRef(null);

  const programmaticRef = useRef(false);
  const rafRef = useRef(0);
  const lastIdxRef = useRef(-1);

  const [pos, setPos] = useState({ top: 0, left: 0, width: 180 });

  // ✅ highlight 位置：默认在中间；到边界时跟着 item 走
  const [highlightTop, setHighlightTop] = useState(CENTER_ROW * ITEM_H);

  const updatePosition = () => {
    const btn = rootRef.current?.querySelector(".minute-btn");
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const popW = 180;
    const popH = 290;
    const gap = 6;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

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
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ✅ 核心：把 idx 对齐到中心行（但到边界要 clamp，避免出现 gap）
  const scrollToIdx = (idx, behavior = "auto") => {
    const wheel = wheelRef.current;
    if (!wheel) return;

    const maxScroll = wheel.scrollHeight - wheel.clientHeight;

    // 理想：让 idx 落在中心行
    const ideal = idx * ITEM_H - CENTER_ROW * ITEM_H;

    // clamp：顶到底不留空
    const top = clamp(ideal, 0, Math.max(0, maxScroll));

    programmaticRef.current = true;
    lastIdxRef.current = idx;

    wheel.scrollTo({ top, behavior });

    window.setTimeout(
      () => {
        programmaticRef.current = false;
      },
      behavior === "auto" ? 0 : 220,
    );
  };

  const centerToMinute = (m, behavior = "auto") => {
    const idx = clamp(Number(m) - MIN_MINUTES, 0, options.length - 1);
    scrollToIdx(idx, behavior);
  };

  // ✅ 根据 wheel.scrollTop 计算 idx（中心行取整）
  const idxFromScrollTop = (scrollTop) => {
    const idx = Math.round((scrollTop + CENTER_ROW * ITEM_H) / ITEM_H);
    return clamp(idx, 0, options.length - 1);
  };

  // ✅ highlight：中间固定；但到边界时跟着 item 走（不出现空白感）
  const updateHighlight = () => {
    const wheel = wheelRef.current;
    if (!wheel) return;

    const idx = idxFromScrollTop(wheel.scrollTop);
    const itemCenterY = idx * ITEM_H - wheel.scrollTop; // item 顶部相对 wheel
    // 我们要 highlightTop 是 item 的 top（让框贴着 item）
    // 但正常情况保持在中间
    const maxScroll = wheel.scrollHeight - wheel.clientHeight;
    const ideal = idx * ITEM_H - CENTER_ROW * ITEM_H;

    const clamped = clamp(ideal, 0, Math.max(0, maxScroll));
    const isEdge = clamped !== ideal;

    if (isEdge) {
      // 贴着真实 item（边界）
      setHighlightTop(itemCenterY);
    } else {
      // 永远中间
      setHighlightTop(CENTER_ROW * ITEM_H);
    }
  };

  // open: position + center
  useEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);

    requestAnimationFrame(() => {
      centerToMinute(Number(value), "auto");
      updateHighlight();
    });

    return () => window.removeEventListener("resize", updatePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // value change: keep wheel synced (slider/quick)
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      centerToMinute(Number(value), "auto");
      updateHighlight();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open]);

  // scroll -> live select
  useEffect(() => {
    if (!open) return;
    const wheel = wheelRef.current;
    if (!wheel) return;

    const onScroll = () => {
      if (programmaticRef.current) {
        updateHighlight();
        return;
      }

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const idx = idxFromScrollTop(wheel.scrollTop);

        updateHighlight();

        if (idx === lastIdxRef.current) return;
        lastIdxRef.current = idx;

        const next = options[idx];
        if (next !== Number(value)) onChange(next);
      });
    };

    wheel.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafRef.current);
      wheel.removeEventListener("scroll", onScroll);
    };
  }, [open, options, onChange, value]);

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
      const next = clamp(
        Number(value) + (e.key === "ArrowDown" ? 1 : -1),
        MIN_MINUTES,
        MAX_MINUTES,
      );
      onChange(next);
      centerToMinute(next, "smooth");
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
              centerToMinute(m, "smooth");
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
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          value={Number(value)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange(v);
            centerToMinute(v, "auto");
          }}
        />
        <div className="minute-slider-value">{value}m</div>
      </div>

      <div className="minute-wheel" ref={wheelRef} aria-label="Minute picker">
        {options.map((m) => (
          <button
            key={m}
            type="button"
            className={`minute-wheel-item ${Number(value) === m ? "active" : ""}`}
            onClick={() => {
              onChange(m);
              centerToMinute(m, "smooth");
            }}
          >
            {m}m
          </button>
        ))}

        {/* ✅ highlight：平常在中间；到边界跟着 item 走 */}
        <div
          className="minute-wheel-highlight"
          style={{ top: `${highlightTop}px` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`minute-select ${disabled ? "is-disabled" : ""}`}
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
