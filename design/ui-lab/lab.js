"use strict";

/**
 * Vaper UI lab: shared settings state, a simulated dictation pipeline
 * (record, live partials, process, paste), audio input (simulated voice or
 * the real microphone through the same AnalyserNode setup as renderer.js),
 * and the render loop that drives whichever direction is selected.
 */
(() => {
  const { clamp, approach, rng } = window.VaperLab;
  const variants = window.VaperVariants;
  const ORDER = ["plume", "console", "scope", "transcript", "mercury"];

  // Same options the shipping app offers (index.html, defaults.js).
  const LANGS = [
    ["auto", "Auto-detect"],
    ["en", "English"],
    ["fr", "French"],
    ["de", "German"],
    ["es", "Spanish"],
    ["it", "Italian"],
    ["pt", "Portuguese"],
    ["nl", "Dutch"],
    ["ja", "Japanese"],
    ["zh", "Chinese"],
    ["ko", "Korean"],
    ["ru", "Russian"],
    ["ar", "Arabic"],
    ["tr", "Turkish"],
    ["pl", "Polish"],
    ["uk", "Ukrainian"],
  ];
  const MODELS = [
    {
      key: "whisper-large-v3-turbo-q5",
      label: "Whisper",
      engine: "whisper",
      downloaded: true,
    },
    {
      key: "parakeet-tdt-0.6b-v3-int8",
      label: "Parakeet",
      engine: "parakeet",
      downloaded: false,
    },
    { key: "apple-speech", label: "Apple", engine: "apple", downloaded: true },
  ];
  const DEMO_MICS = [
    { id: "default", label: "MacBook Pro Microphone" },
    { id: "usb", label: "External USB Microphone" },
    { id: "airpods", label: "AirPods Pro" },
  ];
  const SCRIPTS = [
    "Move the standup to three thirty and send the notes to the design channel.",
    "Refactor the download helper so it retries twice before showing an error.",
    "Remind me to pick up oat milk on the way home.",
    "Ship the overlay redesign behind a flag and ask for a review on Friday.",
  ];

  const state = {
    variant: "plume",
    platform: "darwin",
    version: "3.5.8",
    hotkey: "fn",
    listening: false,
    heldKeys: new Set(),
    mic: "default",
    mics: DEMO_MICS.slice(),
    language: "auto",
    model: MODELS[0].key,
    dictionary: ["Vaper", "Parakeet", "Electron"],
    perms: { mic: true, access: true, se: false },
    permWaiting: { mic: false, access: false, se: false },
    update: { state: "idle", detail: "" },
    download: null,
    restartPending: false,
    mode: "idle",
    view: "main",
    menuOpen: false,
    dictOpen: false,
    partial: "",
    source: "sim",
    autoplay: true,
    freeze: "live",
    wallpaper: "dark",
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    bounds: false,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const modelMeta = () =>
    MODELS.find((m) => m.key === state.model) || MODELS[0];
  const langName = () =>
    (LANGS.find((l) => l[0] === state.language) || LANGS[0])[1];
  const micName = () =>
    (
      state.mics.find((m) => m.id === state.mic) ||
      state.mics[0] || { label: "Default" }
    ).label;

  function displayHotkey(hotkey) {
    if (hotkey === "fn") return "fn";
    return hotkey.replace(/\bAlt\b/, "Option").replace(/\bCmd\b/, "\u2318");
  }

  // ---------------------------------------------------------------- audio
  const bins = new Uint8Array(128);
  const random = rng(7);
  const live = { ctx: null, analyser: null, stream: null };
  let simClock = 0;

  /** Speech-like spectrum: syllable envelope, two moving formants, pitch comb, sibilance. */
  function simulate(talking) {
    simClock += 0.033;
    const t = simClock;
    const syll = Math.pow(
      Math.max(0, Math.sin(Math.PI * ((t * 4.3) % 1))),
      0.7,
    );
    const phrase = clamp(
      0.66 + 0.26 * Math.sin(t * 1.1) + 0.2 * Math.sin(t * 0.53 + 1.7),
    );
    const env = talking ? syll * phrase * (0.72 + random() * 0.28) : 0;
    const f1 = 520 + 260 * Math.sin(t * 6.7);
    const f2 = 1500 + 650 * Math.sin(t * 4.9 + 1.3);
    const f0 = 118 + 22 * Math.sin(t * 1.9);
    const hiss = random() < 0.16 ? 0.55 : 0.05;
    for (let i = 0; i < 128; i++) {
      const f = i * 62.5;
      const harm = 0.55 + 0.45 * Math.cos((2 * Math.PI * f) / f0);
      const formant =
        Math.exp(-(((f - f1) / 260) ** 2)) * 0.95 +
        Math.exp(-(((f - f2) / 420) ** 2)) * 0.7 +
        Math.exp(-f / 1800) * 0.35;
      const sib = Math.exp(-(((f - 5200) / 900) ** 2)) * hiss;
      const v = env * (formant * harm + sib) + 0.035 + random() * 0.03;
      bins[i] = Math.round(clamp(v * 0.95) * 255);
    }
  }

  async function enableMic() {
    try {
      const constraints =
        state.mic && state.mic !== "default" && state.source === "mic"
          ? { audio: { deviceId: { exact: state.mic } } }
          : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      disableMic();
      live.stream = stream;
      live.ctx = new AudioContext({ sampleRate: 16000 });
      const src = live.ctx.createMediaStreamSource(stream);
      live.analyser = live.ctx.createAnalyser();
      live.analyser.fftSize = 256;
      src.connect(live.analyser);
      state.source = "mic";
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          id: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
      if (mics.length) {
        state.mics = mics;
        const track = stream.getAudioTracks()[0];
        const settings = track ? track.getSettings() : {};
        state.mic =
          settings.deviceId && mics.some((m) => m.id === settings.deviceId)
            ? settings.deviceId
            : mics[0].id;
      }
      buildSelects();
      announce("Live microphone on. Hold Space and speak.");
    } catch (err) {
      state.source = "sim";
      announce(
        `Microphone unavailable (${err.name}). Using the simulated voice.`,
      );
    }
    render();
  }

  function disableMic() {
    if (live.stream) live.stream.getTracks().forEach((t) => t.stop());
    if (live.ctx) live.ctx.close().catch(() => {});
    live.stream = null;
    live.ctx = null;
    live.analyser = null;
  }

  // Stream bins at ~30 fps, exactly like the renderer -> overlay IPC.
  setInterval(() => {
    if (state.source === "mic" && live.analyser)
      live.analyser.getByteFrequencyData(bins);
    else simulate(state.mode === "recording");
  }, 33);

  // ---------------------------------------------------------------- pipeline
  let modeSince = performance.now();
  let shownMode = "recording";
  let recStart = 0;
  let recEnd = 0;
  let words = [];
  let wordIdx = 0;
  let scriptIdx = 0;
  let wordTimer = 0;
  let procTimer = 0;
  let autoTimer = 0;
  let autoStopTimer = 0;

  function setMode(m) {
    state.mode = m;
    modeSince = performance.now();
    if (m !== "idle") shownMode = m;
    render();
    renderPartial();
  }

  function startTalk() {
    if (state.mode === "recording" || state.listening) return;
    clearTimeout(procTimer);
    state.partial = "";
    words = SCRIPTS[scriptIdx % SCRIPTS.length].split(" ");
    wordIdx = 0;
    recStart = performance.now();
    setMode("recording");
    clearInterval(wordTimer);
    wordTimer = setInterval(() => {
      if (wordIdx < words.length) wordIdx++;
      else if (state.freeze === "recording") wordIdx = 1;
      state.partial = words.slice(0, wordIdx).join(" ");
      renderPartial();
    }, 330);
    announce("Recording");
  }

  function stopTalk() {
    if (state.mode !== "recording") return;
    clearInterval(wordTimer);
    recEnd = performance.now();
    const text = words.slice(0, wordIdx).join(" ");
    state.partial = "";
    if (recEnd - recStart < 400 || !text) {
      setMode("idle");
      announce("Too short, nothing pasted");
      return;
    }
    scriptIdx++;
    setMode("processing");
    announce(`Transcribing with ${modelMeta().label}`);
    procTimer = setTimeout(() => {
      setMode("idle");
      paste(text);
      scheduleAuto(2400);
    }, 1500);
  }

  function scheduleAuto(delay) {
    clearTimeout(autoTimer);
    clearTimeout(autoStopTimer);
    if (!state.autoplay || state.freeze !== "live") return;
    autoTimer = setTimeout(() => {
      if (state.mode !== "idle") {
        scheduleAuto(900);
        return;
      }
      startTalk();
      autoStopTimer = setTimeout(
        () => {
          if (state.autoplay && state.mode === "recording") stopTalk();
        },
        words.length * 330 + 700,
      );
    }, delay);
  }

  function userHold(down) {
    if (state.freeze !== "live") return;
    if (down) {
      if (state.autoplay) {
        state.autoplay = false;
        clearTimeout(autoTimer);
        clearTimeout(autoStopTimer);
        render();
      }
      startTalk();
    } else {
      stopTalk();
    }
  }

  function paste(text) {
    const body = $("#notes-body");
    const placeholder = $(".notes-placeholder", body);
    if (placeholder) placeholder.remove();
    const p = document.createElement("p");
    const span = document.createElement("span");
    span.className = "notes-insert";
    span.textContent = text;
    p.appendChild(span);
    body.appendChild(p);
    while (body.children.length > 5) body.firstElementChild.remove();
    const n = text.split(/\s+/).length;
    announce(`Pasted ${n} words into Notes`);
  }

  function setFreeze(value) {
    state.freeze = value;
    clearTimeout(autoTimer);
    clearTimeout(autoStopTimer);
    clearTimeout(procTimer);
    clearInterval(wordTimer);
    if (value === "recording") {
      state.mode = "idle";
      startTalk();
      wordIdx = 4;
    } else if (value === "processing") {
      recStart = performance.now() - 6200;
      recEnd = performance.now();
      state.partial = "";
      setMode("processing");
    } else {
      setMode("idle");
      scheduleAuto(900);
    }
    render();
  }

  // ---------------------------------------------------------------- live region
  let announceTimer = 0;
  function announce(msg) {
    const el = $("#lab-live");
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      el.textContent = msg;
    }, 60);
  }

  // ---------------------------------------------------------------- settings UI
  function buildSelects() {
    $$("select[data-role='lang']").forEach((sel) => {
      sel.innerHTML = "";
      LANGS.forEach(([v, label]) => sel.add(new Option(label, v)));
    });
    $$("select[data-role='model']").forEach((sel) => {
      sel.innerHTML = "";
      MODELS.forEach((m) => sel.add(new Option(m.label, m.key)));
    });
    $$("select[data-role='mic']").forEach((sel) => {
      sel.innerHTML = "";
      state.mics.forEach((m) => sel.add(new Option(m.label, m.id)));
    });
  }

  const measure = document.createElement("canvas").getContext("2d");
  function autosize(sel) {
    const cs = getComputedStyle(sel);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const label = sel.options[sel.selectedIndex]
      ? sel.options[sel.selectedIndex].text
      : "";
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    sel.style.width = `${Math.ceil(measure.measureText(label).width + pad + 2)}px`;
  }

  function modelStatus() {
    const meta = modelMeta();
    if (state.download !== null) return `Downloading ${state.download}%`;
    if (!meta.downloaded) return "Not downloaded";
    if (state.restartPending) return "Downloaded";
    return meta.engine === "apple" ? "Ready, on-device" : "Ready";
  }

  function statusText() {
    if (state.listening) return "Press keys\u2026";
    if (state.mode === "recording") return "Listening";
    if (state.mode === "processing") return "Transcribing\u2026";
    return "Hold to talk";
  }

  function updateLabel() {
    const u = state.update;
    switch (u.state) {
      case "checking":
        return ["Checking\u2026", true, false];
      case "available":
        return [`Download v${u.detail}`, false, true];
      case "up-to-date":
        return ["Up to date", true, false];
      case "downloading":
        return [`Downloading\u2026 ${u.detail}%`, true, false];
      case "downloaded":
        return ["Restart to update", false, true];
      default:
        return ["Check for updates", false, false];
    }
  }

  function renderDictionary(root) {
    $$("[data-role='dict-list']", root).forEach((list) => {
      list.innerHTML = "";
      if (!state.dictionary.length) {
        const li = document.createElement("li");
        li.className = "dict-empty";
        li.textContent =
          "No words yet. Add names and jargon Whisper should spell exactly.";
        list.appendChild(li);
        return;
      }
      state.dictionary.forEach((word, i) => {
        const li = document.createElement("li");
        li.className = "dict-row";
        const span = document.createElement("span");
        span.className = "dict-word";
        span.textContent = word;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "dict-del";
        del.dataset.action = "dict-remove";
        del.dataset.index = String(i);
        del.setAttribute("aria-label", `Remove ${word}`);
        del.innerHTML =
          '<svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg>';
        li.append(span, del);
        list.appendChild(li);
      });
    });
  }

  function renderWindow(root) {
    const meta = modelMeta();
    root.dataset.state = state.listening ? "listening" : state.mode;
    root.dataset.view = state.view;
    $$("[data-view]", root).forEach((el) => {
      if (el === root) return;
      el.hidden = el.dataset.view !== state.view;
    });
    $$("[data-view-only]", root).forEach((el) => {
      el.hidden = el.dataset.viewOnly !== state.view;
    });
    const keyText = state.listening
      ? displayHotkey(formatKeys(state.heldKeys)) || "Press keys\u2026"
      : displayHotkey(state.hotkey);
    $$("[data-role='hotkey']", root).forEach(
      (el) => (el.textContent = keyText),
    );
    $$("[data-role='status']", root).forEach(
      (el) => (el.textContent = statusText()),
    );
    $$("[data-role='model-name']", root).forEach(
      (el) => (el.textContent = meta.label),
    );
    $$("[data-role='lang-name']", root).forEach(
      (el) => (el.textContent = langName()),
    );
    $$("[data-role='mic-name']", root).forEach(
      (el) => (el.textContent = micName()),
    );
    $$("[data-role='version']", root).forEach(
      (el) => (el.textContent = `v${state.version}`),
    );
    $$("select[data-role='lang']", root).forEach(
      (s) => (s.value = state.language),
    );
    $$("select[data-role='model']", root).forEach((s) => {
      s.value = state.model;
      s.title = `${meta.label}: ${meta.key}`;
    });
    $$("select[data-role='mic']", root).forEach((s) => (s.value = state.mic));
    $$("select[data-autosize]", root).forEach(autosize);
    $$("[data-action='reset-fn']", root).forEach((el) => {
      el.hidden = !(state.listening || state.hotkey !== "fn");
    });
    $$("[data-action='change-hotkey']", root).forEach((el) => {
      el.classList.toggle("is-invisible", state.listening);
    });
    const n = state.dictionary.length;
    $$("[data-role='dict-count']", root).forEach((el) => {
      el.textContent = n ? `${n} word${n === 1 ? "" : "s"}` : "No words";
    });
    $$("[data-role='dict-hint']", root).forEach((el) => {
      el.hidden = meta.engine === "whisper";
    });
    $$("[data-role='model-status']", root).forEach(
      (el) => (el.textContent = modelStatus()),
    );
    $$("[data-action='download']", root).forEach((el) => {
      el.hidden = meta.downloaded || state.download !== null;
      el.setAttribute("aria-label", `Download ${meta.label}`);
      el.title = `Download ${meta.label}`;
    });
    $$("[data-role='download-bar']", root).forEach((el) => {
      el.hidden = state.download === null;
      el.style.setProperty("--p", `${state.download || 0}%`);
    });
    $$("[data-action='restart']", root).forEach(
      (el) => (el.hidden = !state.restartPending),
    );
    const [uText, uDisabled, uHighlight] = updateLabel();
    $$("[data-action='update']", root).forEach((el) => {
      el.textContent = uText;
      el.disabled = uDisabled;
      el.classList.toggle("is-primary", uHighlight);
    });
    $$("[data-perm]", root).forEach((row) => {
      const key = row.dataset.perm;
      row.dataset.granted = String(state.perms[key]);
      $$("[data-role='perm-status']", row).forEach(
        (el) => (el.hidden = !state.perms[key]),
      );
      $$("[data-action='grant']", row).forEach((el) => {
        el.hidden = state.perms[key];
        el.disabled = state.permWaiting[key];
        el.textContent = state.permWaiting[key] ? "Waiting\u2026" : "Grant";
      });
    });
    $$("[data-role='menu']", root).forEach(
      (el) => (el.hidden = !state.menuOpen),
    );
    $$("[data-action='menu']", root).forEach((el) =>
      el.setAttribute("aria-expanded", String(state.menuOpen)),
    );
    $$("[data-role='dict']", root).forEach(
      (el) => (el.hidden = !state.dictOpen),
    );
    $$("[role='tab'][data-target]", root).forEach((el) => {
      const on = el.dataset.target === state.view;
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = on ? 0 : -1;
    });
    renderDictionary(root);
  }

  function render() {
    const root = activeWindow();
    if (root) renderWindow(root);
    $$("[data-lab='source']").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.value === state.source)),
    );
    $$("[data-lab='wall']").forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.value === state.wallpaper),
      ),
    );
    $$("[data-lab='freeze']").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.value === state.freeze)),
    );
    $("[data-lab='autoplay']").setAttribute(
      "aria-checked",
      String(state.autoplay),
    );
    $("[data-lab='reduced']").setAttribute(
      "aria-checked",
      String(state.reduced),
    );
    $("[data-lab='bounds']").setAttribute("aria-checked", String(state.bounds));
    $(".desk").dataset.wall = state.wallpaper;
    $(".ov-window").classList.toggle("show-bounds", state.bounds);
    document.documentElement.classList.toggle("lab-reduced", state.reduced);
    const hold = $("#hold");
    hold.setAttribute("aria-pressed", String(state.mode === "recording"));
    hold.dataset.state = state.mode;
    $("#hold-label").textContent =
      state.mode === "recording"
        ? "Release to transcribe"
        : state.mode === "processing"
          ? "Transcribing\u2026"
          : "Hold to talk";
  }

  function renderPartial() {
    const ov = $(`.ov[data-overlay='${state.variant}']`);
    if (!ov) return;
    ov.dataset.mode = state.mode;
    $$("[data-role='partial']", ov).forEach((el) => {
      el.textContent = "";
      if (state.partial) {
        const bdi = document.createElement("bdi");
        bdi.textContent = state.partial;
        el.appendChild(bdi);
      }
      el.classList.toggle("is-empty", !state.partial);
    });
  }

  const activeWindow = () => $(`[data-window='${state.variant}']`);

  // ---------------------------------------------------------------- variant switch
  function selectVariant(id, focusTab) {
    if (!variants[id]) return;
    state.variant = id;
    state.view = "main";
    state.menuOpen = false;
    state.dictOpen = false;
    document.documentElement.dataset.variant = id;
    const v = variants[id];
    $$(".lab-tab").forEach((t) => {
      const on = t.dataset.variant === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focusTab) t.focus();
    });
    $$("[data-window]").forEach((w) => (w.hidden = w.dataset.window !== id));
    $$(".ov[data-overlay]").forEach(
      (o) => (o.hidden = o.dataset.overlay !== id),
    );
    $("#v-index").textContent = `0${v.index} / 05`;
    $("#v-name").textContent = v.name;
    $("#v-tagline").textContent = v.tagline;
    $("#v-thesis").textContent = v.thesis;
    $("#v-size").textContent = `Settings window, ${v.size}`;
    const notes = $("#v-notes");
    notes.innerHTML = "";
    v.notes.forEach(([title, text]) => {
      const dt = document.createElement("dt");
      dt.textContent = title;
      const dd = document.createElement("dd");
      dd.textContent = text;
      notes.append(dt, dd);
    });
    if (history.replaceState) history.replaceState(null, "", `#${id}`);
    render();
    renderPartial();
  }

  // ---------------------------------------------------------------- interactions
  function formatKeys(keys) {
    const parts = [];
    const mods = [];
    for (const k of keys) {
      if (k === "Control") mods.push("Ctrl");
      else if (k === "Alt") mods.push("Alt");
      else if (k === "Shift") mods.push("Shift");
      else if (k === "Meta") mods.push("Cmd");
      else parts.push(k.length === 1 ? k.toUpperCase() : k);
    }
    return [...mods, ...parts].join("+");
  }

  function physicalKey(e) {
    const code = e.code;
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }

  function addWord(root) {
    const input = $("[data-role='dict-input']", root);
    if (!input) return;
    const word = input.value.trim();
    const err = $("[data-role='dict-error']", root);
    let msg = "";
    if (!word) msg = "";
    else if (/[\s,]/.test(word))
      msg = "One word at a time, without spaces or commas.";
    else if (word.length > 50) msg = "Keep words under 50 characters.";
    else if (state.dictionary.includes(word))
      msg = `${word} is already in the dictionary.`;
    else if (state.dictionary.length >= 200)
      msg = "The dictionary holds up to 200 words.";
    if (err) err.textContent = msg;
    input.setAttribute("aria-invalid", String(Boolean(msg)));
    if (msg || !word) return;
    state.dictionary.push(word);
    input.value = "";
    render();
    input.focus();
  }

  let opener = null;
  function openDict(trigger) {
    opener = trigger;
    state.dictOpen = true;
    render();
    const input = $(
      "[data-role='dict'] [data-role='dict-input']",
      activeWindow(),
    );
    if (input) input.focus();
  }
  function closeDict() {
    state.dictOpen = false;
    render();
    if (opener) opener.focus();
  }

  function goView(target) {
    state.view = target;
    state.menuOpen = false;
    render();
    const root = activeWindow();
    const focusEl =
      $(`[data-view='${target}'] h2`, root) ||
      $(`[role='tab'][data-target='${target}']`, root) ||
      $(`[data-view-only='${target}']`, root);
    if (focusEl) {
      if (!focusEl.hasAttribute("tabindex") && focusEl.tagName === "H2")
        focusEl.tabIndex = -1;
      focusEl.focus();
    }
  }

  function simulateDownload() {
    state.download = 0;
    render();
    const tick = setInterval(() => {
      state.download = Math.min(
        100,
        state.download + 3 + Math.round(random() * 6),
      );
      if (state.download >= 100) {
        clearInterval(tick);
        state.download = null;
        modelMeta().downloaded = true;
        state.restartPending = true;
        announce(`${modelMeta().label} downloaded. Restart to apply.`);
      }
      render();
    }, 120);
  }

  function simulateUpdate() {
    const u = state.update;
    if (u.state === "idle") {
      state.update = { state: "checking", detail: "" };
      setTimeout(() => {
        state.update = { state: "available", detail: "3.6.0" };
        render();
      }, 1200);
    } else if (u.state === "available") {
      state.update = { state: "downloading", detail: 0 };
      const tick = setInterval(() => {
        state.update.detail = Math.min(100, state.update.detail + 7);
        if (state.update.detail >= 100) {
          clearInterval(tick);
          state.update = { state: "downloaded", detail: "" };
        }
        render();
      }, 120);
    } else if (u.state === "downloaded") {
      state.update = { state: "up-to-date", detail: "" };
      setTimeout(() => {
        state.update = { state: "idle", detail: "" };
        render();
      }, 4000);
    }
    render();
  }

  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const lab = target.closest("[data-lab]");
    if (lab) {
      const kind = lab.dataset.lab;
      if (kind === "source") {
        if (lab.dataset.value === "mic") enableMic();
        else {
          disableMic();
          state.source = "sim";
          state.mics = DEMO_MICS.slice();
          state.mic = "default";
          buildSelects();
        }
      } else if (kind === "wall") state.wallpaper = lab.dataset.value;
      else if (kind === "freeze") setFreeze(lab.dataset.value);
      else if (kind === "autoplay") {
        state.autoplay = !state.autoplay;
        if (state.autoplay) scheduleAuto(400);
        else {
          clearTimeout(autoTimer);
          clearTimeout(autoStopTimer);
        }
      } else if (kind === "reduced") state.reduced = !state.reduced;
      else if (kind === "bounds") state.bounds = !state.bounds;
      render();
      return;
    }
    const tab = target.closest(".lab-tab");
    if (tab) {
      selectVariant(tab.dataset.variant);
      return;
    }
    const root = target.closest("[data-window]");
    if (!root) return;
    const actionEl = target.closest("[data-action]");
    if (!actionEl || actionEl.disabled) {
      if (state.menuOpen && !target.closest("[data-role='menu']")) {
        state.menuOpen = false;
        render();
      }
      if (state.dictOpen && target.matches("[data-role='dict']")) closeDict();
      return;
    }
    const action = actionEl.dataset.action;
    if (action !== "menu" && state.menuOpen) state.menuOpen = false;
    switch (action) {
      case "menu":
        state.menuOpen = !state.menuOpen;
        render();
        if (state.menuOpen) {
          const item = $("[data-role='menu'] [role='menuitem']", root);
          if (item) item.focus();
        }
        return;
      case "view":
        goView(actionEl.dataset.target);
        return;
      case "change-hotkey":
        if (state.mode !== "idle") return;
        state.listening = true;
        state.heldKeys.clear();
        break;
      case "reset-fn":
        state.hotkey = "fn";
        state.listening = false;
        break;
      case "dict-open":
        openDict(actionEl);
        return;
      case "dict-close":
        closeDict();
        return;
      case "dict-add":
        addWord(root);
        return;
      case "dict-remove":
        state.dictionary.splice(Number(actionEl.dataset.index), 1);
        render();
        {
          const next =
            $("[data-action='dict-remove']", root) ||
            $("[data-role='dict-input']", root);
          if (next) next.focus();
        }
        return;
      case "download":
        simulateDownload();
        return;
      case "restart":
        state.restartPending = false;
        announce("Restarted. New engine active.");
        break;
      case "update":
        simulateUpdate();
        return;
      case "grant": {
        const key = actionEl.closest("[data-perm]").dataset.perm;
        state.permWaiting[key] = true;
        render();
        setTimeout(() => {
          state.permWaiting[key] = false;
          state.perms[key] = true;
          announce("Permission granted");
          render();
        }, 1400);
        return;
      }
      default:
        break;
    }
    render();
  });

  document.addEventListener("change", (e) => {
    const sel = e.target;
    if (!(sel instanceof HTMLSelectElement)) return;
    const role = sel.dataset.role;
    if (role === "lang") state.language = sel.value;
    else if (role === "mic") {
      state.mic = sel.value;
      if (state.source === "mic") enableMic();
    } else if (role === "model") {
      state.model = sel.value;
      state.restartPending = false;
    } else return;
    render();
  });

  // Pointer focus on selects should not leave a ring behind after the native popup closes.
  document.addEventListener("pointerdown", (e) => {
    const sel = e.target instanceof Element ? e.target.closest("select") : null;
    if (sel) sel.classList.add("pointer-focus");
  });
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement)
      e.target.classList.remove("pointer-focus");
  });
  document.addEventListener("focusout", (e) => {
    if (e.target instanceof HTMLSelectElement)
      e.target.classList.remove("pointer-focus");
  });

  const isEditable = (el) =>
    el instanceof HTMLElement &&
    (el.isContentEditable ||
      ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(el.tagName) ||
      el.getAttribute("role") === "tab" ||
      el.getAttribute("role") === "switch");

  document.addEventListener("keydown", (e) => {
    if (state.listening) {
      e.preventDefault();
      if (e.code === "Escape") {
        state.listening = false;
        render();
        return;
      }
      const MODS = ["Control", "Alt", "Shift", "Meta"];
      state.heldKeys.add(MODS.includes(e.key) ? e.key : physicalKey(e));
      render();
      return;
    }
    if (e.key === "Escape") {
      if (state.dictOpen) closeDict();
      else if (state.menuOpen) {
        state.menuOpen = false;
        render();
        const btn = $("[data-action='menu']", activeWindow());
        if (btn) btn.focus();
      }
      return;
    }
    if (
      e.target instanceof HTMLInputElement &&
      e.target.dataset.role === "dict-input"
    ) {
      if (e.key === "Enter") {
        e.preventDefault();
        addWord(e.target.closest("[data-window]"));
      } else if (e.key === " " || e.key === ",") e.preventDefault();
      return;
    }
    const role =
      e.target instanceof Element ? e.target.getAttribute("role") : null;
    if (role === "tab" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const list = e.target.closest("[role='tablist']");
      const tabs = $$("[role='tab']", list);
      const i = tabs.indexOf(e.target);
      const next =
        tabs[
          (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
        ];
      if (next.classList.contains("lab-tab"))
        selectVariant(next.dataset.variant, true);
      else {
        goView(next.dataset.target);
        next.focus();
      }
      return;
    }
    if (
      e.target &&
      e.target.id === "hold" &&
      (e.code === "Space" || e.code === "Enter")
    ) {
      e.preventDefault();
      if (!e.repeat) userHold(true);
      return;
    }
    const digit = /^Digit([1-5])$/.exec(e.code);
    const typing =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement;
    if (digit && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      selectVariant(ORDER[Number(digit[1]) - 1]);
      return;
    }
    // Space keeps its native meaning on buttons, tabs and switches.
    if (isEditable(e.target)) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) userHold(true);
    }
  });

  document.addEventListener("keyup", (e) => {
    if (state.listening) {
      e.preventDefault();
      if (!state.heldKeys.size) return;
      const hk = formatKeys(state.heldKeys);
      state.heldKeys.clear();
      if (hk) {
        state.hotkey = hk;
        state.listening = false;
        announce(`Shortcut set to ${displayHotkey(hk)}`);
      }
      render();
      return;
    }
    if (
      e.code === "Space" ||
      (e.target && e.target.id === "hold" && e.code === "Enter")
    )
      userHold(false);
  });

  const hold = $("#hold");
  hold.addEventListener("pointerdown", (e) => {
    hold.setPointerCapture(e.pointerId);
    userHold(true);
  });
  hold.addEventListener("pointerup", () => userHold(false));
  hold.addEventListener("pointercancel", () => userHold(false));
  window.addEventListener("blur", () => userHold(false));

  // ---------------------------------------------------------------- render loop
  const BANDS = 32;
  const bands = new Float32Array(BANDS);
  const usable = Math.max(1, Math.floor(128 * 0.45));
  let alpha = 0;
  let level = 0;
  let peak = 0;
  let last = 0;

  /** Same normalisation as readBarLevel() in src/renderer/visualizer.js. */
  function readBand(i) {
    const start = Math.floor((i / BANDS) * usable);
    const end = Math.max(start + 1, Math.floor(((i + 1) / BANDS) * usable));
    let total = 0;
    for (let b = start; b < end; b++) total += bins[b];
    const norm = clamp((total / (end - start) / 255 - 0.06) / 0.64);
    // Display gain: speech sits low in this range, so lift it perceptually.
    return clamp(Math.pow(norm, 0.62) * 1.15);
  }

  function frame(ts) {
    const dt = last ? Math.min(ts - last, 50) : 16.67;
    last = ts;
    const recording = state.mode === "recording";
    let sum = 0;
    let max = 0;
    for (let i = 0; i < BANDS; i++) {
      const raw = recording ? readBand(i) : 0;
      const rate = raw > bands[i] ? 0.38 : 0.14;
      bands[i] = approach(bands[i], raw, rate, dt);
      sum += bands[i];
      if (bands[i] > max) max = bands[i];
    }
    level = sum / BANDS;
    peak = max;
    alpha = state.reduced
      ? state.mode === "idle"
        ? 0
        : 1
      : approach(alpha, state.mode === "idle" ? 0 : 1, 0.16, dt);
    if (alpha < 0.004 && state.mode === "idle") alpha = 0;
    const now = performance.now();
    const f = {
      t: ts / 1000,
      dt,
      mode: state.mode === "idle" ? shownMode : state.mode,
      live: state.mode,
      since: now - modeSince,
      alpha,
      bands,
      level,
      peak,
      reduced: state.reduced,
      elapsed: state.mode === "recording" ? now - recStart : recEnd - recStart,
    };
    const v = variants[state.variant];
    v.overlay(f);
    v.windowViz(f);
    const ov = $(`.ov[data-overlay='${state.variant}']`);
    if (ov) ov.style.setProperty("--alpha", alpha.toFixed(3));
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    ORDER.forEach((id) => {
      const w = $(`[data-window='${id}']`);
      const o = $(`.ov[data-overlay='${id}']`);
      variants[id].init({
        windowRoot: w,
        overlayRoot: o,
        windowCanvas: $("[data-role='window-viz']", w),
        overlayCanvas: $("canvas", o),
      });
    });
    buildSelects();
    const fromHash = location.hash.slice(1);
    selectVariant(ORDER.includes(fromHash) ? fromHash : "plume");
    requestAnimationFrame(frame);
    scheduleAuto(1200);
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .addEventListener("change", (e) => {
        state.reduced = e.matches;
        render();
      });
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot);
  else boot();
})();
