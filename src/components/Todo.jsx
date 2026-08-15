import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MdDelete,
  MdEdit,
  MdPlayArrow,
  MdPause,
  MdCheckCircle,
} from "react-icons/md";
import EditForm from "./EditForm.jsx";
import HoverCard, { useHoverIntent } from "./HoverCard.jsx";
import TipButton from "./TipButton.jsx";

function Todo({
  todo,
  order,
  hideOrder,
  tags = [],
  tagColors = {},
  deleteTodo,
  toggleComplete,
  toggleIsEditing,
  editTodo,
  onChangeTag,
  isLocked,
  isActive,
  canStart,
  status,
  onStart,
  onPause,
  onFinish,
  onBlockedStart,
  isTagPickerOpen,
  onToggleTagPicker,
  onCloseTagPicker,
  isKeyboardFocused = false,
  isNoteExpanded = false,
  onToggleNoteExpanded,

  // Pointer-drag reorder
  onPointerDragStart,
}) {
  const tagWrapRef = useRef(null);
  const tagBtnRef = useRef(null);
  const tagPickerRef = useRef(null);

  const textRef = useRef(null);
  const noteDownRef = useRef(null);

  const [openUp, setOpenUp] = useState(false);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0, width: 88 });

  const isNote = todo.type === "note";

  const preview = useHoverIntent({
    enabled: !todo.isEditing && !isTagPickerOpen && !(isNote && isNoteExpanded),
    openDelay: 380,
    closeDelay: 120,
  });

  const tagOptions = useMemo(() => {
    const base = Array.isArray(tags) ? tags : [];
    const current = todo.tag ?? "Study";
    return base.includes(current) ? base : [...base, current];
  }, [tags, todo.tag]);

  const chipStyleFor = (tag) => {
    const c = tagColors[tag];
    if (!c) return undefined;
    return {
      background: `color-mix(in srgb, ${c} 26%, var(--chip-bg))`,
      borderColor: `color-mix(in srgb, ${c} 52%, var(--chip-border))`,
    };
  };

  useEffect(() => {
    if (!isTagPickerOpen) return;

    const onDown = (e) => {
      if (tagWrapRef.current?.contains(e.target)) return;
      if (tagPickerRef.current?.contains(e.target)) return;
      onCloseTagPicker?.();
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isTagPickerOpen, onCloseTagPicker]);

  useEffect(() => {
    if (!isTagPickerOpen) return;

    const updatePosition = () => {
      const btn = tagBtnRef.current;
      if (!btn) return;

      const r = btn.getBoundingClientRect();
      const listRect = btn.closest(".now-list")?.getBoundingClientRect?.();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const gap = 6;
      const popW = 88;
      const itemH = 24;
      const popH = Math.min(6 + tagOptions.length * itemH, 160);

      const boundBottom = listRect ? listRect.bottom : vh;
      const boundTop = listRect ? listRect.top : 8;

      const spaceBelow = boundBottom - r.bottom - gap;
      const spaceAbove = r.top - boundTop - gap;
      const shouldOpenUp = spaceBelow < popH && spaceAbove > spaceBelow;

      let top = shouldOpenUp ? r.top - gap - popH : r.bottom + gap;
      // Anchor to button's left edge so popover appears directly above/below tag chip.
      let left = r.left;

      top = Math.max(8, Math.min(top, vh - popH - 8));
      left = Math.max(8, Math.min(left, vw - popW - 8));

      setOpenUp(shouldOpenUp);
      setPickerPos({ top, left, width: popW });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [isTagPickerOpen, tagOptions.length]);

  useEffect(() => {
    if (!isTagPickerOpen) return;
    if (!isLocked) return;
    onCloseTagPicker?.();
  }, [isLocked, isTagPickerOpen, onCloseTagPicker]);

  useEffect(() => {
    if (isTagPickerOpen) return;
    setOpenUp(false);
  }, [isTagPickerOpen]);

  if (todo.isEditing) {
    return (
      <div className="todo editing">
        <EditForm
          todo={todo}
          toggleIsEditing={toggleIsEditing}
          editTodo={editTodo}
          isLocked={isLocked}
        />
      </div>
    );
  }

  const disableRow = isLocked && !isActive;
  const isRunning = isActive && status === "running";
  const canEditTag =
    !todo.isCompleted && typeof onToggleTagPicker === "function";
  const canDrag = !isLocked && !todo.isCompleted;

  /* Only offer the preview when the text is actually cut off, otherwise
     every row would pop a card while scanning the list. */
  const handleTextEnter = () => {
    const el = textRef.current;
    if (!el) return;

    const truncated =
      el.scrollWidth > el.clientWidth + 1 ||
      el.scrollHeight > el.clientHeight + 1;

    if (truncated) preview.show();
  };

  const handleNoteClick = (e) => {
    const down = noteDownRef.current;
    noteDownRef.current = null;
    if (!isNote) return;
    // Ignore the click that ends a reorder drag.
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    preview.hideNow();
    onToggleNoteExpanded?.(todo.id);
  };

  const tagPickerPopover =
    canEditTag && isTagPickerOpen
      ? createPortal(
          <div
            ref={tagPickerRef}
            className={`todo-tag-picker open ${openUp ? "open-up" : ""}`}
            style={{
              top: `${pickerPos.top}px`,
              left: `${pickerPos.left}px`,
              width: `${pickerPos.width}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {tagOptions.map((t) => {
              const active = t === todo.tag;
              return (
                <button
                  key={t}
                  type="button"
                  className={`todo-tag-option ${active ? "active" : ""}`}
                  style={chipStyleFor(t)}
                  onClick={() => {
                    if (!active) onChangeTag?.(todo.id, t);
                    onCloseTagPicker?.();
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        className={[
          "todo",
          todo.isCompleted ? "completed" : "",
          disableRow ? "locked" : "",
          isTagPickerOpen ? "tag-picker-open" : "",
          isActive ? "is-active" : "",
          isNote ? "is-note" : "",
          isNote && isNoteExpanded ? "note-expanded" : "",
          isKeyboardFocused ? "kb-focused" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-todo-id={String(todo.id)}
        onPointerDown={(e) => {
          noteDownRef.current = { x: e.clientX, y: e.clientY };
          if (!canDrag) return;
          if (e.button !== 0) return;

          const tag = e.target?.tagName?.toLowerCase?.();
          if (
            tag === "button" ||
            tag === "input" ||
            tag === "svg" ||
            tag === "path"
          ) {
            return;
          }

          preview.hideNow();
          e.preventDefault();
          onPointerDragStart?.(todo.id, e.clientX, e.clientY);
        }}
      >
        <div className="todo-left">
          {!hideOrder && !todo.isCompleted && (
            <span className="drag-handle" aria-hidden="true">
              {order}
            </span>
          )}

          <input
            className="checkbox"
            type="checkbox"
            checked={todo.isCompleted}
            onChange={() => toggleComplete(todo.id)}
            disabled={isNote || disableRow || isLocked}
          />

          <div className="todo-main" onClick={handleNoteClick}>
            <span
              className="todo-text"
              ref={textRef}
              tabIndex={-1}
              onPointerEnter={handleTextEnter}
              onPointerLeave={preview.hide}
              onFocus={handleTextEnter}
              onBlur={preview.hideNow}
            >
              {todo.content}
            </span>

            {isNote && (
              <span className="todo-note-toggle" aria-hidden="true">
                ▶
              </span>
            )}
          </div>
        </div>

        <div className="todo-right">
          <div className="todo-badge-stack">
            {canEditTag ? (
              <div
                className={`todo-tag-wrap ${isTagPickerOpen ? "open" : ""}`}
                ref={tagWrapRef}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="todo-tag todo-tag-btn"
                  style={chipStyleFor(todo.tag)}
                  ref={tagBtnRef}
                  disabled={isLocked}
                  onClick={onToggleTagPicker}
                  title={
                    isLocked ? "Tag locked while timer is active" : "Edit tag"
                  }
                >
                  {todo.tag}
                </button>
              </div>
            ) : (
              <span className="todo-tag" style={chipStyleFor(todo.tag)}>
                {todo.tag}
              </span>
            )}
            <span className="todo-meta">
              {isNote ? "Note" : `${todo.minutes}m`}
            </span>
          </div>

          <div className="todo-actions">
            {!isNote && isActive ? (
              <>
                <TipButton
                  className="icon-btn"
                  onClick={isRunning ? onPause : onStart}
                  ariaLabel={isRunning ? "Pause" : "Start"}
                  tip={isRunning ? "Pause" : "Start"}
                >
                  {isRunning ? <MdPause /> : <MdPlayArrow />}
                </TipButton>

                <TipButton
                  className="icon-btn ok"
                  onClick={onFinish}
                  ariaLabel="Finish"
                  tip="Finish now"
                >
                  <MdCheckCircle />
                </TipButton>
              </>
            ) : !isNote ? (
              <TipButton
                className="icon-btn"
                onClick={() => (canStart ? onStart() : onBlockedStart?.(todo))}
                ariaLabel="Start"
                softDisabled={!canStart}
                tip={
                  canStart
                    ? "Start"
                    : "Strict mode runs tasks in order — click to see which one is next"
                }
              >
                <MdPlayArrow />
              </TipButton>
            ) : (
              <span className="icon-btn placeholder" aria-hidden="true" />
            )}

            <TipButton
              className="icon-btn secondary"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleIsEditing(todo.id);
              }}
              ariaLabel="Edit"
              tip="Edit"
              disabled={isLocked}
            >
              <MdEdit />
            </TipButton>

            <TipButton
              className="icon-btn danger secondary"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                deleteTodo(todo.id);
              }}
              ariaLabel="Delete"
              tip="Delete"
              disabled={isLocked}
            >
              <MdDelete />
            </TipButton>
          </div>
        </div>
      </div>

      <HoverCard
        anchorRef={textRef}
        open={preview.open}
        className="preview"
        boundsSelector=".menu-card"
        interactive
        onRequestClose={preview.hideNow}
        onPointerEnter={preview.show}
        onPointerLeave={preview.hide}
      >
        <div className="hover-card-text">{todo.content}</div>
        <div className="hover-card-meta">
          <span>{todo.tag}</span>
          <span>{isNote ? "Note" : `${todo.minutes}m`}</span>
          {!hideOrder && !todo.isCompleted && <span>#{order}</span>}
        </div>
      </HoverCard>

      {tagPickerPopover}
    </>
  );
}

export default Todo;
