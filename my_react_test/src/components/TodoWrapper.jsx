import CreateForm from "./CreateForm";
import Todo from "./Todo";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import TagManager from "./TagManager";

const STORAGE_KEY = "menubar_todo_v1";
const SETTINGS_KEY = "menubar_todo_settings_v1";
const TITLE_KEY = "menubar_title_v1";
const TAGS_KEY = "menubar_tags_v1";

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function nowMs() {
  return Date.now();
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
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

  const DEFAULT_TAGS = ["Study", "Exam", "Life", "Daily", "Other"];

  const [tags, setTags] = useState(() => {
    const raw = localStorage.getItem(TAGS_KEY);
    const arr = raw ? safeParse(raw, null) : null;
    return Array.isArray(arr) && arr.length ? arr : DEFAULT_TAGS;
  });

  const [activeTag, setActiveTag] = useState("All");

  const [accent, setAccent] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? safeParse(raw, null)?.accent ?? "#d4a5c1" : "#d4a5c1";
  });

  const [themeMode, setThemeMode] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? safeParse(raw, null)?.themeMode ?? "system" : "system";
  });

  const [title, setTitle] = useState(() => {
    return localStorage.getItem(TITLE_KEY) || "YC Todo";
  });

  const [subtitle, setSubtitle] = useState(() => {
    return localStorage.getItem(`${TITLE_KEY}_subtitle`) || "记录个小生活";
  });

  const [editing, setEditing] = useState(null);

  const [todos, setTodos] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    if (data?.todos?.length) return data.todos;

    return [
      {
        content: "Welcome to YC Todo",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 60,
        tag: "Life",
      },
      {
        content: "Add your first task",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Study",
      },
      {
        content: "Edit your task",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Exam",
      },
    ];
  });

  // Focus mode state
  const [activeId, setActiveId] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.timer?.activeId ?? null;
  });

  const [status, setStatus] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.timer?.status ?? "idle";
  });

  const [remainingSec, setRemainingSec] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.timer?.remainingSec ?? 0;
  });

  const endAtRef = useRef(null);

  const [showCompleted, setShowCompleted] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.ui?.showCompleted ?? false;
  });

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
  // Derived lists
  // -----------------------------
  const normalizedTodos = useMemo(
    () => todos.map((t) => ({ ...t, tag: t.tag ?? "Study" })),
    [todos]
  );

  const allIncomplete = useMemo(
    () => normalizedTodos.filter((t) => !t.isCompleted),
    [normalizedTodos]
  );

  const allCompleted = useMemo(
    () => normalizedTodos.filter((t) => t.isCompleted),
    [normalizedTodos]
  );

  const visibleIncomplete = useMemo(() => {
    if (activeTag === "All") return allIncomplete;
    return allIncomplete.filter((t) => t.tag === activeTag);
  }, [allIncomplete, activeTag]);

  const visibleCompleted = useMemo(() => {
    if (activeTag === "All") return allCompleted;
    return allCompleted.filter((t) => t.tag === activeTag);
  }, [allCompleted, activeTag]);

  const activeTodo = useMemo(
    () => todos.find((t) => t.id === activeId) || null,
    [todos, activeId]
  );

  const runningLabel = useMemo(() => {
    if (status !== "running") return null;
    if (!activeTodo) return null;

    const name = activeTodo.content;
    const tag = activeTodo.tag ?? "Study";

    return `Running: ${name}-${tag}`;
  }, [status, activeTodo]);

  const remainingCount = allIncomplete.length;
  const nextTodoToStart = visibleIncomplete[0] || null;

  // -----------------------------
  // Notification mode (NEW)
  // -----------------------------
  // "sound" = 播 mp3 / native alarm（原本行為）
  // "quiet" = 不播音效，時間到只顯示 overlay（你要的 📢）
  const [notificationMode, setNotificationMode] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.ui?.notificationMode ?? "sound";
  });

  const [showNotifyPanel, setShowNotifyPanel] = useState(false);

  // Quiet overlay (NEW)
  const [quietOverlayOpen, setQuietOverlayOpen] = useState(false);
  const [quietOverlayText, setQuietOverlayText] = useState("");

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
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.ui?.sound?.path ?? "";
  });

  const [soundName, setSoundName] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.ui?.sound?.name ?? "";
  });

  const [soundVolume, setSoundVolume] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
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

  // Quiet overlay: Esc 關閉
  useEffect(() => {
    if (!quietOverlayOpen) return;

    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setQuietOverlayOpen(false);
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
        Math.min(1, Number.isFinite(raw) ? raw / 3.5 : 1)
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
          Math.min(1, Number.isFinite(raw) ? raw / 3.5 : 1)
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

  // -----------------------------
  // Restore timer endAt from storage on first mount
  // -----------------------------
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;

    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;

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
      timer: {
        activeId,
        status,
        remainingSec,
        endAt: endAtRef.current,
      },
      ui: {
        showCompleted,
        notificationMode, // ✅ NEW
        sound: {
          name: soundName,
          volume: soundVolume,
          path: soundPath,
        },
      },
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    todos,
    activeId,
    status,
    remainingSec,
    showCompleted,
    soundDataUrl,
    soundName,
    soundVolume,
    soundPath,
    notificationMode,
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
        // 保險：停掉任何 native alarm（避免你之前 preview 還在響）
        try {
          await stopAlarmNative();
        } catch {}

        // 系統通知：不 beep（你要完全靜音）
        fireNotification({
          title: "Time to take a break!",
          body: `Finished: ${activeTodo.content} (${
            activeTodo.minutes ?? 25
          }m)`,
          beep: false,
        });

        // 拉出 app（best effort）
        await showAppAndFocusBestEffort();
        await new Promise((r) => setTimeout(r, 80));

        setQuietOverlayText(
          `Time to rest 💗\nYou’ve been working on ${activeTodo.content} for ${
            activeTodo.minutes ?? 25
          } min!\nStretch a little and reset 🫧`
        );

        setQuietOverlayOpen(true);

        // ✅ 保持你原本行為：自動 finish
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
        setThemeMode(String(e.payload))
      );
      unAccent = await listen("settings://accent", (e) =>
        setAccent(String(e.payload))
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
          "(prefers-color-scheme: dark)"
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
    setShowCompleted(false);
  }, [activeTag]);

  // -----------------------------
  // CRUD
  // -----------------------------
  const addTodo = (content, minutes, tag) => {
    setTodos([
      ...todos,
      {
        content,
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: minutes ?? 25,
        tag: tag ?? "Study",
      },
    ]);
  };

  const deleteTodo = (id) => {
    if (isLocked) return;
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  const toggleComplete = (id) => {
    if (isLocked) return;
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, isCompleted: !todo.isCompleted } : todo
      )
    );
  };

  const toggleIsEditing = (id) => {
    if (isLocked) return;
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id === id) return { ...t, isEditing: !t.isEditing };
        return { ...t, isEditing: false };
      })
    );
  };

  const editTodo = (id, newContent, minutes) => {
    if (isLocked) return;
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              content: newContent,
              minutes: minutes ?? t.minutes,
              isEditing: false,
            }
          : t
      )
    );
  };

  // -----------------------------
  // Focus controls
  // -----------------------------
  const startTodo = (todo) => {
    if (!todo) return;
    if (visibleIncomplete[0]?.id !== todo.id) return;

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

    setTodos((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, isCompleted: true, isEditing: false } : t
      )
    );

    endAtRef.current = null;
    setStatus("idle");
    setActiveId(null);
    setRemainingSec(0);
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

      if (showNotifyPanel) return;

      if (document.getElementById("minute-popover")) return;
      if (document.getElementById("tagwheel-popover")) return;

      e.preventDefault();
      e.stopPropagation();

      invoke("hide_popover_cmd");
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [todos, showNotifyPanel]);

  return (
    <>
      {/* ✅ Quiet mode overlay */}
      {quietOverlayOpen && (
        <div
          className="alarm-overlay"
          onMouseDown={() => setQuietOverlayOpen(false)}
        >
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

              <div
                className="header-badges"
                style={{ position: "relative", zIndex: 10 }}
              >
                <button type="button" className="badge badge-timer">
                  {headerRight}
                </button>

                {/* ✅ 🔔 Notification Panel */}
                <button
                  type="button"
                  className="badge-music"
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
                                "Preview window\nQuiet reminder"
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

          <CreateForm addTodo={addTodo} isLocked={isLocked} tags={tags} />

          <div className="now-bar">
            <div className="now-bar-left">
              <span className="now-title">Now</span>
            </div>

            <div className="now-bar-right">
              <span className="remaining-chip">
                <b>{remainingCount}</b> <span>REMAINING</span>
              </span>

              {runningLabel && (
                <span className="running-chip">{runningLabel}</span>
              )}
            </div>
          </div>

          <div className="now-section">
            <div className="tag-bar">
              <div className="tag-bar-left">
                {["All", ...tags].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`tag-chip ${activeTag === t ? "active" : ""}`}
                    onClick={() => setActiveTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="tag-bar-right">
                <TagManager
                  tags={tags}
                  setTags={setTags}
                  activeTag={activeTag}
                  setActiveTag={setActiveTag}
                  disabled={isLocked}
                />
              </div>
            </div>

            <div className="now-list">
              {visibleIncomplete.map((todo, index) => {
                const isActive = todo.id === activeId;
                const canStart =
                  !isLocked && visibleIncomplete[0]?.id === todo.id;

                return (
                  <Todo
                    key={todo.id}
                    todo={todo}
                    order={index + 1}
                    deleteTodo={deleteTodo}
                    toggleComplete={toggleComplete}
                    toggleIsEditing={toggleIsEditing}
                    editTodo={editTodo}
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
                  />
                );
              })}
            </div>
          </div>

          <div className="completed-panel">
            <button
              className="collapse-btn"
              onClick={() => setShowCompleted((v) => !v)}
              disabled={visibleCompleted.length === 0}
              aria-label="Toggle completed"
            >
              <span>Completed</span>
              <span className="muted">
                {visibleCompleted.length === 0
                  ? "0"
                  : `${visibleCompleted.length} ${showCompleted ? "▾" : "▸"}`}
              </span>
            </button>

            {showCompleted && visibleCompleted.length > 0 && (
              <div className="completed-list">
                {visibleCompleted.map((todo) => (
                  <Todo
                    key={todo.id}
                    todo={todo}
                    hideOrder
                    deleteTodo={deleteTodo}
                    toggleComplete={toggleComplete}
                    toggleIsEditing={toggleIsEditing}
                    editTodo={editTodo}
                    isLocked={isLocked}
                    isActive={todo.id === activeId}
                    canStart={false}
                    status={status}
                    onStart={() => {}}
                    onPause={() => {}}
                    onFinish={() => {}}
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
          <button className="btn" disabled={!isLocked} onClick={finishActive}>
            Finish
          </button>
        </div>
      </div>
    </>
  );
}

export default TodoWrapper;
