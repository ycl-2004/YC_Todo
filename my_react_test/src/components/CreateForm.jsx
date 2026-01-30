import { useState } from "react";
import MinuteSelect from "./MinuteSelect";
import TagSelect from "./TagSelect";

const TAG_OPTIONS = ["Study", "Exam", "Life", "Daily", "Other"];

function CreateForm({ addTodo, isLocked }) {
  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [tag, setTag] = useState("Study");

  const isValid = task.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLocked) return;

    addTodo(task.trim(), Number(minutes), tag);
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

      {/* ✅ Custom Tag Select */}
      <TagSelect
        value={tag}
        onChange={setTag}
        options={TAG_OPTIONS}
        disabled={isLocked}
      />

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
