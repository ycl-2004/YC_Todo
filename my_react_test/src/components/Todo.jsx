import { useEffect, useMemo, useRef } from "react";
import {
  MdDelete,
  MdEdit,
  MdPlayArrow,
  MdPause,
  MdCheckCircle,
} from "react-icons/md";
import EditForm from "./EditForm.jsx";

function Todo({
  todo,
  order,
  hideOrder,
  tags = [],
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
  isTagPickerOpen,
  onToggleTagPicker,
  onCloseTagPicker,

  // ✅ Pointer-drag reorder（用 wrapper 那套）
  onPointerDragStart,
}) {
  const tagWrapRef = useRef(null);

  const tagOptions = useMemo(() => {
    const base = Array.isArray(tags) ? tags : [];
    const curr = todo.tag ?? "Study";
    return base.includes(curr) ? base : [...base, curr];
  }, [tags, todo.tag]);

  useEffect(() => {
    if (!isTagPickerOpen) return;

    const onDown = (e) => {
      if (!tagWrapRef.current) return;
      if (tagWrapRef.current.contains(e.target)) return;
      onCloseTagPicker?.();
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isTagPickerOpen, onCloseTagPicker]);

  useEffect(() => {
    if (!isTagPickerOpen) return;
    if (!isLocked) return;
    onCloseTagPicker?.();
  }, [isLocked, isTagPickerOpen, onCloseTagPicker]);

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

  const canDrag = !isLocked && !todo.isCompleted;

  return (
    <div
      className={`todo ${todo.isCompleted ? "completed" : ""} ${
        disableRow ? "locked" : ""
      } ${isTagPickerOpen ? "tag-picker-open" : ""}`}
      data-todo-id={String(todo.id)}
      onPointerDown={(e) => {
        if (!canDrag) return;
        if (e.button !== 0) return;

        const tag = e.target?.tagName?.toLowerCase?.();
        if (
          tag === "button" ||
          tag === "input" ||
          tag === "svg" ||
          tag === "path"
        )
          return;

        e.preventDefault();
        onPointerDragStart?.(todo.id, e.clientX, e.clientY);
      }}
    >
      <div className="todo-left">
        {/* ✅ Only show order badge when NOT completed + NOT hidden */}
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
          disabled={disableRow || isLocked}
        />

        <div className="todo-main">
          <span className="todo-text" title={todo.content}>
            {todo.content}
          </span>
        </div>
      </div>

      <div className="todo-right">
        <div className="todo-badge-stack">
          <div
            className={`todo-tag-wrap ${isTagPickerOpen ? "open" : ""}`}
            ref={tagWrapRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="todo-tag todo-tag-btn"
              disabled={isLocked}
              onClick={onToggleTagPicker}
              title={isLocked ? "Tag locked while timer is active" : "Edit tag"}
            >
              {todo.tag}
            </button>

            <div className={`todo-tag-picker ${isTagPickerOpen ? "open" : ""}`}>
              {tagOptions.map((t) => {
                const active = t === todo.tag;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`todo-tag-option ${active ? "active" : ""}`}
                    onClick={() => {
                      if (!active) onChangeTag?.(todo.id, t);
                      onCloseTagPicker?.();
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <span className="todo-meta">{todo.minutes}m</span>
        </div>
        <div className="todo-actions">
          {isActive ? (
            <>
              <button
                className="icon-btn"
                onClick={isRunning ? onPause : onStart}
                aria-label={isRunning ? "Pause" : "Start"}
                title={isRunning ? "Pause" : "Start"}
              >
                {isRunning ? <MdPause /> : <MdPlayArrow />}
              </button>

              <button
                className="icon-btn ok"
                onClick={onFinish}
                aria-label="Finish"
                title="Finish"
              >
                <MdCheckCircle />
              </button>
            </>
          ) : (
            <button
              className="icon-btn"
              onClick={onStart}
              aria-label="Start"
              title={canStart ? "Start" : "Start (only the next task in order)"}
              disabled={!canStart || isLocked}
            >
              <MdPlayArrow />
            </button>
          )}

          <button
            className="icon-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleIsEditing(todo.id);
            }}
            aria-label="Edit"
            title="Edit"
            disabled={isLocked}
          >
            <MdEdit />
          </button>

          <button
            className="icon-btn danger"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              deleteTodo(todo.id);
            }}
            aria-label="Delete"
            title="Delete"
            disabled={isLocked}
          >
            <MdDelete />
          </button>
        </div>
      </div>
    </div>
  );
}

export default Todo;
