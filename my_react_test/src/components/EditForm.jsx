import { useState } from "react";
import MinuteSelect from "./MinuteSelect";

function EditForm({ todo, editTodo, toggleIsEditing, isLocked }) {
  const [task, setTask] = useState(todo.content);
  const [minutes, setMinutes] = useState(Number(todo.minutes ?? 25));

  const isValid = task.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLocked) return;
    editTodo(todo.id, task.trim(), Number(minutes));
  };

  return (
    <form className="edit-form edit-inline" onSubmit={handleSubmit}>
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
