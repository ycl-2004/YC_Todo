import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core"; // ✅ NEW
import MinuteSelect from "./MinuteSelect";
import TagSelect from "./TagSelect";

function CreateForm({ addTodo, isLocked, tags, tagColors = {} }) {
  const formRef = useRef(null);

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
    if (!tags?.length) return;
    if (!tags.includes(tag)) setTag(tags[0]);
  }, [tags, tag]);

  return (
    <form ref={formRef} className="create-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Add a task…"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        disabled={isLocked}
        autoFocus
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (e.isComposing) return; // ✅ 中文输入法选字时不触发
          if (isLocked) return;

          // ✅ 输入框为空：Enter => 收起整个 app（popover）
          if (task.trim().length === 0) {
            e.preventDefault(); // 不要 submit form
            e.stopPropagation(); // 不要让事件冒泡到别处
            invoke("hide_popover_cmd");
          }
          // ✅ 有内容：不拦截，让它正常 submit（走 handleSubmit）
        }}
      />

      <TagSelect
        value={tag}
        onChange={setTag}
        options={tags}
        disabled={isLocked}
        tagColors={tagColors}
      />

      <MinuteSelect
        value={minutes}
        onChange={setMinutes}
        disabled={isLocked}
        ariaLabel="Task minutes"
        onDone={() => {
          // ✅ press Enter in time popover => submit add task
          formRef.current?.requestSubmit?.();
        }}
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
