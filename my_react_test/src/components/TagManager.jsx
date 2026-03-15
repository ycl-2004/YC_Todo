import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function normalizeTag(s) {
  return String(s ?? "").trim();
}

const TAG_SWATCHES = [
  "#B9C36B",
  "#B890D8",
  "#D8B18A",
  "#9FB7EE",
  "#D89FBC",
  "#7FC8A9",
  "#E39D9D",
  "#AFA7D8",
];

function TagManager({
  tags = [],
  setTags,
  activeTag,
  setActiveTag,
  disabled,
  tagColors = {},
  setTagColor,
  onRenameTag,
  onDeleteTag,
}) {
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState(null); // tag string
  const [draft, setDraft] = useState("");
  const [paletteOpenTag, setPaletteOpenTag] = useState(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0, width: 214 });
  const [palettePos, setPalettePos] = useState({ top: 0, left: 0 });

  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const paletteRef = useRef(null);
  const rowDragRef = useRef(null);
  const rowHoverRef = useRef(null);
  const rowDraggingRef = useRef(false);
  const rowPendingRef = useRef(null);

  const ROW_DRAG_THRESHOLD = 6;

  const computeManagerPos = () => {
    const btn = wrapRef.current?.querySelector(".tag-mgr-btn");
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    const popW = Math.min(214, vw - 24);
    const popH = Math.min(240, Math.max(140, vh - 230));
    const openUp = vh - r.bottom < popH + gap;

    let top = openUp ? r.top - popH - gap : r.bottom + gap;
    let left = r.right - popW;

    top = Math.max(8, Math.min(top, vh - popH - 8));
    left = Math.max(8, Math.min(left, vw - popW - 8));

    setPopPos({ top, left, width: popW });
  };

  const computePalettePos = (dotEl) => {
    if (!dotEl) return;
    const r = dotEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    const popW = 188;
    const popH = 36;
    const openUp = vh - r.bottom < popH + gap;

    let top = openUp ? r.top - popH - gap : r.bottom + gap;
    let left = r.left + r.width / 2 - popW / 2;

    top = Math.max(8, Math.min(top, vh - popH - 8));
    left = Math.max(8, Math.min(left, vw - popW - 8));
    setPalettePos({ top, left });
  };

  // click outside close
  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      if (paletteRef.current?.contains(e.target)) return;
      setOpen(false);
      setEditing(null);
      setPaletteOpenTag(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const lowerSet = useMemo(
    () => new Set(tags.map((t) => t.toLowerCase())),
    [tags],
  );

  const addOne = () => {
    const t = normalizeTag(newTag);
    if (!t) return;

    // avoid duplicates (case-insensitive)
    if (lowerSet.has(t.toLowerCase())) {
      setNewTag("");
      return;
    }

    setTags((prev) => [...prev, t]);
    setNewTag("");
  };

  const startRename = (t) => {
    setEditing(t);
    setDraft(t);
    setPaletteOpenTag(null);
  };

  const commitRename = () => {
    if (!editing) return;

    const next = normalizeTag(draft);
    if (!next) return;

    // if changed to duplicate -> ignore
    const nextLower = next.toLowerCase();
    if (nextLower !== editing.toLowerCase() && lowerSet.has(nextLower)) return;

    setTags((prev) => prev.map((x) => (x === editing ? next : x)));
    onRenameTag?.(editing, next);

    // keep activeTag consistent
    if (activeTag === editing) setActiveTag(next);

    setEditing(null);
    setPaletteOpenTag(null);
  };

  const removeTag = (t) => {
    const fallbackTag = tags.find((x) => x !== t) ?? "Study";
    setTags((prev) => prev.filter((x) => x !== t));
    onDeleteTag?.(t, fallbackTag);

    // if deleting active -> go to All
    if (activeTag === t) setActiveTag("All");
    if (paletteOpenTag === t) setPaletteOpenTag(null);
  };

  const togglePalette = (tag, evt) => {
    if (paletteOpenTag === tag) {
      setPaletteOpenTag(null);
      return;
    }

    const dot = evt.currentTarget;
    computePalettePos(dot);
    setPaletteOpenTag(tag);
  };

  const reorderManagerTags = (fromTag, toTag) => {
    if (!fromTag || !toTag || fromTag === toTag) return;

    setTags((prev) => {
      const arr = [...prev];
      const fromIndex = arr.indexOf(fromTag);
      const toIndex = arr.indexOf(toTag);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return arr;
    });
  };

  const rowPointerMoveHandler = (e) => {
    const pending = rowPendingRef.current;
    if (!pending) return;

    if (!rowDraggingRef.current) {
      const dx = e.clientX - pending.x;
      const dy = e.clientY - pending.y;
      const dist = Math.hypot(dx, dy);
      if (dist < ROW_DRAG_THRESHOLD) return;

      rowDraggingRef.current = true;
      rowDragRef.current = pending.tag;
      rowHoverRef.current = null;
      document.body.classList.add("is-tag-mgr-reordering");
      e.preventDefault();
    }

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = el?.closest?.("[data-tag-row]");
    const toTag = rowEl?.getAttribute?.("data-tag-row");
    if (!toTag) return;

    const fromTag = rowDragRef.current;
    if (!fromTag || fromTag === toTag) return;
    if (rowHoverRef.current === toTag) return;

    rowHoverRef.current = toTag;
    reorderManagerTags(fromTag, toTag);
  };

  const rowPointerUpHandler = () => {
    rowPendingRef.current = null;
    rowDraggingRef.current = false;
    rowDragRef.current = null;
    rowHoverRef.current = null;
    document.body.classList.remove("is-tag-mgr-reordering");

    window.removeEventListener("pointermove", rowPointerMoveHandler);
    window.removeEventListener("pointerup", rowPointerUpHandler);
  };

  const startRowPointerDrag = (tag, startX, startY) => {
    if (disabled) return;
    if (!tag || editing || paletteOpenTag) return;

    rowPendingRef.current = { tag, x: startX, y: startY };

    window.addEventListener("pointermove", rowPointerMoveHandler, {
      passive: false,
    });
    window.addEventListener("pointerup", rowPointerUpHandler);
  };

  useEffect(() => {
    if (!open) return;
    const onRecalc = () => computeManagerPos();
    window.addEventListener("resize", onRecalc);
    document.addEventListener("scroll", onRecalc, true);
    onRecalc();
    return () => {
      window.removeEventListener("resize", onRecalc);
      document.removeEventListener("scroll", onRecalc, true);
    };
  }, [open]);

  useEffect(() => {
    if (!paletteOpenTag) return;
    const onRecalc = () => {
      const dot = popRef.current?.querySelector(
        `[data-tag-dot="${CSS.escape(paletteOpenTag)}"]`,
      );
      computePalettePos(dot);
    };
    window.addEventListener("resize", onRecalc);
    document.addEventListener("scroll", onRecalc, true);
    onRecalc();
    return () => {
      window.removeEventListener("resize", onRecalc);
      document.removeEventListener("scroll", onRecalc, true);
    };
  }, [paletteOpenTag]);

  useEffect(() => {
    const onCloseTransient = () => {
      setOpen(false);
      setEditing(null);
      setPaletteOpenTag(null);
    };

    window.addEventListener("ui://close-transient-panels", onCloseTransient);
    return () =>
      window.removeEventListener(
        "ui://close-transient-panels",
        onCloseTransient,
      );
  }, []);

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-tag-mgr-reordering");
      window.removeEventListener("pointermove", rowPointerMoveHandler);
      window.removeEventListener("pointerup", rowPointerUpHandler);
    };
  }, []);

  return (
    <div className={`tag-mgr ${disabled ? "is-disabled" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="tag-mgr-btn"
        onClick={() => {
          if (disabled) return;
          setOpen((v) => {
            const next = !v;
            if (next) setTimeout(() => computeManagerPos(), 0);
            return next;
          });
        }}
        disabled={disabled}
        aria-label="Manage tags"
        title="Manage tags"
      >
        ⚙︎
      </button>

      {open && !disabled
        ? createPortal(
            <div
              ref={popRef}
              className="tag-mgr-pop"
              style={{
                position: "fixed",
                top: `${popPos.top}px`,
                left: `${popPos.left}px`,
                width: `${popPos.width}px`,
              }}
            >
          <div className="tag-mgr-head">
            <div className="tag-mgr-title">Customize Tag</div>
            <button
              type="button"
              className="tag-mgr-x"
              onClick={() => {
                setOpen(false);
                setEditing(null);
                setPaletteOpenTag(null);
              }}
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* add row */}
          <div className="tag-mgr-add">
            <input
              className="tag-mgr-input"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add new tag…"
              onKeyDown={(e) => {
                if (e.key === "Enter") addOne();
                if (e.key === "Escape") setNewTag("");
              }}
            />
            <button
              type="button"
              className="tag-mgr-add-btn"
              onClick={addOne}
              disabled={!normalizeTag(newTag)}
            >
              Add
            </button>
          </div>

          <div className="tag-mgr-list" role="list">
            {tags.map((t) => {
              const isEditing = editing === t;

              return (
                <div
                  className={`tag-mgr-row ${!isEditing ? "is-draggable" : ""}`}
                  key={t}
                  data-tag-row={t}
                  onPointerDown={(e) => {
                    if (isEditing) return;
                    if (e.button !== 0) return;

                    const interactive = e.target?.closest?.(
                      "button, input, textarea, select",
                    );
                    if (interactive) return;

                    startRowPointerDrag(t, e.clientX, e.clientY);
                  }}
                >
                  {isEditing ? (
                    <>
                      <input
                        className="tag-mgr-rename"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <div className="tag-mgr-actions">
                        <button
                          type="button"
                          className="tag-mgr-mini"
                          onClick={commitRename}
                          title="Save"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="tag-mgr-mini ghost"
                          onClick={() => setEditing(null)}
                          title="Cancel"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="tag-mgr-name-row">
                        <button
                          type="button"
                          className="tag-mgr-color-dot"
                          style={{ "--tag-color": tagColors[t] ?? "#B9C36B" }}
                          data-tag-dot={t}
                          onClick={(e) => togglePalette(t, e)}
                          title="Change color"
                          aria-label={`Change color for ${t}`}
                        />
                        <div className="tag-mgr-name">{t}</div>
                      </div>
                      <div className="tag-mgr-actions">
                        <button
                          type="button"
                          className="tag-mgr-mini ghost"
                          onClick={() => startRename(t)}
                          title="Rename"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="tag-mgr-mini danger"
                          onClick={() => removeTag(t)}
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="tag-mgr-hint">Tip: tags are case-insensitive.</div>
        </div>,
            document.body,
          )
        : null}

      {open && paletteOpenTag
        ? createPortal(
            <div
              ref={paletteRef}
              className="tag-mgr-palette"
              role="radiogroup"
              style={{
                top: `${palettePos.top}px`,
                left: `${palettePos.left}px`,
              }}
            >
              {TAG_SWATCHES.map((c) => {
                const active =
                  (tagColors[paletteOpenTag] ?? "").toLowerCase() ===
                  c.toLowerCase();
                return (
                  <button
                    key={`${paletteOpenTag}-${c}`}
                    type="button"
                    className={`tag-mgr-swatch ${active ? "active" : ""}`}
                    style={{ "--swatch-color": c }}
                    aria-label={`${paletteOpenTag} ${c}`}
                    title={c}
                    onClick={() => {
                      setTagColor?.(paletteOpenTag, c);
                      setPaletteOpenTag(null);
                    }}
                  />
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default TagManager;
