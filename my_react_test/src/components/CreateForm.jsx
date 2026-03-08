import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core"; // ✅ NEW
import MinuteSelect from "./MinuteSelect";
import TagSelect from "./TagSelect";

function CreateForm({ addTodo, isLocked, tags, tagColors = {} }) {
  const formRef = useRef(null);

  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [tag, setTag] = useState(tags?.[0] ?? "Study");
  const [entryType, setEntryType] = useState("task");

  const isValid = task.trim().length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLocked) return;

    addTodo(
      task.trim(),
      entryType === "task" ? Number(minutes) : null,
      tag,
      entryType,
    );
    setTask("");
  };

  useEffect(() => {
    if (!tags?.length) return;
    if (!tags.includes(tag)) setTag(tags[0]);
  }, [tags, tag]);

  return (
    <form ref={formRef} className="create-form" onSubmit={handleSubmit}>
      <div className="create-form-top">
        <input
          type="text"
          placeholder="Add a task…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={isLocked}
          autoFocus
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (e.isComposing) return;
            if (isLocked) return;

            if (task.trim().length === 0) {
              e.preventDefault();
              e.stopPropagation();
              invoke("hide_popover_cmd");
            }
          }}
        />

        <button
          type="submit"
          disabled={!isValid || isLocked}
          aria-label="Add task"
        >
          +
        </button>
      </div>

      <div className="create-form-bottom">
        <TagSelect
          value={tag}
          onChange={setTag}
          options={tags}
          disabled={isLocked}
          tagColors={tagColors}
        />

        <div className="entry-type-switch" role="tablist" aria-label="Entry type">
          <button
            type="button"
            className={`entry-type-btn ${entryType === "task" ? "active" : ""}`}
            onClick={() => setEntryType("task")}
            disabled={isLocked}
          >
            Task
          </button>
          <button
            type="button"
            className={`entry-type-btn ${entryType === "note" ? "active" : ""}`}
            onClick={() => setEntryType("note")}
            disabled={isLocked}
          >
            Note
          </button>
        </div>

        {entryType === "task" ? (
          <MinuteSelect
            value={minutes}
            onChange={setMinutes}
            disabled={isLocked}
            ariaLabel="Task minutes"
            onDone={() => {
              formRef.current?.requestSubmit?.();
            }}
          />
        ) : (
          <div className="create-time-placeholder" aria-hidden="true" />
        )}
      </div>
    </form>
  );
}

export default CreateForm;
