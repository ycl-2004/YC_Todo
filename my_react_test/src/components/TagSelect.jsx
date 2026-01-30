import { useEffect, useRef, useState } from "react";

function TagSelect({ value, onChange, options = [], disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // click outside close
  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (t) => {
    onChange(t);
    setOpen(false);
  };

  return (
    <div className={`tag-dd ${disabled ? "is-disabled" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="tag-dd-btn"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Task tag"
        title="Tag"
      >
        <span className="tag-dd-label">{value}</span>
        <span className="tag-dd-caret">▾</span>
      </button>

      {open && !disabled && (
        <div className="tag-dd-pop" role="listbox">
          {options.map((t) => {
            const active = t === value;
            return (
              <button
                key={t}
                type="button"
                className={`tag-dd-item ${active ? "active" : ""}`}
                onClick={() => pick(t)}
              >
                <span className="tag-dd-tick">{active ? "✓" : ""}</span>
                <span>{t}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TagSelect;
