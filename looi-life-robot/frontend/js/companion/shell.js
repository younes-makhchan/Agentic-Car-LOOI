const sections = {
  robot: ["settingsRobotBody", "settingsMovement"],
  personality: [
    "settingsPersonality",
    "settingsIdleScenarios",
    "settingsScenarios",
    "settingsFaceDemo",
  ],
  vision: ["settingsCamera"],
  settings: [
    "settingsLocalBrain",
    "settingsStatus",
    "settingsLifeEngine",
    "settingsLog",
  ],
};
const titles = {
  robot: ["机器人", "Robot"],
  personality: ["人格", "Personality"],
  vision: ["视觉", "Vision"],
  settings: ["设置", "Settings"],
};
const icons = {
  robot: "M7 8V5h10v3M5 8h14v12H5zM9 12v2m6-2v2M9 17h6M12 2v3",
  personality: "M20 21v-2a6 6 0 0 0-12 0v2M14 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  vision:
    "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3 1 4-5 3-3-3-4 1-3-5 3-3-1-4z",
  play: "m8 4 12 8-12 8z",
  stop: "M6 6h12v12H6z",
  remote: "M8 3h8l5 18h-5l-2-5h-4l-2 5H3zM7 9h6m-3-3v6m6-3h1",
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name] ?? icons.robot}"/></svg>`;
}
export function language() {
  return document.documentElement.lang.startsWith("zh") ? 0 : 1;
}
const translations = new Map();
export function t(zh, en) {
  translations.set(zh, [zh, en]);
  translations.set(en, [zh, en]);
  return language() === 0 ? zh : en;
}
function updateLanguage() {
  for (const root of [
    document.getElementById("companionWorkspace"),
    document.getElementById("companionControls"),
    document.getElementById("companionRemote"),
  ])
    if (root) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const n = walk.currentNode;
        if (n.parentElement.closest("pre,code,textarea,script,style")) continue;
        const labels = translations.get(n.data.trim());
        if (labels) n.data = t(...labels);
      }
      for (const e of root.querySelectorAll("[aria-label]")) {
        const labels = translations.get(e.getAttribute("aria-label"));
        if (labels) e.setAttribute("aria-label", t(...labels));
      }
    }
}
export function element(tag, attrs = {}, text = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}
export function button(zh, en, action) {
  const b = element("button", { type: "button" }, t(zh, en));
  b.onclick = action;
  return b;
}
export function field(parent, zh, en, input) {
  const label = element("label", {
    class:
      "companion-field" +
      (input.tagName === "SELECT" ? " companion-select-field" : ""),
  });
  label.append(element("span", {}, t(zh, en)), input);
  parent.append(label);
  return input;
}
export function download(name, data) {
  const u = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "application/json" },
    ),
  );
  const a = element("a", { href: u, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}
export function installShell(actions) {
  document.body.classList.add("workspace-ready");
  const viewport = document.querySelector("meta[name=viewport]");
  viewport.content = "width=device-width, initial-scale=1, viewport-fit=cover";
  const shell = element("div", { id: "companionWorkspace" }),
    header = element("header", { class: "workspace-header" });
  header.innerHTML =
    '<a class="workspace-brand" href="#robot" aria-label="LOOI home">LOOI<span>1.3.0 · DF26</span></a>';
  const heading = element("h1", {}, t(...titles.robot));
  header.append(heading);
  const remote = button("遥控", "Remote", () => actions.remote());
  remote.innerHTML = icon("remote") + `<span>${t("遥控", "Remote")}</span>`;
  header.append(remote);
  shell.append(header);
  const nav = element("nav", {
    class: "workspace-nav",
    "aria-label": t("主导航", "Main navigation"),
  });
  const main = element("main", { id: "workspaceMain", tabindex: "-1" });
  const pages = {};
  let selected = localStorage.getItem("looi.workspace.page") || "robot";
  if (!sections[selected]) selected = "robot";
  let running = false;
  const select = (key, focus = false) => {
    if (running) return;
    selected = key;
    localStorage.setItem("looi.workspace.page", key);
    for (const [k, p] of Object.entries(pages)) p.hidden = k !== key;
    for (const b of nav.querySelectorAll("[data-page]"))
      b.setAttribute("aria-current", b.dataset.page === key ? "page" : "false");
    heading.textContent = t(...titles[key]);
    remote.hidden = key !== "robot";
    main.scrollTop = 0;
    if (focus) main.focus({ preventScroll: true });
  };
  for (const [key, ids] of Object.entries(sections)) {
    const page = element("section", {
      class: "workspace-page",
      "data-page": key,
      "aria-label": t(...titles[key]),
    });
    pages[key] = page;
    main.append(page);
    const b = button(...titles[key], () => select(key, true));
    b.dataset.page = key;
    b.innerHTML = icon(key) + `<span>${t(...titles[key])}</span>`;
    nav.append(b);
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.hidden = false;
      if (
        id === "settingsPersonality" ||
        id === "settingsCamera" ||
        id === "settingsRobotBody"
      ) {
        node.classList.add("workspace-card");
        page.append(node);
      } else {
        const d = element("details", { class: "workspace-card" });
        const summary = element(
          "summary",
          {},
          node.querySelector("h2,h3,h4")?.textContent || id,
        );
        d.append(summary, node);
        page.append(d);
      }
    }
  }
  const gate = document.getElementById("runtimeGate");
  if (gate) {
    gate.className = "workspace-card connect-card";
    pages.robot.prepend(gate);
    gate.querySelector("#productionStartButton")?.setAttribute("hidden", "");
  }
  const start = button("开始陪伴", "Start companionship", () =>
    actions.start(),
  );
  start.id = "companionStart";
  start.className = "workspace-play";
  start.setAttribute("aria-label", t("开始陪伴", "Start companionship"));
  start.innerHTML = icon("play");
  nav.insertBefore(start, nav.children[2]);
  shell.append(nav, main);
  document.body.append(shell);
  const status = element("aside", {
    id: "companionNotice",
    role: "status",
    "aria-live": "polite",
    hidden: "",
  });
  shell.append(status);
  const controls = element("section", {
    id: "companionControls",
    "aria-label": t("陪伴控制", "Companion controls"),
  });
  controls.hidden = true;
  const stop = button("停止陪伴", "Stop companionship", () => actions.stop());
  stop.id = "companionStop";
  stop.innerHTML = icon("stop");
  stop.setAttribute("aria-label", t("停止陪伴", "Stop companionship"));
  const top = element("div", { class: "companion-control-top" });
  const wakeState = element("span", {
    id: "companionWakeStatus",
    role: "status",
  });
  top.append(wakeState, stop);
  controls.append(top);
  const row = element("div", { class: "companion-control-row" });
  row.append(
    button("相机", "Camera", () => actions.camera()),
    button("声音", "Sound", () => actions.sound()),
    button("运动许可", "Body permission", () => actions.arm()),
    button("遥控", "Remote", () => actions.remote()),
    button("手动唤醒", "Wake now", () => actions.wake()),
    button("返回等待", "Wait", () => actions.wait()),
    button("恢复采集", "Resume capture", () => actions.resume()),
  );
  ["camera", "sound", "arm", "remote", "wake", "wait", "resume"].forEach(
    (name, index) => (row.children[index].dataset.control = name),
  );
  const input = document.getElementById("userInput"),
    send = document.getElementById("sendButton");
  if (input && send) {
    const chat = element("div", { class: "companion-chat" });
    chat.append(input, send);
    controls.append(chat);
  }
  controls.append(row);
  document.body.append(controls);
  let hideTimer;
  const showControls = () => {
    controls.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (
        running &&
        !controls.contains(document.activeElement) &&
        !document.querySelector("#companionRemote[open]")
      )
        controls.hidden = true;
    }, 5000);
  };
  document.getElementById("faceCanvas")?.addEventListener("pointerup", () => {
    if (running) showControls();
  });
  controls.addEventListener("pointerdown", showControls);
  controls.addEventListener("focusin", () => clearTimeout(hideTimer));
  controls.addEventListener("focusout", showControls);
  document.addEventListener("keydown", (e) => {
    if (running && (e.key === "Escape" || e.key === "Tab")) showControls();
  });
  for (const id of [
    "settingsPanel",
    "settingsToggleButton",
    "settingsBackdrop",
  ]) {
    const n = document.getElementById(id);
    if (n) n.hidden = true;
  }
  new MutationObserver(updateLanguage).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  select(selected);
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  document.documentElement.classList.toggle("reduce-motion", mq.matches);
  mq.addEventListener?.("change", (e) =>
    document.documentElement.classList.toggle("reduce-motion", e.matches),
  );
  const vv = window.visualViewport;
  const resize = () => {
    document.documentElement.style.setProperty(
      "--visual-height",
      `${vv?.height ?? innerHeight}px`,
    );
    document.documentElement.style.setProperty(
      "--visual-top",
      `${vv?.offsetTop ?? 0}px`,
    );
  };
  vv?.addEventListener("resize", resize);
  vv?.addEventListener("scroll", resize);
  resize();
  return {
    pages,
    select,
    controls,
    showControls,
    start,
    notice(message, retry) {
      status.replaceChildren(element("span", {}, message));
      status.hidden = !message;
      if (retry) status.append(button("重试", "Retry", retry));
      if (message)
        status.append(
          button("关闭提示", "Dismiss", () => (status.hidden = true)),
        );
    },
    setRunning(value) {
      running = value;
      document.body.classList.toggle("companion-active", value);
      shell.hidden = value;
      controls.hidden = !value;
      if (value) showControls();
      else {
        clearTimeout(hideTimer);
        select(selected);
        main.focus({ preventScroll: true });
      }
    },
    busy(value) {
      start.disabled = value;
      start.setAttribute("aria-busy", String(value));
      for (const control of controls.querySelectorAll("button,input"))
        if (control !== stop) control.disabled = value;
      stop.disabled = false;
      stop.setAttribute("aria-busy", String(value));
    },
    wakeStatus(message) {
      wakeState.textContent = message;
    },
    bringNotice() {
      if (running) document.body.append(status);
      else shell.append(status);
    },
    destroy() {
      clearTimeout(hideTimer);
    },
  };
}
