import { useEffect, useMemo, useRef, useState } from "react";

function normalizeTag(s) {
  return String(s ?? "").trim();
}

function TagManager({ tags = [], setTags, activeTag, setActiveTag, disabled }) {
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState(null); // tag string
  const [draft, setDraft] = useState("");

  const wrapRef = useRef(null);

  // click outside close
  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target)) return;
      setOpen(false);
      setEditing(null);
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
  };

  const commitRename = () => {
    if (!editing) return;

    const next = normalizeTag(draft);
    if (!next) return;

    // if changed to duplicate -> ignore
    const nextLower = next.toLowerCase();
    if (nextLower !== editing.toLowerCase() && lowerSet.has(nextLower)) return;

    setTags((prev) => prev.map((x) => (x === editing ? next : x)));

    // keep activeTag consistent
    if (activeTag === editing) setActiveTag(next);

    setEditing(null);
  };

  const removeTag = (t) => {
    setTags((prev) => prev.filter((x) => x !== t));

    // if deleting active -> go to All
    if (activeTag === t) setActiveTag("All");
  };

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
                      <div className="tag-mgr-name">{t}</div>
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
    </div>
  );
}

export default TagManager;
