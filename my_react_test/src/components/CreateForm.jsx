import { useState } from "react";
import MinuteSelect from "./MinuteSelect";

const TAG_OPTIONS = ["Study", "Exam", "Life", "Daily", "Other"];

function CreateForm({ addTodo, isLocked }) {
  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [tag, setTag] = useState("Study"); // ✅ NEW

  const isValid = task.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLocked) return;

    addTodo(task.trim(), Number(minutes), tag); // ✅ pass tag
    setTask("");
  };

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Add a task…"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        disabled={isLocked}
        autoFocus
      />

      {/* ✅ NEW: Tag select */}
      <select
        className="tag-select"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        disabled={isLocked}
        aria-label="Task tag"
        title="Tag"
      >
        {TAG_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <MinuteSelect
        value={minutes}
        onChange={setMinutes}
        disabled={isLocked}
        ariaLabel="Task minutes"
      />

      <button
        type="submit"
        disabled={!isValid || isLocked}
        aria-label="Add task"
      >
        +
      </button>
    </form>
  );
}

export default CreateForm;
