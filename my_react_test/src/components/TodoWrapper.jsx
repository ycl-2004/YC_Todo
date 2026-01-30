import CreateForm from "./CreateForm";
import Todo from "./Todo";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";

const STORAGE_KEY = "menubar_todo_v1";
const SETTINGS_KEY = "menubar_todo_settings_v1";
const TITLE_KEY = "menubar_title_v1";

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

function TodoWrapper() {
  // -----------------------------
  // Load initial state from storage
  // -----------------------------
  const initialLoadedRef = useRef(false);

  const TAGS = ["All", "Study", "Exam", "Life", "Daily", "Other"];
  const [activeTag, setActiveTag] = useState("All");

  const [accent, setAccent] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (safeParse(raw, null)?.accent ?? "#d4a5c1") : "#d4a5c1";
  });

  const [themeMode, setThemeMode] = useState(() => {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (safeParse(raw, null)?.themeMode ?? "system") : "system"; // "light" | "dark" | "system"
  });

  const [title, setTitle] = useState(() => {
    return localStorage.getItem(TITLE_KEY) || "YC Todo";
  });

  const [subtitle, setSubtitle] = useState(() => {
    return localStorage.getItem(`${TITLE_KEY}_subtitle`) || "想她了就學習吧";
  });

  const [editing, setEditing] = useState(null);
  // "title" | "subtitle" | null

  const [todos, setTodos] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    if (data?.todos?.length) return data.todos;

    // fallback seed
    return [
      {
        content: "學習1",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Study",
      },
      {
        content: "學習2",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Study",
      },
      {
        content: "學習3",
        id: Math.random(),
        isCompleted: false,
        isEditing: false,
        minutes: 25,
        tag: "Study",
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
    return data?.timer?.status ?? "idle"; // idle | running | paused
  });

  const [remainingSec, setRemainingSec] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? safeParse(raw, null) : null;
    return data?.timer?.remainingSec ?? 0;
  });

  const endAtRef = useRef(null); // number | null

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
    [todos, activeId],
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
    return data?.ui?.sound?.volume ?? 1; // 0..3.5
  });

  const [showSoundPanel, setShowSoundPanel] = useState(false);

  const audioRef = useRef(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);

  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const sourceRef = useRef(null);

  // click outside close
  const soundPanelWrapRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (!showSoundPanel) return;
      if (!soundPanelWrapRef.current) return;
      if (soundPanelWrapRef.current.contains(e.target)) return;
      setShowSoundPanel(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSoundPanel]);

  const syncAudioState = () => {
    const a = audioRef.current;
    if (!a) return;
    setIsSoundPlaying(!a.paused && !a.ended);
  };
  // ✅ 重建整個音訊鏈（Audio + AudioContext + Gain）
  const rebuildAudioGraph = async () => {
    // 保留舊的播放資訊（如果有）
    const old = audioRef.current;
    const oldSrc = old?.src || "";
    const oldTime = old?.currentTime || 0;
    const wasPlaying = old ? !old.paused && !old.ended : false;

    // 先停掉舊的
    try {
      old?.pause();
    } catch {}

    // ⚠️ 同一個 <audio> 不能 createMediaElementSource 第二次
    // 所以「重建 ctx」時，一定也要「重建 audio element」
    audioRef.current = new Audio();
    const a = audioRef.current;
    a.volume = 1;

    // 重新塞回 src
    if (oldSrc) a.src = oldSrc;
    try {
      a.currentTime = oldTime;
    } catch {}

    // 關掉舊 ctx（如果還活著）
    try {
      await audioCtxRef.current?.close?.();
    } catch {}

    // 清掉舊節點
    audioCtxRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;

    // 建新 ctx + gain + source
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

    // 嘗試恢復播放狀態
    if (wasPlaying) {
      try {
        const p = a.play();
        if (p && typeof p.then === "function") await p;
      } catch {}
    }

    syncAudioState();
    return a;
  };

  // ✅ 確保 audio 在背景回來後仍可發聲（resume / 必要時重建）
  const ensureAudioAlive = async () => {
    // audio 一定要存在
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 1;
    }

    // ctx 不存在 → 建立一次
    if (!audioCtxRef.current) {
      await rebuildAudioGraph();
      return audioRef.current;
    }

    const ctx = audioCtxRef.current;

    // ctx 被關/壞掉 → 重建
    if (ctx.state === "closed") {
      await rebuildAudioGraph();
      return audioRef.current;
    }

    // 背景常見：ctx 會變 suspended → resume
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // resume 失敗就重建（最穩）
        await rebuildAudioGraph();
        return audioRef.current;
      }
    }

    // gain / source 不見了（偶發）→ 重建
    if (!gainRef.current || !sourceRef.current) {
      await rebuildAudioGraph();
      return audioRef.current;
    }

    // 保險：HTML audio 音量固定 1
    audioRef.current.volume = 1;
    return audioRef.current;
  };

  // ✅ 原生播放（背景保證）：交給 Rust 用系統播放器播 mp3
  const playAlarmNative = async () => {
    try {
      if (!soundPath) return false;

      // 你的 slider 是 0..3.5，macOS afplay -v 需要 0..1
      const raw = Number(soundVolume);
      const vol01 = Math.max(
        0,
        Math.min(1, Number.isFinite(raw) ? raw / 3.5 : 1),
      );

      await invoke("play_alarm", {
        path: soundPath,
        volume: vol01,
      });

      return true;
    } catch (e) {
      console.error("[alarm] native play failed:", e);
      return false;
    }
  };

  const stopAlarmNative = async () => {
    try {
      await invoke("stop_alarm");
      return true;
    } catch (e) {
      console.error("[alarm] native stop failed:", e);
      return false;
    }
  };

  const playAlarmSound = async () => {
    if (!soundDataUrl) return false;

    try {
      const a = await ensureAudioAlive();

      // ✅ 如果 AudioContext 沒在 running，就代表「可能會看起來播放但沒聲音」
      // 這時直接回 false，讓通知 beep 當保險
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

  // ✅ App 從背景回來時，強制喚醒 AudioContext（避免「看起來在播但沒聲音」）
  useEffect(() => {
    const wake = async () => {
      // 只要有選音樂，就嘗試喚醒
      if (!soundDataUrl) return;
      try {
        await ensureAudioAlive();
        // 如果音樂其實正在播（但 ctx 被 suspend），resume 後通常會回來
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

  const playSoundNow = async () => {
    try {
      // ✅ Case 1: 沒有 dataUrl 但有 path → 先從檔案重建 blob url 再播
      if (!soundDataUrl && soundPath) {
        try {
          // 先把舊的 blob url revoke（避免 leak）
          revokeUrlIfNeeded(soundDataUrl);

          const bytes = await readFile(soundPath);
          const uint8 =
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          const blob = new Blob([uint8], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);

          // 存回 state（之後 UI 會顯示 Selected / Play 可用）
          setSoundDataUrl(url);

          const a = await ensureAudioAlive();

          // 設定音量（用 gain）
          if (gainRef.current) {
            gainRef.current.gain.value = Number(soundVolume) || 1;
          }

          // ✅ 直接用新的 url 播放
          a.pause();
          a.currentTime = 0;
          a.src = url;

          const p = a.play();
          if (p && typeof p.then === "function") await p;

          syncAudioState();
          return;
        } catch (e) {
          console.error("[sound] rebuild blob from path failed:", e);
          alert("Play failed (rebuild from path): " + String(e));
          return;
        }
      }

      // ✅ Case 2: 沒 dataUrl 也沒 path → 無法播放
      if (!soundDataUrl) return;

      // ✅ 正常播放流程：用現有 soundDataUrl
      const a = await ensureAudioAlive();

      if (a.src !== soundDataUrl) a.src = soundDataUrl;

      if (gainRef.current) {
        gainRef.current.gain.value = Number(soundVolume) || 1;
      }

      // paused -> resume, playing -> restart
      if (a.paused) {
        const p = a.play();
        if (p && typeof p.then === "function") await p;
      } else {
        a.currentTime = 0;
        const p = a.play();
        if (p && typeof p.then === "function") await p;
      }

      syncAudioState();
    } catch (e) {
      console.error("[sound] playSoundNow failed:", e);
      alert("Play failed: " + String(e));
    }
  };

  const togglePauseResume = async () => {
    const a = audioRef.current;
    if (!a) return;

    try {
      if (!a.paused) {
        a.pause();
        syncAudioState();
        return;
      }

      // resume
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

      // ✅ revoke old url to avoid leaks
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

    stopSound(); // web audio stop
    try {
      await invoke("stop_alarm"); // ✅ native stop
    } catch {}
  };

  // keep isSoundPlaying state in sync
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

  // when volume changes, update gain
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

        // ✅ 背景/省電狀態下可能 suspended，先嘗試喚醒
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
          finishActive(true);
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
        sound: {
          //dataUrl: soundDataUrl,
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
  ]);

  useEffect(() => {
    const restore = async () => {
      if (!soundPath) return;

      // blob url 重開會失效，所以每次有 path 就重建一次 dataUrl
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

  // when remainingSec hits 0 while running -> play mp3 + notify + auto finish (once)
  useEffect(() => {
    const run = async () => {
      if (status !== "running") return;
      if (remainingSec !== 0) return;
      if (!activeTodo) return;
      if (notifiedRef.current) return;

      notifiedRef.current = true;

      const ok = await playAlarmNative();

      const isBg = document.visibilityState !== "visible";

      fireNotification({
        title: "Time’s up!",
        body: `Finished: ${activeTodo.content} (${activeTodo.minutes ?? 25}m)`,
        // ✅ 背景一律 beep（就算 mp3 看起來成功也要保險）
        beep: !ok,
      });

      finishActive(true);
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, status, activeTodo]);

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
        todo.id === id ? { ...todo, isCompleted: !todo.isCompleted } : todo,
      ),
    );
  };

  const toggleIsEditing = (id) => {
    if (isLocked) return;
    setTodos(
      todos.map((todo) => {
        if (todo.id === id) return { ...todo, isEditing: !todo.isEditing };
        return { ...todo, isEditing: false };
      }),
    );
  };

  const editTodo = (id, newContent, minutes) => {
    if (isLocked) return;
    setTodos(
      todos.map((todo) =>
        todo.id === id
          ? {
              ...todo,
              content: newContent,
              minutes: minutes ?? todo.minutes,
              isEditing: false,
            }
          : todo,
      ),
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

  const finishActive = (fromAuto = false) => {
    if (!activeId) return;

    setTodos((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, isCompleted: true, isEditing: false } : t,
      ),
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

  return (
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

            {/* ✅ 重點：header-badges 變定位容器，sound-panel absolute 才會貼著它 */}
            <div
              className="header-badges"
              style={{ position: "relative", zIndex: 10 }}
            >
              <button type="button" className="badge badge-timer">
                {headerRight}
              </button>

              <button
                type="button"
                className="badge-music"
                onClick={() => setShowSoundPanel((v) => !v)}
                aria-label="Sound"
                title="Sound"
              >
                🎵
              </button>

              {showSoundPanel && (
                <div className="sound-panel" ref={soundPanelWrapRef}>
                  <div className="sound-row">
                    <div className="sound-title">Sound</div>

                    <button
                      type="button"
                      className="sound-close"
                      onClick={() => setShowSoundPanel(false)}
                      aria-label="Close sound panel"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>

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
                </div>
              )}
            </div>
          </div>
        </header>

        <CreateForm addTodo={addTodo} isLocked={isLocked} />

        <div className="now-bar">
          <div className="now-bar-left">
            <span className="now-title">Now</span>{" "}
            {/* <-- TEMP to match style */}
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
            {TAGS.map((t) => (
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
        <button
          className="btn"
          disabled={!isLocked}
          onClick={() => finishActive(false)}
        >
          Finish
        </button>
      </div>
    </div>
  );
}

export default TodoWrapper;
