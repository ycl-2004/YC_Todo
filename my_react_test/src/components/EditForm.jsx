import { useRef, useState } from "react";
import MinuteSelect from "./MinuteSelect";

const formRef = useRef(null);

function EditForm({ todo, editTodo, toggleIsEditing, isLocked }) {
  const [task, setTask] = useState(todo.content);
  const [minutes, setMinutes] = useState(Number(todo.minutes ?? 25));

  const isValid = task.trim().length > 0;

  // ✅ ref to the REAL time button in edit mode
  const timeBtnRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLocked) return;
    editTodo(todo.id, task.trim(), Number(minutes));
  };

  return (
    <form
      ref={formRef}
      className="edit-form edit-inline"
      onSubmit={handleSubmit}
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
        buttonRef={timeBtnRef} // ✅ MUST
        anchorRef={timeBtnRef} // ✅ optional but helps fallback
        onDone={() => {
          // ✅ press Enter in popover => Save form
          formRef.current?.requestSubmit?.();
        }}
      />

      <button
        type="button"
        className="btn ghost"
        onClick={() => toggleIsEditing(todo.id)}
        disabled={isLocked}
      >
        Cancel
      </button>

      <button type="submit" className="btn" disabled={!isValid || isLocked}>
        Save
      </button>
    </form>
  );
}

export default EditForm;
