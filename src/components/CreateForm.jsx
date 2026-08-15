import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core"; // ✅ NEW
import { listen } from "@tauri-apps/api/event";
import MinuteSelect from "./MinuteSelect";
import TagSelect from "./TagSelect";

function CreateForm({
  addTodo,
  isLocked,
  tags,
  tagColors = {},
  activeTag = "All",
}) {
  const formRef = useRef(null);
  const inputRef = useRef(null);

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

  useEffect(() => {
    if (!tags?.length) return;
    if (activeTag === "All") return;
    if (!tags.includes(activeTag)) return;
    setTag(activeTag);
  }, [activeTag, tags]);

  useEffect(() => {
    let disposed = false;

    const focusTaskInput = () => {
      if (isLocked) return;

      const run = () => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
      };

      requestAnimationFrame(() => {
        run();
        window.setTimeout(run, 30);
      });
    };

    (async () => {
      const un = await listen("ui://focus-create-task", () => {
        focusTaskInput();
      });

      if (disposed) {
        un();
        return;
      }

      window.__unlistenFocusCreateTask = un;
    })();

    return () => {
      disposed = true;
      if (window.__unlistenFocusCreateTask) {
        try {
          window.__unlistenFocusCreateTask();
        } catch {}
        window.__unlistenFocusCreateTask = null;
      }
    };
  }, [isLocked]);

  return (
    <form ref={formRef} className="create-form" onSubmit={handleSubmit}>
      <div className="create-form-top">
        <input
          ref={inputRef}
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
            if (e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;

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
