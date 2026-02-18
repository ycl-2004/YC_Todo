import { useEffect, useRef } from "react";
import TagManager from "./TagManager";

export default function TagBar({
  tags,
  setTags,
  activeTag,
  setActiveTag,
  disabled,
}) {
  // --- Drag reorder state (refs so it’s smooth)
  const dragFromRef = useRef(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  // Optional: if mouse up happens outside, reset
  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      dragFromRef.current = null;
      document.body.classList.remove("is-tag-reordering");
      // allow clicks again after drag finishes
      setTimeout(() => (suppressClickRef.current = false), 0);
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  const reorder = (fromTag, toTag) => {
    if (!fromTag || !toTag) return;
    if (fromTag === toTag) return;

    // pin All
    if (fromTag === "All" || toTag === "All") return;

    setTags((prev) => {
      const arr = [...prev];

      const from = arr.indexOf(fromTag);
      const to = arr.indexOf(toTag);
      if (from === -1 || to === -1) return prev;

      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);

      // safety: keep All at front
      const rest = arr.filter((t) => t !== "All");
      return ["All", ...rest];
    });
  };

  const onDragStart = (e, tag) => {
    if (disabled) return;
    if (tag === "All") return;

    draggingRef.current = true;
    dragFromRef.current = tag;
    suppressClickRef.current = true;

    document.body.classList.add("is-tag-reordering");

    // required for Safari/HTML5 DnD
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tag);
    } catch {
      // ignore
    }
  };

  const onDragEnd = () => {
    draggingRef.current = false;
    dragFromRef.current = null;
    document.body.classList.remove("is-tag-reordering");
    setTimeout(() => (suppressClickRef.current = false), 0);
  };

  const onDragOver = (e) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      // ignore
    }
  };

  const onDrop = (e, toTag) => {
    e.preventDefault();
    const fromTag = dragFromRef.current;
    reorder(fromTag, toTag);
    onDragEnd();
  };

  const onChipClick = (tag) => {
    if (disabled) return;
    if (suppressClickRef.current) return; // prevent accidental click after drag
    setActiveTag(tag);
  };

  return (
    <div className="tag-bar">
      {/* left scroll area */}
      <div className="tag-bar-left">
        {tags.map((t) => {
          const isActive = activeTag === t;
          const isAll = t === "All";

          return (
            <button
              key={t}
              type="button"
              className={`tag-chip ${isActive ? "active" : ""}`}
              onClick={() => onChipClick(t)}
              draggable={!disabled && !isAll}
              onDragStart={(e) => onDragStart(e, t)}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, t)}
              aria-current={isActive ? "true" : "false"}
              title={
                isAll ? "All (pinned)" : "Drag to reorder • Click to filter"
              }
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* right manager */}
      <div className="tag-bar-right">
        <TagManager
          tags={tags.filter((t) => t !== "All")} // manage only user tags
          setTags={(updater) => {
            // updater can be function or array, mimic React setState
            setTags((prev) => {
              const prevUser = prev.filter((x) => x !== "All");

              const nextUser =
                typeof updater === "function" ? updater(prevUser) : updater;

              // Always pin All first
              const dedup = Array.from(
                new Map(nextUser.map((x) => [String(x), String(x)])).values(),
              ).filter(Boolean);

              return ["All", ...dedup.filter((x) => x !== "All")];
            });
          }}
          activeTag={activeTag === "All" ? "All" : activeTag}
          setActiveTag={setActiveTag}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
