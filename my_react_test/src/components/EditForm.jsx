import { useEffect, useRef, useState } from "react";
import MinuteSelect from "./MinuteSelect";

function EditForm({ todo, editTodo, toggleIsEditing, isLocked }) {
  const [task, setTask] = useState(todo.content);
  const [minutes, setMinutes] = useState(Number(todo.minutes ?? 25));
  const [timeOpen, setTimeOpen] = useState(false);

  const isValid = task.trim().length > 0;

  const commitSave = () => {
    if (isLocked) return;
    if (!isValid) return;

    // ✅ 这里会更新 todo + 在 TodoWrapper 里把 isEditing 设回 false
    editTodo(todo.id, task.trim(), Number(minutes));
  };

  const onKeyDownCapture = (e) => {
    if (isLocked) return;
    if (e.key !== "Enter") return;
    if (e.isComposing) return;
    if (timeOpen) return; // MinuteSelect open 时不处理

    e.preventDefault();
    commitSave();
  };

  return (
    <div
      className="edit-form edit-inline"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDownCapture={onKeyDownCapture}
    >
      <input
        type="text"
        placeholder="Edit task…"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        disabled={isLocked}
        autoFocus
      />

      <MinuteSelect
        value={minutes}
        onChange={setMinutes}
        disabled={isLocked}
        ariaLabel="Edit minutes"
        placement="edit"
        onOpenChange={setTimeOpen}
      />

      <button
        type="button"
        className="btn ghost"
        onClick={() => toggleIsEditing(todo.id)}
        disabled={isLocked}
      >
        Cancel
      </button>

      {/* ✅ 关键：用 onClick，不用 submit */}
      <button
        type="button"
        className="btn"
        disabled={!isValid || isLocked}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          commitSave();
        }}
      >
        Save
      </button>
    </div>
  );
}

export default EditForm;
