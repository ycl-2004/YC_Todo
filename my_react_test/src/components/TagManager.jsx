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
  const [palettePos, setPalettePos] = useState({ top: 0, left: 0 });

  const wrapRef = useRef(null);
  const paletteRef = useRef(null);

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

  useEffect(() => {
    if (!paletteOpenTag) return;
    const onRecalc = () => {
      const dot = wrapRef.current?.querySelector(
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

  return (
    <div className={`tag-mgr ${disabled ? "is-disabled" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="tag-mgr-btn"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Manage tags"
        title="Manage tags"
      >
        ⚙︎
      </button>

      {open && !disabled && (
        <div className="tag-mgr-pop">
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
                <div className="tag-mgr-row" key={t}>
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
        </div>
      )}

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
