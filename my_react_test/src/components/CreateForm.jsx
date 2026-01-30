import { useEffect, useState } from "react";
import MinuteSelect from "./MinuteSelect";
import TagSelect from "./TagSelect";

function CreateForm({ addTodo, isLocked, tags }) {
  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [tag, setTag] = useState(tags?.[0] ?? "Study");

  const isValid = task.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLocked) return;

    addTodo(task.trim(), Number(minutes), tag);
    setTask("");
  };

  useEffect(() => {
    // 如果目前選到的 tag 被刪掉了，就回到第一個 tag
    if (!tags?.length) return;
    if (!tags.includes(tag)) setTag(tags[0]);
  }, [tags, tag]);

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

      <TagSelect
        value={tag}
        onChange={setTag}
        options={tags}
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
