import { useEffect, useRef, useState } from "react";
import MinuteSelect from "./MinuteSelect";

function EditForm({ todo, editTodo, toggleIsEditing, isLocked }) {
  const [task, setTask] = useState(todo.content);
  const [minutes, setMinutes] = useState(Number(todo.minutes ?? 25));
  const [timeOpen, setTimeOpen] = useState(false);

  const wrapRef = useRef(null); // ✅ NEW

  const isValid = task.trim().length > 0;

  const commitSave = () => {
    if (isLocked) return;
    if (!isValid) return;
    editTodo(todo.id, task.trim(), Number(minutes));
  };

  // ✅ NEW: global Enter-to-save while edit mode is active
  useEffect(() => {
    if (isLocked) return;

    const onDocKeyDown = (e) => {
      if (e.key !== "Enter") return;
      if (e.isComposing) return;
      if (timeOpen) return; // MinuteSelect open 时不保存
      if (!isValid) return;

      const root = wrapRef.current;
      const target = e.target;

      // 1) 如果正在别的输入框里打字（不是 EditForm 内），不要抢 Enter
      const isTypingEl =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (isTypingEl && root && !root.contains(target)) return;

      // 2) 如果焦点在 Cancel（ghost）按钮上，让 Enter 执行取消，不要保存
      const btn = target?.closest?.("button");
      if (
        btn &&
        root &&
        root.contains(btn) &&
        btn.classList.contains("ghost")
      ) {
        return;
      }

      // ✅ 否则：只要还在 edit mode（EditForm 还挂着），Enter 就保存
      e.preventDefault();
      e.stopPropagation();
      commitSave();
    };

    document.addEventListener("keydown", onDocKeyDown, true); // capture
    return () => document.removeEventListener("keydown", onDocKeyDown, true);
  }, [isLocked, timeOpen, isValid, task, minutes]); // task/minutes 确保拿到最新值

  // 你原本的 capture 可以留着（也可以删掉，因为上面已经全局接管）
  const onKeyDownCapture = (e) => {
    if (isLocked) return;
    if (e.key !== "Enter") return;
    if (e.isComposing) return;
    if (timeOpen) return;
    e.preventDefault();
    commitSave();
  };

  return (
    <div
      ref={wrapRef} // ✅ NEW
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
