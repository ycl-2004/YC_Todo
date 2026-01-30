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
  deleteTodo,
  toggleComplete,
  toggleIsEditing,
  editTodo,
  isLocked,
  isActive,
  canStart,
  status,
  onStart,
  onPause,
  onFinish,

  // ✅ Pointer-drag reorder（用 wrapper 那套）
  onPointerDragStart,
}) {
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
      }`}
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
          <span className="todo-tag">{todo.tag}</span>
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
            onClick={() => toggleIsEditing(todo.id)}
            aria-label="Edit"
            title="Edit"
            disabled={isLocked}
          >
            <MdEdit />
          </button>

          <button
            className="icon-btn danger"
            onClick={() => deleteTodo(todo.id)}
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
