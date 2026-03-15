import CreateForm from "./CreateForm";
import Todo from "./Todo";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import { MdDeleteSweep } from "react-icons/md";
import TagManager from "./TagManager";

const STORAGE_KEY = "menubar_todo_v1";
const STORAGE_BACKUP_KEY = "menubar_todo_v1_backup";
const SETTINGS_KEY = "menubar_todo_settings_v1";
const TITLE_KEY = "menubar_title_v1";
const TAGS_KEY = "menubar_tags_v1";
const TAG_COLORS_KEY = "menubar_tag_colors_v1";
const ENTRY_FILTER_KEY = "menubar_entry_filter_v1";
const LAST_ACTIVE_DAY_KEY = "menubar_last_active_day_v1";
const EXPORT_SCHEMA_VERSION = 1;

const EXPORTABLE_STORAGE_KEYS = [
  STORAGE_KEY,
  STORAGE_BACKUP_KEY,
  SETTINGS_KEY,
  TITLE_KEY,
  `${TITLE_KEY}_subtitle`,
  TAGS_KEY,
  TAG_COLORS_KEY,
  ENTRY_FILTER_KEY,
  LAST_ACTIVE_DAY_KEY,
];

const DEFAULT_TAG_COLORS = {
  Study: "#9FB7EE",
  Exam: "#D8B18A",
  Life: "#B890D8",
  Daily: "#B9C36B",
  Other: "#D89FBC",
};

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function nowMs() {
  return Date.now();
}

function getLocalDayKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resetCompletedForNewDay(todos) {
  if (!Array.isArray(todos)) return [];

  return todos.map((todo) => {
    if (!todo?.isCompleted && !todo?.completedAt) return todo;
    return {
      ...todo,
      isCompleted: false,
      completedAt: null,
    };
  });
}

function createEmptyDailyStats(dayKey = getLocalDayKey()) {
  return {
    dayKey,
    completedCount: 0,
    focusMinutes: 0,
  };
}

function getDayKeyFromIso(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return null;
  return getLocalDayKey(date);
}

function applyCompletionToDailyStats(stats, todo, direction) {
  const base = stats ?? createEmptyDailyStats();
  if (!todo || todo.type === "note") return base;
  if (direction !== 1 && direction !== -1) return base;

  const minutes = Math.max(0, Number(todo.minutes ?? 0));

  return {
    dayKey: base.dayKey ?? getLocalDayKey(),
    completedCount: Math.max(0, Number(base.completedCount ?? 0) + direction),
    focusMinutes: Math.max(
      0,
      Number(base.focusMinutes ?? 0) + minutes * direction,
    ),
  };
}

function adjustFocusMinutesInDailyStats(stats, deltaMinutes) {
  const base = stats ?? createEmptyDailyStats();
  return {
    ...base,
    focusMinutes: Math.max(
      0,
      Number(base.focusMinutes ?? 0) + Number(deltaMinutes ?? 0),
    ),
  };
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function readStoredData() {
  const primaryRaw = localStorage.getItem(STORAGE_KEY);
  const primary = primaryRaw ? safeParse(primaryRaw, null) : null;
  if (primary) return primary;

  const backupRaw = localStorage.getItem(STORAGE_BACKUP_KEY);
  const backup = backupRaw ? safeParse(backupRaw, null) : null;
  return backup;
}

function buildExportPayload() {
  const data = Object.fromEntries(
    EXPORTABLE_STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]),
  );

  return {
    app: "YC Todo",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

const formatShortcutDisplay = ({ meta, shift, alt, ctrl }, code) => {
  const parts = [];
  if (ctrl) parts.push("⌃");
  if (alt) parts.push("⌥");
  if (shift) parts.push("⇧");
  if (meta) parts.push("⌘");

  let keyPart = code || "";
  if (typeof keyPart === "string" && keyPart.startsWith("Key")) {
    keyPart = keyPart.replace("Key", "");
  } else if (typeof keyPart === "string" && keyPart.startsWith("Digit")) {
    keyPart = keyPart.replace("Digit", "");
  }

  return `${parts.join("")}${keyPart}`;
};

const keyEventToShortcut = (e) => {
  const mods = {
    meta: e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    ctrl: e.ctrlKey,
  };

  const hasMod = mods.meta || mods.shift || mods.alt || mods.ctrl;
  if (!hasMod) return null;

  const k = e.key;
  if (k === "Meta" || k === "Shift" || k === "Alt" || k === "Control") {
    return null;
  }

  const code = e.code;
  if (!code) return null;

  const display = formatShortcutDisplay(mods, code);
  return { mods, code, display };
};

function TodoWrapper() {
  // -----------------------------
  // Load initial state from storage
  // -----------------------------
  const initialLoadedRef = useRef(false);
  const notifBtnRef = useRef(null);

  const DEFAULT_TAGS = ["Study", "Exam", "Life", "Daily", "Other"];

  const [tags, setTags] = useState(() => {
    const raw = localStorage.getItem(TAGS_KEY);
    const arr = raw ? safeParse(raw, null) : null;

    const base = Array.isArray(arr) && arr.length ? arr : DEFAULT_TAGS;

    // ✅ normalize: remove "All" if it got saved, de-dup, trim
    const cleaned = Array.from(
      new Map(base.map((t) => [String(t).trim(), String(t).trim()])).values(),
    ).filter((t) => t && t !== "All");

    return cleaned.length ? cleaned : DEFAULT_TAGS;
  });

  const [tagColors, setTagColors] = useState(() => {
    const raw = localStorage.getItem(TAG_COLORS_KEY);
    const saved = raw ? safeParse(raw, null) : null;
    const base = saved && typeof saved === "object" ? saved : {};
    const merged = { ...DEFAULT_TAG_COLORS, ...base };
    return merged;
  });

  const [activeTag, setActiveTag] = useState("All");
  const [entryFilter, setEntryFilter] = useState(() => {
    return localStorage.getItem(ENTRY_FILTER_KEY) || "all";
  });
  const [dayTick, setDayTick] = useState(() => Date.now());

  const [accent, setAccent] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (safeParse(raw, null)?.accent ?? "#d4a5c1") : "#d4a5c1";
  });

  const [themeMode, setThemeMode] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (safeParse(raw, null)?.themeMode ?? "system") : "system";
  });

  const [title, setTitle] = useState(() => {
    return localStorage.getItem(TITLE_KEY) || "YC Todo";
  });

  const [subtitle, setSubtitle] = useState(() => {
    return localStorage.getItem(`${TITLE_KEY}_subtitle`) || "记录个小生活";
  });

  const [editing, setEditing] = useState(null);

  const [todos, setTodos] = useState(() => {
    const data = readStoredData();
    if (data?.todos?.length) {
      const todayKey = getLocalDayKey();
      const savedDayKey = localStorage.getItem(LAST_ACTIVE_DAY_KEY);
      return savedDayKey === todayKey
        ? data.todos
        : resetCompletedForNewDay(data.todos);
    }

    return [
      {
        content: "Welcome to YC Todo",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 60,
        tag: "Life",
        type: "task",
      },
      {
        content: "Add your first task",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Study",
        type: "task",
      },
      {
        content: "Edit your task",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Exam",
        type: "task",
      },
    ];
  });

  const [dailyStats, setDailyStats] = useState(() => {
    const data = readStoredData();
    const todayKey = getLocalDayKey();
    const saved = data?.stats;

    if (saved?.dayKey === todayKey) {
      return {
        dayKey: todayKey,
        completedCount: Number(saved.completedCount ?? 0),
        focusMinutes: Number(saved.focusMinutes ?? 0),
      };
    }

    return createEmptyDailyStats(todayKey);
  });

  // Focus mode state
  const [activeId, setActiveId] = useState(() => {
    const data = readStoredData();
    return data?.timer?.activeId ?? null;
  });

  const [status, setStatus] = useState(() => {
    const data = readStoredData();
    return data?.timer?.status ?? "idle";
  });

  const [remainingSec, setRemainingSec] = useState(() => {
    const data = readStoredData();
    return data?.timer?.remainingSec ?? 0;
  });

  const endAtRef = useRef(null);

  const [showCompleted, setShowCompleted] = useState(() => {
    const data = readStoredData();
    return data?.ui?.showCompleted ?? false;
  });
  const [openTagPickerId, setOpenTagPickerId] = useState(null);

  const isLocked = status === "running" || status === "paused";

  // -----------------------------
  // Drag reorder
  // -----------------------------
  const dragIdRef = useRef(null);
  const hoverIdRef = useRef(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef(null);

  const reorderTodos = (fromId, toId) => {
    if (fromId === toId) return;

    setTodos((prev) => {
      const arr = [...prev];
      const fromIndex = arr.findIndex((t) => t.id === fromId);
      const toIndex = arr.findIndex((t) => t.id === toId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return arr;
    });
  };

  const DRAG_THRESHOLD = 8;

  const pointerMoveHandler = (e) => {
    const pending = pendingRef.current;
    if (!pending) return;

    if (!draggingRef.current) {
      const dx = e.clientX - pending.x;
      const dy = e.clientY - pending.y;
      const dist = Math.hypot(dx, dy);
      if (dist < DRAG_THRESHOLD) return;

      draggingRef.current = true;
      dragIdRef.current = pending.id;
      hoverIdRef.current = null;

      document.body.classList.add("is-reordering");
      e.preventDefault();
    }

    if (dragIdRef.current == null) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const todoEl = el?.closest?.("[data-todo-id]");
    const hoverIdStr = todoEl?.getAttribute?.("data-todo-id");
    if (!hoverIdStr) return;

    const toId = Number(hoverIdStr);
    if (Number.isNaN(toId)) return;

    const fromId = dragIdRef.current;
    if (fromId === toId) return;
    if (hoverIdRef.current === toId) return;

    hoverIdRef.current = toId;
    reorderTodos(fromId, toId);
  };

  const pointerUpHandler = () => {
    pendingRef.current = null;
    draggingRef.current = false;
    dragIdRef.current = null;
    hoverIdRef.current = null;

    document.body.classList.remove("is-reordering");

    window.removeEventListener("pointermove", pointerMoveHandler);
    window.removeEventListener("pointerup", pointerUpHandler);
  };

  const startPointerDrag = (id, startX, startY) => {
    if (isLocked) return;
    pendingRef.current = { id, x: startX, y: startY };

    window.addEventListener("pointermove", pointerMoveHandler, {
      passive: false,
    });
    window.addEventListener("pointerup", pointerUpHandler);
  };

  // -----------------------------
  // Drag reorder (TAG bar chips)
  // -----------------------------
  const tagDragRef = useRef(null);
  const tagHoverRef = useRef(null);
  const tagDraggingRef = useRef(false);
  const tagPendingRef = useRef(null);
  const suppressTagClickRef = useRef(false);

  const TAG_DRAG_THRESHOLD = 6;

  const reorderTags = (fromTag, toTag) => {
    if (!fromTag || !toTag) return;
    if (fromTag === toTag) return;

    // ✅ "All" pinned, not draggable / not droppable
    if (fromTag === "All" || toTag === "All") return;

    setTags((prev) => {
      const arr = [...prev];
      const fromIndex = arr.indexOf(fromTag);
      const toIndex = arr.indexOf(toTag);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return arr;
    });
  };

  const tagPointerMoveHandler = (e) => {
    const pending = tagPendingRef.current;
    if (!pending) return;

    if (!tagDraggingRef.current) {
      const dx = e.clientX - pending.x;
      const dy = e.clientY - pending.y;
      const dist = Math.hypot(dx, dy);
      if (dist < TAG_DRAG_THRESHOLD) return;

      tagDraggingRef.current = true;
      tagDragRef.current = pending.tag;
      tagHoverRef.current = null;

      suppressTagClickRef.current = true; // prevent accidental click after drag
      document.body.classList.add("is-tag-reordering");
      e.preventDefault();
    }

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const chipEl = el?.closest?.("[data-tag]");
    const toTag = chipEl?.getAttribute?.("data-tag");
    if (!toTag) return;

    const fromTag = tagDragRef.current;
    if (!fromTag || fromTag === toTag) return;
    if (tagHoverRef.current === toTag) return;

    tagHoverRef.current = toTag;
    reorderTags(fromTag, toTag);
  };

  const tagPointerUpHandler = () => {
    tagPendingRef.current = null;
    tagDraggingRef.current = false;
    tagDragRef.current = null;
    tagHoverRef.current = null;

    document.body.classList.remove("is-tag-reordering");

    window.removeEventListener("pointermove", tagPointerMoveHandler);
    window.removeEventListener("pointerup", tagPointerUpHandler);

    // allow click again after this tick
    setTimeout(() => (suppressTagClickRef.current = false), 0);
  };

  const startTagPointerDrag = (tag, startX, startY) => {
    if (isLocked) return;
    if (!tag || tag === "All") return;

    tagPendingRef.current = { tag, x: startX, y: startY };

    window.addEventListener("pointermove", tagPointerMoveHandler, {
      passive: false,
    });
    window.addEventListener("pointerup", tagPointerUpHandler);
  };

  // -----------------------------
  // Derived lists
  // -----------------------------
  const normalizedTodos = useMemo(
    () =>
      todos.map((t) => ({
        ...t,
        tag: t.tag ?? "Study",
        type: t.type === "note" ? "note" : "task",
      })),
    [todos],
  );

  const allIncomplete = useMemo(
    () => normalizedTodos.filter((t) => !t.isCompleted),
    [normalizedTodos],
  );

  const allCompleted = useMemo(
    () => normalizedTodos.filter((t) => t.isCompleted),
    [normalizedTodos],
  );

  const visibleIncompleteRaw = useMemo(() => {
    if (activeTag === "All") return allIncomplete;
    return allIncomplete.filter((t) => t.tag === activeTag);
  }, [allIncomplete, activeTag]);

  const visibleCompletedRaw = useMemo(() => {
    if (activeTag === "All") return allCompleted;
    return allCompleted.filter((t) => t.tag === activeTag);
  }, [allCompleted, activeTag]);

  const visibleIncomplete = useMemo(() => {
    if (entryFilter === "tasks") {
      return visibleIncompleteRaw.filter((t) => t.type === "task");
    }
    if (entryFilter === "notes") {
      return visibleIncompleteRaw.filter((t) => t.type === "note");
    }
    return visibleIncompleteRaw;
  }, [visibleIncompleteRaw, entryFilter]);

  const visibleCompleted = useMemo(() => {
    if (entryFilter === "notes") return [];
    return visibleCompletedRaw.filter((t) => t.type === "task");
  }, [visibleCompletedRaw, entryFilter]);

  const visibleStartableTasks = useMemo(
    () => visibleIncompleteRaw.filter((t) => t.type === "task"),
    [visibleIncompleteRaw],
  );

  const todayStats = useMemo(() => {
    return {
      completedCount: Number(dailyStats.completedCount ?? 0),
      focusMinutes: Number(dailyStats.focusMinutes ?? 0),
    };
  }, [dailyStats]);

  const activeTodo = useMemo(
    () => todos.find((t) => t.id === activeId) || null,
    [todos, activeId],
  );

  const runningLabel = useMemo(() => {
    if (status !== "running") return null;
    if (!activeTodo) return null;

    const name = activeTodo.content;
    const tag = activeTodo.tag ?? "Study";

    return `Running: ${name}-${tag}`;
  }, [status, activeTodo]);

  const remainingCount = visibleIncomplete.length;
  const remainingLabel =
    entryFilter === "tasks"
      ? "TASKS REMAINING"
      : entryFilter === "notes"
        ? "NOTES REMAINING"
        : "REMAINING";
  const entryAllLabel = activeTag === "All" ? "Everything" : activeTag;

  // -----------------------------
  // Notification mode (NEW)
  // -----------------------------
  // "sound" = 播 mp3 / native alarm（原本行為）
  // "quiet" = 不播音效，時間到只顯示 overlay（你要的 📢）
  const [notificationMode, setNotificationMode] = useState(() => {
    const data = readStoredData();
    return data?.ui?.notificationMode ?? "sound";
  });
  const [startMode, setStartMode] = useState(() => {
    const data = readStoredData();
    return data?.ui?.startMode ?? "strict";
  });

  const [showNotifyPanel, setShowNotifyPanel] = useState(false);
  const [showTodaySummary, setShowTodaySummary] = useState(false);

  // Quiet overlay (NEW)
  const [quietOverlayOpen, setQuietOverlayOpen] = useState(false);
  const [quietOverlayText, setQuietOverlayText] = useState("");

  useEffect(() => {
    invoke("set_popover_pin", { pinned: quietOverlayOpen }).catch(
      console.error,
    );
  }, [quietOverlayOpen]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDayTick(Date.now());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const showAppAndFocusBestEffort = async () => {
    try {
      await invoke("show_popover_cmd"); // ✅ 关键：让 menubar popover 真正弹出来
    } catch (e) {
      console.warn("show_popover_cmd failed", e);
    }
    try {
      window.focus();
    } catch {}
  };

  // -----------------------------
  // Sound settings (mp3 alarm)
  // -----------------------------
  const [soundDataUrl, setSoundDataUrl] = useState(null);

  const [soundPath, setSoundPath] = useState(() => {
    const data = readStoredData();
    return data?.ui?.sound?.path ?? "";
  });

  const [soundName, setSoundName] = useState(() => {
    const data = readStoredData();
    return data?.ui?.sound?.name ?? "";
  });

  const [soundVolume, setSoundVolume] = useState(() => {
    const data = readStoredData();
    return data?.ui?.sound?.volume ?? 1;
  });

  const [isNativePlaying, setIsNativePlaying] = useState(false);
  const nativeRestartTimerRef = useRef(null);

  const audioRef = useRef(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);

  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const sourceRef = useRef(null);

  // click outside close (UPDATED: Notify panel)
  const notifyPanelWrapRef = useRef(null);
  useEffect(() => {
    const onDown = async (e) => {
      if (!showNotifyPanel) return;
      // ✅ 如果点的是 notification button，本次不做 outside close
      if (notifBtnRef.current?.contains(e.target)) return;
      if (!notifyPanelWrapRef.current) return;
      if (notifyPanelWrapRef.current.contains(e.target)) return;

      setShowNotifyPanel(false);

      // 你關 panel 時，順便把 preview 停掉（避免一直響）
      stopSound();
      await stopAlarmNative();
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotifyPanel, soundPath]);

  // Quiet overlay: Esc not 關閉
  useEffect(() => {
    if (!quietOverlayOpen) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [quietOverlayOpen]);

  const syncAudioState = () => {
    const a = audioRef.current;
    if (!a) return;
    setIsSoundPlaying(!a.paused && !a.ended);
  };

  const rebuildAudioGraph = async () => {
    const old = audioRef.current;
    const oldSrc = old?.src || "";
    const oldTime = old?.currentTime || 0;
    const wasPlaying = old ? !old.paused && !old.ended : false;

    try {
      old?.pause();
    } catch {}

    audioRef.current = new Audio();
    const a = audioRef.current;
    a.volume = 1;

    if (oldSrc) a.src = oldSrc;
    try {
      a.currentTime = oldTime;
    } catch {}

    try {
      await audioCtxRef.current?.close?.();
    } catch {}

    audioCtxRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;

    const srcNode = ctx.createMediaElementSource(a);
    sourceRef.current = srcNode;

    const gain = ctx.createGain();
    gain.gain.value = Number(soundVolume) || 1;
    gainRef.current = gain;

    srcNode.connect(gain);
    gain.connect(ctx.destination);

    if (wasPlaying) {
      try {
        const p = a.play();
        if (p && typeof p.then === "function") await p;
      } catch {}
    }

    syncAudioState();
    return a;
  };

  const ensureAudioAlive = async () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 1;
    }

    if (!audioCtxRef.current) {
      await rebuildAudioGraph();
      return audioRef.current;
    }

    const ctx = audioCtxRef.current;

    if (ctx.state === "closed") {
      await rebuildAudioGraph();
      return audioRef.current;
    }

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        await rebuildAudioGraph();
        return audioRef.current;
      }
    }

    if (!gainRef.current || !sourceRef.current) {
      await rebuildAudioGraph();
      return audioRef.current;
    }

    audioRef.current.volume = 1;
    return audioRef.current;
  };

  const playAlarmNativeRaw = async (path, vol01) => {
    await invoke("play_alarm", { path, volume: vol01 });
  };

  const stopAlarmNativeRaw = async () => {
    await invoke("stop_alarm");
  };

  const playAlarmNative = async () => {
    try {
      if (!soundPath) return false;
      const raw = Number(soundVolume);
      const vol01 = Math.max(
        0,
        Math.min(1, Number.isFinite(raw) ? raw / 3.5 : 1),
      );

      await playAlarmNativeRaw(soundPath, vol01);
      setIsNativePlaying(true);
      return true;
    } catch {
      setIsNativePlaying(false);
      return false;
    }
  };

  const stopAlarmNative = async () => {
    try {
      await stopAlarmNativeRaw();
      setIsNativePlaying(false);
      return true;
    } catch {
      return false;
    }
  };

  const playAlarmSound = async () => {
    if (!soundDataUrl) return false;

    try {
      const a = await ensureAudioAlive();

      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {}
      }
      if (ctx && ctx.state !== "running") {
        console.warn("[alarm] audio ctx not running, fallback to beep");
        return false;
      }

      try {
        a.pause();
        a.currentTime = 0;
      } catch {}

      a.src = soundDataUrl;

      if (gainRef.current)
        gainRef.current.gain.value = Number(soundVolume) || 1;

      const p = a.play();
      if (p && typeof p.then === "function") await p;

      syncAudioState();
      return true;
    } catch (e) {
      console.error("[alarm] play failed:", e);
      alert("mp3 play failed: " + String(e));
      return false;
    }
  };

  useEffect(() => {
    const wake = async () => {
      if (!soundDataUrl) return;
      try {
        await ensureAudioAlive();
        syncAudioState();
      } catch {}
    };

    const onFocus = () => wake();
    const onVis = () => {
      if (document.visibilityState === "visible") wake();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundDataUrl, soundVolume]);

  const togglePauseResume = async () => {
    const a = audioRef.current;
    if (!a) return;

    try {
      if (!a.paused) {
        a.pause();
        syncAudioState();
        return;
      }

      await ensureAudioAlive();
      if (gainRef.current)
        gainRef.current.gain.value = Number(soundVolume) || 1;

      const p = a.play();
      if (p && typeof p.then === "function") await p;

      syncAudioState();
    } catch (e) {
      console.error("[sound] togglePauseResume failed:", e);
    }
  };

  const restartSound = async () => {
    if (!soundDataUrl) return;

    try {
      const a = await ensureAudioAlive();
      if (a.src !== soundDataUrl) a.src = soundDataUrl;

      if (gainRef.current)
        gainRef.current.gain.value = Number(soundVolume) || 1;

      a.currentTime = 0;

      const p = a.play();
      if (p && typeof p.then === "function") await p;

      syncAudioState();
    } catch (e) {
      console.error("[sound] restartSound failed:", e);
    }
  };

  const stopSound = () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
    } catch {}
    syncAudioState();
  };

  const closeNotifyPanel = async () => {
    setShowNotifyPanel(false);

    // 关掉任何 preview / native alarm
    stopSound();
    try {
      await stopAlarmNative();
    } catch {}
  };

  const revokeUrlIfNeeded = (url) => {
    try {
      if (url && typeof url === "string" && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    } catch {}
  };

  const onPickMp3 = async () => {
    try {
      const path = await invoke("pick_audio");
      if (!path) return;

      revokeUrlIfNeeded(soundDataUrl);

      setSoundPath(path);
      setSoundName(path.split("/").pop() || "sound");

      const bytes = await readFile(path);
      const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const blob = new Blob([uint8], { type: "audio/mpeg" });

      const url = URL.createObjectURL(blob);
      setSoundDataUrl(url);
    } catch (e) {
      console.error("[Upload MP3] error:", e);
      alert("Upload dialog failed: " + String(e));
    }
  };

  const clearSound = async () => {
    revokeUrlIfNeeded(soundDataUrl);
    setSoundDataUrl(null);
    setSoundName("");
    setSoundPath("");

    stopSound();
    try {
      await stopAlarmNative();
    } catch {}
  };

  useEffect(() => {
    let a;
    const onPlay = () => syncAudioState();
    const onPause = () => syncAudioState();
    const onEnded = () => syncAudioState();

    (async () => {
      a = await ensureAudioAlive();
      a.addEventListener("play", onPlay);
      a.addEventListener("pause", onPause);
      a.addEventListener("ended", onEnded);
    })();

    return () => {
      if (!a) return;
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (gainRef.current) {
      const v = Number(soundVolume);
      gainRef.current.gain.value = Number.isFinite(v) ? v : 1;
    }
  }, [soundVolume]);

  // -----------------------------
  // Notification
  // -----------------------------
  const notifiedRef = useRef(false);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;

    try {
      const perm = await Notification.requestPermission();
      return perm === "granted";
    } catch {
      return false;
    }
  };

  const fireNotification = async ({ title, body, beep = true }) => {
    const ok = await requestNotificationPermission();

    if (ok) {
      try {
        new Notification(title, { body });
      } catch {}
    }

    const originalTitle = document.title;
    document.title = `⏰ ${title}`;
    setTimeout(() => {
      document.title = originalTitle;
    }, 2500);

    if (!beep) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        try {
          if (ctx.state === "suspended") await ctx.resume();
        } catch {}

        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.value = 0.06;

        o.connect(g);
        g.connect(ctx.destination);

        o.start();
        setTimeout(() => {
          try {
            o.stop();
          } catch {}
          try {
            ctx.close();
          } catch {}
        }, 180);
      }
    } catch {}
  };

  useEffect(() => {
    if (!isNativePlaying) return;
    if (!soundPath) return;

    if (nativeRestartTimerRef.current) {
      clearTimeout(nativeRestartTimerRef.current);
    }

    nativeRestartTimerRef.current = setTimeout(async () => {
      try {
        const raw = Number(soundVolume);
        const vol01 = Math.max(
          0,
          Math.min(1, Number.isFinite(raw) ? raw / 3.5 : 1),
        );

        await stopAlarmNativeRaw();
        await playAlarmNativeRaw(soundPath, vol01);
      } catch {}
    }, 120);

    return () => {
      if (nativeRestartTimerRef.current) {
        clearTimeout(nativeRestartTimerRef.current);
        nativeRestartTimerRef.current = null;
      }
    };
  }, [soundVolume, soundPath, isNativePlaying]);

  // -----------------------------
  // Change title
  // -----------------------------
  useEffect(() => {
    localStorage.setItem(TITLE_KEY, title);
    localStorage.setItem(`${TITLE_KEY}_subtitle`, subtitle);
  }, [title, subtitle]);

  useEffect(() => {
    const todayKey = getLocalDayKey();
    const savedDayKey = localStorage.getItem(LAST_ACTIVE_DAY_KEY);
    if (savedDayKey === todayKey) return;

    setTodos((prev) => resetCompletedForNewDay(prev));
    setDailyStats(createEmptyDailyStats(todayKey));
    setShowCompleted(false);
    localStorage.setItem(LAST_ACTIVE_DAY_KEY, todayKey);
  }, [dayTick]);

  // -----------------------------
  // Restore timer endAt from storage on first mount
  // -----------------------------
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;

    const data = readStoredData();

    const timer = data?.timer;
    if (!timer) return;

    if (timer.status === "running" && timer.endAt && timer.activeId) {
      endAtRef.current = timer.endAt;

      const secLeft = Math.ceil((timer.endAt - nowMs()) / 1000);
      if (secLeft <= 0) {
        setRemainingSec(0);
        setTimeout(() => {
          finishActive();
        }, 0);
      } else {
        setRemainingSec(secLeft);
        setStatus("running");
        setActiveId(timer.activeId);
      }
    }

    if (timer.status === "paused" && timer.activeId) {
      endAtRef.current = null;
      setStatus("paused");
      setActiveId(timer.activeId);
      setRemainingSec(timer.remainingSec ?? 0);
    }

    if (timer.status === "idle") {
      endAtRef.current = null;
      setStatus("idle");
      setActiveId(null);
      setRemainingSec(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // Persist to localStorage
  // -----------------------------
  useEffect(() => {
    const payload = {
      todos,
      stats: dailyStats,
      timer: {
        activeId,
        status,
        remainingSec,
        endAt: endAtRef.current,
      },
      ui: {
        showCompleted,
        notificationMode, // ✅ NEW
        startMode,
        sound: {
          name: soundName,
          volume: soundVolume,
          path: soundPath,
        },
      },
    };

    const serialized = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
  }, [
    todos,
    dailyStats,
    activeId,
    status,
    remainingSec,
    showCompleted,
    soundDataUrl,
    soundName,
    soundVolume,
    soundPath,
    notificationMode,
    startMode,
  ]);

  useEffect(() => {
    const restore = async () => {
      if (!soundPath) return;

      try {
        revokeUrlIfNeeded(soundDataUrl);

        const bytes = await readFile(soundPath);
        const uint8 =
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const blob = new Blob([uint8], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        setSoundDataUrl(url);
      } catch (e) {
        console.error("[sound] restore from path failed:", e);
      }
    };

    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundPath]);

  // -----------------------------
  // countdown tick
  // -----------------------------
  useEffect(() => {
    if (status !== "running") return;
    if (!activeId) return;

    if (!endAtRef.current) {
      endAtRef.current = nowMs() + remainingSec * 1000;
    }

    const timer = setInterval(() => {
      const endAt = endAtRef.current;
      if (!endAt) return;

      const secLeft = Math.ceil((endAt - nowMs()) / 1000);
      if (secLeft <= 0) {
        setRemainingSec(0);
        return;
      }
      setRemainingSec(secLeft);
    }, 250);

    return () => clearInterval(timer);
  }, [status, activeId, remainingSec]);

  // when remainingSec hits 0 while running -> SOUND or QUIET (NEW)
  useEffect(() => {
    const run = async () => {
      if (status !== "running") return;
      if (remainingSec !== 0) return;
      if (!activeTodo) return;
      if (notifiedRef.current) return;

      notifiedRef.current = true;

      // ✅ QUIET MODE: 不播音效，開 app + overlay
      if (notificationMode === "quiet") {
        try {
          await stopAlarmNative();
        } catch {}

        // ✅ 1) 先弹系统通知（不 beep）
        fireNotification({
          title: "Time to take a break!",
          body: `Finished: ${activeTodo.content} (${
            activeTodo.minutes ?? 25
          }m)`,
          beep: false,
        });

        // ✅ 2) 再延迟打开 app + overlay（减少“闪一下”的感觉）
        setTimeout(async () => {
          await showAppAndFocusBestEffort();
          await new Promise((r) => setTimeout(r, 80));

          setQuietOverlayText(
            `Time to rest 💗\nYou’ve been working on ${
              activeTodo.content
            } for ${
              activeTodo.minutes ?? 25
            } min!\nStretch a little and reset 🫧`,
          );
          setQuietOverlayOpen(true);
        }, 250); // 200~400 都可以，250通常最顺

        finishActive();
        return;
      }

      // ✅ SOUND MODE（原本行為）
      const ok = await playAlarmNative();

      fireNotification({
        title: "Time to take a break!",
        body: `Finished: ${activeTodo.content} (${activeTodo.minutes ?? 25}m)`,
        beep: !ok,
      });

      finishActive();
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, status, activeTodo, notificationMode]);

  useEffect(() => {
    notifiedRef.current = false;
  }, [activeId, status]);

  // -----------------------------
  // Listen settings from Rust
  // -----------------------------
  useEffect(() => {
    let unTheme, unAccent;

    (async () => {
      unTheme = await listen("settings://theme", (e) =>
        setThemeMode(String(e.payload)),
      );
      unAccent = await listen("settings://accent", (e) =>
        setAccent(String(e.payload)),
      );
    })();

    return () => {
      unTheme?.();
      unAccent?.();
    };
  }, []);

  // -----------------------------
  // Listen tray menu -> open shortcut capture overlay
  // -----------------------------
  const [shortcutCapture, setShortcutCapture] = useState({
    open: false,
    target: null,
    hint: "",
  });

  const isPopoverVisible = () => document.visibilityState === "visible";

  const [pendingShortcut, setPendingShortcut] = useState(null);

  useEffect(() => {
    let un1, un2;

    (async () => {
      un1 = await listen("ui://capture-shortcut", (e) => {
        const target = e?.payload?.target;
        if (
          target !== "sound" &&
          target !== "popover" &&
          target !== "notif_mode"
        )
          return;

        setPendingShortcut(null);
        setShortcutCapture({
          open: true,
          target,
          hint:
            target === "sound"
              ? "Press the shortcut you want to set (⌘⇧K). Press Esc to cancel."
              : target === "popover"
                ? "Press the shortcut you want to set (⌘⇧J). Press Esc to cancel."
                : "Press the shortcut you want to set (⌘⇧L). Press Esc to cancel.",
        });
      });

      un2 = await listen("ui://shortcut-updated", () => {
        setShortcutCapture((s) => ({ ...s, open: false }));
      });
    })();

    return () => {
      un1?.();
      un2?.();
    };
  }, []);

  useEffect(() => {
    let unExport, unImport;

    (async () => {
      unExport = await listen("ui://export-local-data", () => {
        exportLocalData();
      });

      unImport = await listen("ui://import-local-data", () => {
        importLocalData();
      });
    })();

    return () => {
      unExport?.();
      unImport?.();
    };
  }, []);

  // -----------------------------
  // Listen global shortcut: toggle Notify panel (UPDATED: same event name)
  // -----------------------------
  const lastToggleAtRef = useRef(0);

  const lastToggleNotifAtRef = useRef(0);

  useEffect(() => {
    let un;

    (async () => {
      un = await listen("ui://toggle-notif-mode", () => {
        const now = performance.now();
        if (now - lastToggleNotifAtRef.current < 80) return; // ✅ 防连发
        lastToggleNotifAtRef.current = now;

        setShowNotifyPanel(true);
        setNotificationMode((m) => (m === "sound" ? "quiet" : "sound"));
      });
    })();

    return () => {
      un?.();
    };
  }, []);

  useEffect(() => {
    let un;

    (async () => {
      un = await listen("ui://set-notification-mode", (e) => {
        const nextMode = e?.payload?.mode;
        if (nextMode !== "sound" && nextMode !== "quiet") return;
        setShowNotifyPanel(true);
        setNotificationMode(nextMode);
      });
    })();

    return () => {
      un?.();
    };
  }, []);

  useEffect(() => {
    if (window.__unlistenToggleSound) {
      try {
        window.__unlistenToggleSound();
      } catch {}
      window.__unlistenToggleSound = null;
    }

    let disposed = false;

    (async () => {
      const un = await listen("ui://toggle-sound", () => {
        const now = performance.now();
        if (now - lastToggleAtRef.current < 120) return;
        lastToggleAtRef.current = now;

        setShowNotifyPanel((v) => {
          const next = !v;
          if (!next) {
            stopSound();
            stopAlarmNative();
          }
          return next;
        });
      });

      if (disposed) {
        un();
        return;
      }

      window.__unlistenToggleSound = un;
    })();

    return () => {
      disposed = true;
      if (window.__unlistenToggleSound) {
        try {
          window.__unlistenToggleSound();
        } catch {}
        window.__unlistenToggleSound = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!shortcutCapture.open) return;

    const onKeyDown = async (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShortcutCapture((s) => ({ ...s, open: false }));
        return;
      }

      const sc = keyEventToShortcut(e);
      if (!sc) return;

      e.preventDefault();

      setPendingShortcut(sc);

      try {
        await invoke("set_shortcut", {
          target: shortcutCapture.target,
          code: sc.code,
          meta: sc.mods.meta,
          shift: sc.mods.shift,
          alt: sc.mods.alt,
          ctrl: sc.mods.ctrl,
        });
      } catch (err) {
        alert(String(err));
        setPendingShortcut(null);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [shortcutCapture.open, shortcutCapture.target]);

  // -----------------------------
  // Apply theme tokens
  // -----------------------------
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", accent);

    const applyTheme = (mode) => {
      if (mode === "light") root.dataset.theme = "light";
      else if (mode === "dark") root.dataset.theme = "dark";
      else {
        const prefersDark = window.matchMedia?.(
          "(prefers-color-scheme: dark)",
        )?.matches;
        root.dataset.theme = prefersDark ? "dark" : "light";
      }
    };

    applyTheme(themeMode);

    let mq;
    const onChange = () => themeMode === "system" && applyTheme("system");
    if (themeMode === "system" && window.matchMedia) {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener?.("change", onChange);
    }

    return () => mq?.removeEventListener?.("change", onChange);
  }, [accent, themeMode]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ accent, themeMode }));
  }, [accent, themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", accent);

    const hex = accent.replace("#", "");
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      root.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.18)`);
    }
  }, [accent]);

  // -----------------------------
  // Tag list customize
  // -----------------------------
  useEffect(() => {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  }, [tags]);

  useEffect(() => {
    setTagColors((prev) => {
      const next = { ...prev };
      let changed = false;

      tags.forEach((t) => {
        if (!next[t]) {
          next[t] = DEFAULT_TAG_COLORS[t] ?? "#B9C36B";
          changed = true;
        }
      });

      Object.keys(next).forEach((k) => {
        if (!tags.includes(k)) {
          delete next[k];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [tags]);

  useEffect(() => {
    localStorage.setItem(TAG_COLORS_KEY, JSON.stringify(tagColors));
  }, [tagColors]);

  useEffect(() => {
    localStorage.setItem(ENTRY_FILTER_KEY, entryFilter);
  }, [entryFilter]);

  useEffect(() => {
    setShowCompleted(false);
    setOpenTagPickerId(null);
  }, [activeTag]);

  useEffect(() => {
    if (isLocked) setOpenTagPickerId(null);
  }, [isLocked]);

  // -----------------------------
  // CRUD
  // -----------------------------
  const addTodo = (content, minutes, tag, type = "task") => {
    const entryType = type === "note" ? "note" : "task";
    setTodos((prev) => [
      ...prev,
      {
        content,
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: entryType === "task" ? (minutes ?? 25) : null,
        tag: tag ?? "Study",
        type: entryType,
        completedAt: null,
      },
    ]);
  };

  const deleteTodo = (id) => {
    if (isLocked) return;
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  };

  const toggleComplete = (id) => {
    if (isLocked) return;
    const targetTodo = todos.find((todo) => todo.id === id);
    if (!targetTodo || targetTodo.type === "note") return;

    const todayKey = getLocalDayKey();
    const nextCompleted = !targetTodo.isCompleted;
    const shouldAdjustStats = nextCompleted
      ? true
      : getDayKeyFromIso(targetTodo.completedAt) === todayKey;

    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id
          ? {
              ...todo,
              isCompleted: nextCompleted,
              completedAt: nextCompleted ? new Date().toISOString() : null,
            }
          : todo,
      ),
    );

    if (shouldAdjustStats) {
      setDailyStats((prevStats) =>
        applyCompletionToDailyStats(prevStats, targetTodo, nextCompleted ? 1 : -1),
      );
    }
  };

  const toggleIsEditing = (id) => {
    if (isLocked) return;
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id === id) return { ...t, isEditing: !t.isEditing };
        return { ...t, isEditing: false };
      }),
    );
  };

  const editTodo = (id, newContent, minutes) => {
    if (isLocked) return;
    const targetTodo = todos.find((todo) => todo.id === id);
    if (!targetTodo) return;

    const nextMinutes =
      targetTodo.type === "note" ? null : (minutes ?? targetTodo.minutes);

    setTodos((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              content: newContent,
              minutes: t.type === "note" ? null : nextMinutes,
              isEditing: false,
            }
          : t,
      ),
    );

    if (
      targetTodo.type === "task" &&
      targetTodo.isCompleted &&
      getDayKeyFromIso(targetTodo.completedAt) === getLocalDayKey()
    ) {
      const prevMinutes = Number(targetTodo.minutes ?? 0);
      const updatedMinutes = Number(nextMinutes ?? prevMinutes);
      const deltaMinutes = updatedMinutes - prevMinutes;

      if (deltaMinutes !== 0) {
        setDailyStats((prevStats) =>
          adjustFocusMinutesInDailyStats(prevStats, deltaMinutes),
        );
      }
    }
  };

  const changeTodoTag = (id, nextTag) => {
    if (isLocked) return;
    if (!nextTag) return;

    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, tag: nextTag } : t)),
    );
  };

  const setTagColor = (tag, color) => {
    if (!tag || !color) return;
    setTagColors((prev) => ({ ...prev, [tag]: color }));
  };

  const handleRenameTag = (fromTag, toTag) => {
    if (!fromTag || !toTag || fromTag === toTag) return;
    setTodos((prev) =>
      prev.map((todo) =>
        todo.tag === fromTag ? { ...todo, tag: toTag } : todo,
      ),
    );
  };

  const handleDeleteTag = (deletedTag, fallbackTag = "Study") => {
    if (!deletedTag) return;
    setTodos((prev) =>
      prev.map((todo) =>
        todo.tag === deletedTag ? { ...todo, tag: fallbackTag } : todo,
      ),
    );
  };

  const chipStyleFor = (tag, active = false) => {
    if (tag === "All") return undefined;
    const c = tagColors[tag];
    if (!c) return undefined;
    return {
      background: active
        ? `color-mix(in srgb, ${c} 38%, var(--chip-bg))`
        : `color-mix(in srgb, ${c} 20%, var(--chip-bg))`,
      borderColor: `color-mix(in srgb, ${c} 56%, var(--chip-border))`,
    };
  };

  const canStartInCurrentMode = (todo) => {
    if (!todo || todo.isCompleted || todo.type === "note") return false;
    if (startMode === "free") return true;
    return visibleStartableTasks[0]?.id === todo.id;
  };

  // -----------------------------
  // Focus controls
  // -----------------------------
  const startTodo = (todo) => {
    if (!todo) return;
    if (!canStartInCurrentMode(todo)) return;

    if (activeId && activeId !== todo.id) {
      setQuietOverlayOpen(false);
      stopSound();
      stopAlarmNative().catch(() => null);
    }

    setActiveId(todo.id);
    const totalSec = (todo.minutes ?? 25) * 60;

    endAtRef.current = nowMs() + totalSec * 1000;
    setRemainingSec(totalSec);
    setStatus("running");
  };

  const pauseActive = () => {
    if (status !== "running") return;
    const endAt = endAtRef.current;

    if (endAt) {
      const secLeft = Math.ceil((endAt - nowMs()) / 1000);
      setRemainingSec(Math.max(0, secLeft));
    }

    endAtRef.current = null;
    setStatus("paused");
  };

  const resumeActive = () => {
    if (!activeId) return;
    if (status !== "paused") return;

    endAtRef.current = nowMs() + remainingSec * 1000;
    setStatus("running");
  };

  const finishActive = () => {
    if (!activeId) return;

    const finishedTodo = todos.find((t) => t.id === activeId) || null;
    if (finishedTodo && !finishedTodo.isCompleted && finishedTodo.type !== "note") {
      setDailyStats((prev) => applyCompletionToDailyStats(prev, finishedTodo, 1));
    }

    setTodos((prev) =>
      prev.map((t) =>
        t.id === activeId
          ? {
              ...t,
              isCompleted: true,
              isEditing: false,
              completedAt: new Date().toISOString(),
            }
          : t,
      ),
    );

    endAtRef.current = null;
    setStatus("idle");
    setActiveId(null);
    setRemainingSec(0);
  };

  const cancelActive = async () => {
    if (!activeId) return;

    // stop any alarm/preview just in case
    try {
      stopSound();
    } catch {}
    try {
      await stopAlarmNative();
    } catch {}
    setQuietOverlayOpen(false);

    // IMPORTANT: do NOT mark todo completed, do NOT change list
    endAtRef.current = null;
    setStatus("idle");
    setActiveId(null);
    setRemainingSec(0);

    // allow future notifications for next run
    notifiedRef.current = false;
  };

  const clearCompletedTasks = () => {
    if (isLocked) return;
    setTodos((prev) => prev.filter((todo) => !todo.isCompleted));
    setShowCompleted(false);
  };

  const exportLocalData = async () => {
    try {
      const filePath = await save({
        title: "Export YC Todo Data",
        defaultPath: `yc-todo-backup-${getLocalDayKey()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;

      const payload = buildExportPayload();
      await writeTextFile(filePath, JSON.stringify(payload, null, 2));
      alert("Data exported successfully.");
    } catch (e) {
      console.error("[export] failed:", e);
      alert("Export failed: " + String(e));
    }
  };

  const importLocalData = async () => {
    try {
      const selected = await open({
        title: "Import YC Todo Data",
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (!selected || Array.isArray(selected)) return;

      const raw = await readTextFile(selected);
      const parsed = safeParse(raw, null);
      const importedData = parsed?.data;

      if (!importedData || typeof importedData !== "object") {
        throw new Error("Invalid backup file.");
      }

      EXPORTABLE_STORAGE_KEYS.forEach((key) => {
        const value = importedData[key];
        if (typeof value === "string") localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      });

      alert("Data imported successfully. YC Todo will reload now.");
      window.location.reload();
    } catch (e) {
      console.error("[import] failed:", e);
      alert("Import failed: " + String(e));
    }
  };

  const closeTransientPanels = () => {
    let closed = false;

    if (showNotifyPanel) {
      setShowNotifyPanel(false);
      stopSound();
      stopAlarmNative();
      closed = true;
    }

    if (openTagPickerId !== null) {
      setOpenTagPickerId(null);
      closed = true;
    }

    const hasMinutePopover = Boolean(document.getElementById("minute-popover"));
    const hasTagManagerPopover = Boolean(document.querySelector(".tag-mgr-pop"));
    const hasTagManagerPalette = Boolean(
      document.querySelector(".tag-mgr-palette"),
    );

    if (hasMinutePopover || hasTagManagerPopover || hasTagManagerPalette) {
      window.dispatchEvent(new Event("ui://close-transient-panels"));
      closed = true;
    }

    return closed;
  };

  const headerRight = useMemo(() => {
    if (isLocked && activeId) return formatTime(remainingSec);
    return `${remainingCount}`;
  }, [isLocked, activeId, remainingSec, remainingCount]);

  // -----------------------------
  // Global: Enter to hide popover (home page)
  // -----------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (quietOverlayOpen) return;
      if (e.key !== "Enter") return;
      if (e.isComposing) return;

      const t = e.target;
      const isTyping =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);

      if (isTyping) return;
      if (todos.some((x) => x.isEditing)) return;

      e.preventDefault();
      e.stopPropagation();

      // 1) Close any open transient picker/panel first.
      if (closeTransientPanels()) {
        return;
      }

      // 2) Only hide app if nothing else is open.
      invoke("hide_popover_cmd");
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [todos, showNotifyPanel, quietOverlayOpen, openTagPickerId]);

  return (
    <>
      {/* ✅ Quiet mode overlay */}
      {quietOverlayOpen && (
        <div className="alarm-overlay" onMouseDown={(e) => e.stopPropagation()}>
          <div className="alarm-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="alarm-head">
              <div className="alarm-title">Time to take a break!</div>
              <button
                type="button"
                className="alarm-close"
                onClick={() => setQuietOverlayOpen(false)}
                aria-label="Close"
                title="Esc"
              >
                ✕
              </button>
            </div>

            <div className="alarm-body">
              {quietOverlayText.split("\n").map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>

            <div className="alarm-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setQuietOverlayOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Shortcut overlay (原本) */}
      {shortcutCapture.open && (
        <div
          className="shortcut-overlay"
          onMouseDown={() => setShortcutCapture((s) => ({ ...s, open: false }))}
        >
          <div
            className="shortcut-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="shortcut-head">
              <div className="shortcut-title">
                Shortcut：
                {shortcutCapture.target === "sound"
                  ? "Sound"
                  : shortcutCapture.target === "popover"
                    ? "Popover"
                    : "Notify Mode"}
              </div>

              <button
                type="button"
                className="shortcut-esc"
                onClick={() =>
                  setShortcutCapture((s) => ({ ...s, open: false }))
                }
                aria-label="Cancel"
                title="Esc"
              >
                Esc
              </button>
            </div>

            <div className="shortcut-hint">{shortcutCapture.hint}</div>

            <div className="shortcut-keybox">
              {pendingShortcut ? pendingShortcut.display : "Waiting for keys…"}
            </div>

            <div className="shortcut-rule">
              Must include at least one modifier (⌘ / ⇧ / ⌥ / ⌃). Esc to cancel
            </div>
          </div>
        </div>
      )}

      <div className="menu-card">
        <div className="menu-main">
          <header className="menu-header">
            <div className="header-row">
              <div className="title-wrap">
                <div className="title-slot">
                  {editing === "title" ? (
                    <input
                      className="title-input"
                      value={title}
                      autoFocus
                      onChange={(e) => setTitle(e.target.value)}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setEditing(null);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <h1 onDoubleClick={() => setEditing("title")}>{title}</h1>
                  )}
                </div>

                <div className="subtitle-slot">
                  {editing === "subtitle" ? (
                    <input
                      className="subtitle-input"
                      value={subtitle}
                      autoFocus
                      onChange={(e) => setSubtitle(e.target.value)}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setEditing(null);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span
                      className="subtitle"
                      onDoubleClick={() => setEditing("subtitle")}
                    >
                      {subtitle}
                    </span>
                  )}
                </div>
              </div>

              <div
                className="header-badges"
                style={{ position: "relative", zIndex: 2147483400 }}
              >
                <button type="button" className="badge badge-timer">
                  {headerRight}
                </button>

                {/* ✅ 🔔 Notification Panel */}
                <button
                  ref={notifBtnRef}
                  type="button"
                  className="badge-music"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setShowNotifyPanel((v) => !v)}
                  aria-label="Notifications"
                  title={
                    notificationMode === "sound" ? "Sound mode" : "Quiet mode"
                  }
                >
                  {notificationMode === "sound" ? "🎵" : "💭"}
                </button>

                {showNotifyPanel && (
                  <div className="sound-panel" ref={notifyPanelWrapRef}>
                    <div className="sound-row">
                      <div className="sound-title">Notifications</div>

                      <button
                        type="button"
                        className="sound-close"
                        onClick={async () => {
                          setShowNotifyPanel(false);
                          stopSound();
                          try {
                            await stopAlarmNative();
                          } catch {}
                        }}
                        aria-label="Close notification panel"
                        title="Close"
                      >
                        ✕
                      </button>
                    </div>

                    {/* ✅ mode switch */}
                    <div className="notif-mode">
                      <button
                        type="button"
                        className={`notif-mode-btn ${
                          notificationMode === "sound" ? "active" : ""
                        }`}
                        onClick={() => setNotificationMode("sound")}
                        title="Sound notification"
                      >
                        🎵 Sound
                      </button>

                      <button
                        type="button"
                        className={`notif-mode-btn ${
                          notificationMode === "quiet" ? "active" : ""
                        }`}
                        onClick={() => setNotificationMode("quiet")}
                        title="Quiet notification"
                      >
                        💭 Quiet
                      </button>
                    </div>

                    {/* ✅ SOUND MODE: show your existing sound controls */}
                    {notificationMode === "sound" ? (
                      <>
                        <div className="sound-meta" title={soundName || ""}>
                          {soundDataUrl
                            ? `Selected: ${soundName || "mp3"}`
                            : "No sound selected"}
                        </div>

                        <div className="sound-actions">
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={onPickMp3}
                            title="Pick an mp3"
                          >
                            Upload
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={playAlarmNative}
                            disabled={!soundPath}
                            title="Play (Native)"
                          >
                            Play
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={stopAlarmNative}
                            disabled={!soundPath}
                            title="Stop (Native)"
                          >
                            Stop
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={togglePauseResume}
                            disabled={!soundDataUrl && !soundPath}
                            title="Pause / Resume"
                          >
                            {isSoundPlaying ? "Pause" : "Resume"}
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={restartSound}
                            disabled={!soundDataUrl}
                            title="Restart"
                          >
                            Restart
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={clearSound}
                            disabled={!soundDataUrl}
                            title="Clear"
                          >
                            Clear
                          </button>
                        </div>

                        <div className="sound-slider">
                          <div className="muted">Volume</div>
                          <input
                            type="range"
                            min="0"
                            max="3.5"
                            step="0.05"
                            value={Number(soundVolume) || 1}
                            onChange={(e) => setSoundVolume(e.target.value)}
                          />
                          <div className="muted">
                            {Number(soundVolume || 1).toFixed(2)}x
                          </div>
                        </div>
                      </>
                    ) : (
                      /* ✅ QUIET MODE: short description + test overlay */
                      <>
                        <div className="sound-meta">Pop-up notification</div>

                        <div className="sound-actions">
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={async () => {
                              await showAppAndFocusBestEffort();
                              await new Promise((r) => setTimeout(r, 80));
                              setQuietOverlayText(
                                "Preview window\nQuiet reminder",
                              );
                              setQuietOverlayOpen(true);
                            }}
                            title="Preview quiet overlay"
                          >
                            Preview
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={async () => {
                              try {
                                await stopAlarmNative();
                              } catch {}
                              stopSound();
                            }}
                            title="Stop any sound"
                          >
                            Stop Sound
                          </button>

                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => setShowNotifyPanel(false)}
                            title="Close"
                          >
                            Close
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          <CreateForm
            addTodo={addTodo}
            isLocked={isLocked}
            tags={tags}
            tagColors={tagColors}
          />

          <div className="now-bar">
            <div className="now-bar-top">
              <span className="now-title">Now</span>
              <div className="now-top-right">
                <button
                  type="button"
                  className={`stats-toggle ${showTodaySummary ? "active" : ""}`}
                  onClick={() => setShowTodaySummary((v) => !v)}
                  title="Show today summary"
                  aria-label="Show today summary"
                >
                  ✓
                </button>

                <span className="remaining-chip">
                  <b>{remainingCount}</b> <span>{remainingLabel}</span>
                </span>
              </div>
            </div>

            <div className="now-bar-bottom">
              <button
                type="button"
                className="mode-chip"
                onClick={() =>
                  setStartMode((m) => (m === "strict" ? "free" : "strict"))
                }
                title={
                  startMode === "strict"
                    ? "Strict mode: only top task can start"
                    : "Free mode: any task can start"
                }
              >
                {startMode === "strict" ? "Mode: Strict" : "Mode: Free"}
              </button>

              <div className="entry-filter-row inline">
                <button
                  type="button"
                  className={`entry-filter-chip ${entryFilter === "all" ? "active" : ""}`}
                  onClick={() => setEntryFilter("all")}
                >
                  {entryAllLabel}
                </button>
                <button
                  type="button"
                  className={`entry-filter-chip ${entryFilter === "tasks" ? "active" : ""}`}
                  onClick={() => setEntryFilter("tasks")}
                >
                  Tasks
                </button>
                <button
                  type="button"
                  className={`entry-filter-chip ${entryFilter === "notes" ? "active" : ""}`}
                  onClick={() => setEntryFilter("notes")}
                >
                  Notes
                </button>
              </div>

              {runningLabel && (
                <span className="running-chip">{runningLabel}</span>
              )}
            </div>
            {showTodaySummary && (
              <div className="today-stats-inline">
                <span className="today-stats-text">
                  Today: Done {todayStats.completedCount} · Focus{" "}
                  {todayStats.focusMinutes}m
                </span>
              </div>
            )}
          </div>

          <div className="now-section">
            <div className="tag-bar">
              <div className="tag-bar-left">
                {["All", ...tags].map((t) => {
                  const isAll = t === "All";
                  return (
                    <button
                      key={t}
                      type="button"
                      data-tag={t}
                      className={`tag-chip ${activeTag === t ? "active" : ""}`}
                      style={chipStyleFor(t, activeTag === t)}
                      onClick={() => {
                        if (suppressTagClickRef.current) return;
                        setActiveTag(t);
                      }}
                      onPointerDown={(e) => {
                        if (isLocked) return;
                        if (isAll) return; // All pinned
                        // only left click / primary pointer
                        if (e.button !== 0) return;
                        startTagPointerDrag(t, e.clientX, e.clientY);
                      }}
                      title={isAll ? "All (pinned)" : "Drag to reorder"}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div className="tag-bar-right">
                <TagManager
                  tags={tags}
                  setTags={setTags}
                  activeTag={activeTag}
                  setActiveTag={setActiveTag}
                  disabled={isLocked}
                  tagColors={tagColors}
                  setTagColor={setTagColor}
                  onRenameTag={handleRenameTag}
                  onDeleteTag={handleDeleteTag}
                />
              </div>
            </div>

            <div className="now-list">
              {visibleIncomplete.map((todo, index) => {
                const isActive = todo.id === activeId;
                const canStart = canStartInCurrentMode(todo);

                return (
                  <Todo
                    key={todo.id}
                    todo={todo}
                    order={index + 1}
                    tags={tags}
                    tagColors={tagColors}
                    deleteTodo={deleteTodo}
                    toggleComplete={toggleComplete}
                    toggleIsEditing={toggleIsEditing}
                    editTodo={editTodo}
                    onChangeTag={changeTodoTag}
                    isLocked={isLocked}
                    isActive={isActive}
                    canStart={canStart}
                    status={status}
                    onStart={() => {
                      if (!isActive) return startTodo(todo);
                      if (status === "running") return pauseActive();
                      if (status === "paused") return resumeActive();
                    }}
                    onPause={pauseActive}
                    onFinish={() => finishActive(false)}
                    onPointerDragStart={startPointerDrag}
                    isTagPickerOpen={openTagPickerId === todo.id}
                    onToggleTagPicker={() =>
                      setOpenTagPickerId((prev) =>
                        prev === todo.id ? null : todo.id,
                      )
                    }
                    onCloseTagPicker={() => setOpenTagPickerId(null)}
                  />
                );
              })}
            </div>
          </div>

          <div className="completed-panel">
            <div className="completed-header">
              <button
                className="collapse-btn"
                onClick={() => setShowCompleted((v) => !v)}
                disabled={visibleCompleted.length === 0}
                aria-label="Toggle completed"
              >
                <span>Completed</span>
                <span className="collapse-btn-right">
                  <span className="muted">
                    {visibleCompleted.length === 0
                      ? "0"
                      : `${visibleCompleted.length} ${showCompleted ? "▾" : "▸"}`}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="completed-clear-btn"
                onClick={clearCompletedTasks}
                disabled={allCompleted.length === 0}
                aria-label="Clear completed tasks"
                title="Clear all completed tasks"
              >
                <MdDeleteSweep size={12} />
              </button>
            </div>

            {showCompleted && visibleCompleted.length > 0 && (
              <div className="completed-list">
                {visibleCompleted.map((todo) => (
                  <Todo
                    key={todo.id}
                    todo={todo}
                    hideOrder
                    tags={tags}
                    tagColors={tagColors}
                    deleteTodo={deleteTodo}
                    toggleComplete={toggleComplete}
                    toggleIsEditing={toggleIsEditing}
                    editTodo={editTodo}
                    onChangeTag={changeTodoTag}
                    isLocked={isLocked}
                    isActive={todo.id === activeId}
                    canStart={false}
                    status={status}
                    onStart={() => {}}
                    onPause={() => {}}
                    onFinish={() => {}}
                    isTagPickerOpen={openTagPickerId === todo.id}
                    onToggleTagPicker={() =>
                      setOpenTagPickerId((prev) =>
                        prev === todo.id ? null : todo.id,
                      )
                    }
                    onCloseTagPicker={() => setOpenTagPickerId(null)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="footer-bar">
          <button
            className="btn ghost"
            disabled={!isLocked || status !== "running"}
            onClick={pauseActive}
          >
            Pause
          </button>
          <button
            className="btn ghost"
            disabled={!isLocked || status !== "paused"}
            onClick={resumeActive}
          >
            Resume
          </button>

          <button
            className="btn ghost"
            disabled={!isLocked}
            onClick={cancelActive}
            title="Cancel this run (keep the task)"
          >
            Cancel
          </button>
          <button className="btn" disabled={!isLocked} onClick={finishActive}>
            Finish
          </button>
        </div>
      </div>
    </>
  );
}

export default TodoWrapper;
