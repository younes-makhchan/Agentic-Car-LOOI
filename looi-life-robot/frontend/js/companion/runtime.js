import { IDLE_SCENARIOS } from "../idle/idleScenarioCatalog.js";
import { installShell, element, button, field, download, t } from "./shell.js";
import {
  DEFAULT_CONFIG,
  loadConfiguration,
  saveConfiguration,
  validateConfig,
  validateProfile,
  parseSized,
  profileInstruction,
  commitStorageValues,
} from "./configuration.js";
import {
  SessionCoordinator,
  MotionAuthority,
  WakePolicy,
  FollowPolicy,
  ScenePolicy,
  BoundedDiagnostics,
} from "./policies.js";
import { SharedMicrophone, pcm16 } from "./audio.js";
import { loadResources, clearResourceCache } from "./resources.js";
import { createDefaultLifeState } from "../life/state.js";
const clone = (x) => JSON.parse(JSON.stringify(x)),
  now = () => performance.now() / 1000;
export class CompanionRuntime {
  constructor(services) {
    Object.assign(this, services);
    this.session = new SessionCoordinator();
    this.wake = new WakePolicy();
    this.follow = new FollowPolicy();
    this.scenes = new ScenePolicy();
    this.diagnostics = new BoundedDiagnostics();
    this.capture = new SharedMicrophone();
    this.bodyArmed = false;
    this.active = false;
    this.busy = false;
    this.catalog = [];
    this.sceneGeneration = 0;
    this.selectedScene = null;
    this.lastThought = -Infinity;
    this.lastExpression = -Infinity;
    this.requestGeneration = 0;
    this.wakeQueue = [];
    this.capture.subscribe((samples) => this.onPCM(samples));
    this.capture.onFailure = (reason) => this.suspend(reason);
    this.motion = new MotionAuthority({
      ready: () => this.robot.isConnected(),
      send: (payload) =>
        payload.type === "stop"
          ? this.robot.waitForCommand(this.robot.stop("authority_barrier"))
          : this.robot.request(payload),
    });
    this.brain.currentGeneration = () => this.requestGeneration;
    this.brain.canApply = (token) =>
      this.active &&
      !document.hidden &&
      this.session.phase === "active" &&
      token === this.requestGeneration;
    this.live.sharedMicrophone = this.capture;
    this.live.profileInstruction = () =>
      profileInstruction(this.config.profile);
    this.live.onStatus((status) => this.onLiveStatus(status));
    this.robot.prepareManagedTest = async () => {
      await this.cancelFollow("managed_test");
      await this.cancelRemote("managed_test");
      await this.cancelScene("managed_test");
      this.managedTestLease = await this.motion.acquire("test");
    };
    this.robot.finishManagedTest = async () => {
      const lease = this.managedTestLease;
      await new Promise((r) => setTimeout(r, 350));
      if (this.motion.valid(lease)) await this.motion.stop();
    };
    this.robot.prepareUpgrade = async () => {
      this.bodyArmed = false;
      this.sceneGeneration++;
      await this.cancelFollow("upgrade");
      await this.cancelRemote("upgrade");
      await this.motion.stop();
    };
    this.queue.motionSend = (item) => this.sendExplicit(item);
    this.queue.motionStop = () => this.motion.stop();
  }
  async initialize() {
    try {
      const r = await fetch("./models/idle-scenes.json");
      if (!r.ok) throw Error("Scene catalog unavailable");
      this.catalog = (await r.json()).map((scene) => ({
        ...scene,
        pairWith: IDLE_SCENARIOS.find((s) => s.id === scene.id)?.pairWith,
      }));
      const ids = new Set(this.catalog.map((s) => s.id));
      this.config = loadConfiguration(localStorage, ids);
    } catch (e) {
      this.config = clone(DEFAULT_CONFIG);
      this.diagnostics.add(
        "configuration_error",
        "Stored configuration kept; defaults loaded",
      );
      this.initialError = e.message;
    }
    this.personality.patchProfile(this.config.profile);
    const originalSave = this.personality.save.bind(this.personality);
    this.personality.save = () => {
      const p = validateProfile(this.personality.getProfile());
      this.save({ ...this.config, profile: p });
      originalSave();
    };
    this.personality.importJson = (text) =>
      this.personality.patchProfile(validateProfile(parseSized(text)));
    this.shell = installShell({
      start: () => this.start(),
      stop: () => this.stop(),
      remote: () => this.showRemote(),
      camera: () => this.cameraToggle(),
      sound: () => this.soundToggle(),
      arm: () => this.toggleArm(),
      wake: () => this.manualWake(),
      wait: () => this.returnWaiting(),
      resume: () => this.resume(),
    });
    this.buildPages();
    this.installEvents();
    this.life.stop();
    this.brain.stop();
    this.oldIdle.stop();
    this.lifeEvents.stop();
    const legacyStart = document.getElementById("startLocalBrainButton");
    if (legacyStart) legacyStart.hidden = true;
    this.shell.select(localStorage.getItem("looi.workspace.page") || "robot");
    this.eventBus?.subscribeAll?.((event) => {
      const kind = String(event.type ?? "event");
      this.diagnostics.add(
        /^[a-z_]{1,40}$/.test(kind) ? kind : "runtime_event",
        "Observed",
      );
      if (/user_text|user_speech|touch|speech_input/.test(kind)) {
        this.scenes.interact(now());
        this.requestGeneration++;
      }
    });
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.followTimer = setInterval(() => this.followTick(), 150);
    if (this.initialError) this.error(Error(this.initialError));
    this.robot.onStatus((status) => {
      const connected = this.robot.isConnected();
      if (
        this.lastConnected !== undefined &&
        connected !== this.lastConnected
      ) {
        this.diagnostics.add(
          "connection",
          connected ? "connected" : "disconnected",
        );
        if (!connected) {
          this.sceneGeneration++;
          this.motion.stop().catch(() => {});
          this.cancelFollow("disconnected");
        }
      }
      this.lastConnected = connected;
    });
    this.diagnostics.add("ready", "Web 1.3.0");
    globalThis.__looiCompanion = this;
    return this;
  }
  save(input) {
    const next = saveConfiguration(
      localStorage,
      input,
      new Set(this.catalog.map((s) => s.id)),
    );
    const changed =
      JSON.stringify(this.config?.profile) !== JSON.stringify(next.profile);
    this.config = next;
    if (changed) {
      this.requestGeneration++;
      this.live.pendingResumeHandle = null;
      this.live.latestResumeHandle = null;
      this.diagnostics.add(
        "personality",
        "Saved profile applied to text and Live",
      );
    }
    this.renderState();
  }
  error(error, retry) {
    const reason = String(error?.message ?? error);
    this.shell?.notice(reason, retry);
    this.shell?.bringNotice();
    this.diagnostics.add(
      "error",
      /permission|denied/i.test(reason)
        ? "permission_denied"
        : /timed? out|timeout/i.test(reason)
          ? "timeout"
          : /network|connect/i.test(reason)
            ? "connection_failed"
            : "component_failure",
    );
  }
  safe(action) {
    return async () => {
      try {
        await action();
      } catch (e) {
        if (e.name !== "AbortError") this.error(e);
      }
    };
  }
  card(page, zh, en) {
    const card = element("section", { class: "workspace-card" });
    card.append(element("h2", {}, t(zh, en)));
    page.append(card);
    return card;
  }
  formValue(parent, zh, en, path, { min, max, step = 1, options } = {}) {
    const parts = path.split("."),
      get = () => parts.reduce((a, k) => a[k], this.config);
    const value = get();
    let input;
    if (options) {
      input = element("select");
      for (const [key, labels] of options) {
        input.append(element("option", { value: key }, t(...labels)));
      }
      input.value = value;
    } else if (typeof value === "boolean") {
      input = element("input", { type: "checkbox" });
      input.checked = value;
    } else {
      input = element("input", {
        type: "number",
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
      });
    }
    input.dataset.config = path;
    input.onchange = () => {
      try {
        const next = clone(this.config);
        let target = next;
        for (const key of parts.slice(0, -1)) target = target[key];
        target[parts.at(-1)] =
          input.type === "checkbox"
            ? input.checked
            : input.tagName === "SELECT"
              ? input.value
              : Number(input.value);
        this.save(next);
        input.setAttribute("aria-invalid", "false");
      } catch (e) {
        input.setAttribute("aria-invalid", "true");
        if (input.type === "checkbox") input.checked = get();
        else input.value = get();
        this.error(e);
      }
    };
    field(parent, zh, en, input);
    return input;
  }
  buildPages() {
    const { pages } = this.shell;
    const appearance = this.card(
      pages.settings,
      "语言与项目信息",
      "Language & project",
    );
    for (const n of [
      document.getElementById("languageSwitch"),
      document.querySelector(".runtime-gate__github-link"),
    ])
      if (n) appearance.append(n);
    const capabilities = this.card(
      pages.robot,
      "连接与遥控",
      "Connection & remote",
    );
    capabilities.prepend(
      element(
        "p",
        {},
        navigator.bluetooth
          ? t(
              "支持安全上下文中的 Web Bluetooth。设备管理可进行配网与 OTA。",
              "Web Bluetooth is available in a secure context. Device management includes Wi-Fi and OTA.",
            )
          : t(
              "此浏览器不支持 Web Bluetooth。请使用支持的浏览器或移动应用；已配置且可访问的本机局域网桥接仍可使用。远端服务器无法代替本机桥接。",
              "This browser does not support Web Bluetooth. Use a compatible browser or mobile app. A configured, reachable local bridge can also be used; a remote server cannot bridge this device’s LAN.",
            ),
      ),
    );
    capabilities.append(
      button("设备管理", "Device management", () =>
        document.dispatchEvent(new Event("looi-open-device-panel")),
      ),
      button("打开遥控", "Open remote", () => this.showRemote()),
    );
    this.bodyButton = button("启用身体运动", "Enable body motion", () =>
      this.toggleArm(),
    );
    capabilities.append(this.bodyButton);
    const advanced = document.getElementById("settingsIdleScenarios");
    if (advanced) {
      const toggle = element("input", { type: "checkbox" });
      toggle.checked =
        localStorage.getItem("looi.web.advancedTiming.v1") === "true";
      toggle.onchange = () =>
        localStorage.setItem(
          "looi.web.advancedTiming.v1",
          String(toggle.checked),
        );
      field(
        advanced,
        "使用 Web 高级间隔（覆盖通用间隔）",
        "Use Web advanced intervals (override common intervals)",
        toggle,
      );
      advanced.append(
        element(
          "p",
          {},
          t(
            "平衡与反向混合参数影响下一次内置身体场景的配对选择，始终受冷却和运动许可限制。",
            "Balance and opposite mixing tune the next paired built-in body scene, subject to cooldown and motion permission.",
          ),
        ),
      );
    }
    const behavior = this.card(
      pages.personality,
      "行为与待机",
      "Behavior & idle",
    );
    for (const [path, zh, en] of [
      ["enabled", "规则待机", "Rule based idle"],
      [
        "idleBody",
        "待机身体动作（默认关闭）",
        "Idle body movement (off by default)",
      ],
      ["proactiveAI", "主动思考", "Proactive thoughts"],
      ["proactiveExpression", "主动表达", "Proactive expression"],
    ])
      this.formValue(behavior, zh, en, "behavior." + path);
    for (const [k, zh, en, min, max, step] of [
      [
        "thoughtsPerMinute",
        "每分钟最多思考",
        "Maximum thoughts per minute",
        1,
        12,
        1,
      ],
      [
        "sleepAfter",
        "静默休眠（秒）",
        "Sleep after silence (seconds)",
        10,
        600,
        1,
      ],
      [
        "expressionInterval",
        "表达间隔（秒）",
        "Expression interval (seconds)",
        60,
        600,
        1,
      ],
      [
        "idleGapMultiplier",
        "全局节奏倍率",
        "Global idle interval scale",
        0.25,
        5,
        0.05,
      ],
    ])
      this.formValue(behavior, zh, en, "behavior." + k, { min, max, step });
    const idle = this.card(pages.personality, "待机场景", "Idle scenes");
    idle.append(
      element(
        "p",
        {},
        t(
          "身体动作需另行授权。预览只播放一次，关闭或切后台会请求停止。",
          "Body movement requires separate permission. Preview plays once; closing it or entering the background requests a stop.",
        ),
      ),
    );
    for (const [group, zh, en] of [
      ["first", "首次待机", "First idle"],
      ["silent", "静默间隔", "Silent interval"],
      ["conversation", "对话间隙", "Conversation gap"],
    ])
      for (const [edge, zhEdge, enEdge] of [
        ["minimum", "最小", "minimum"],
        ["maximum", "最大", "maximum"],
      ])
        this.formValue(
          idle,
          `${zh} ${zhEdge}（秒）`,
          `${en} ${enEdge} (seconds)`,
          `idle.${group}.${edge}`,
          { min: 3, max: 600 },
        );
    for (const [k, zh, en, min, max, step] of [
      ["speedScale", "速度倍率", "Speed scale", 0.25, 1.5, 0.05],
      ["durationScale", "时长倍率", "Duration scale", 0.5, 2, 0.05],
      [
        "repeatGap",
        "最短重复间隔（秒）",
        "Minimum repeat interval (seconds)",
        0,
        600,
        1,
      ],
    ])
      this.formValue(idle, zh, en, "idle." + k, { min, max, step });
    for (const scene of this.catalog) {
      const details = element("details", { class: "companion-subpage" });
      details.append(
        element(
          "summary",
          {},
          t(scene.titleZH, scene.title) +
            (scene.body
              ? t(" · 身体", " · body")
              : t(" · 表情", " · expression")),
        ),
      );
      const box = element("div");
      const defaults = {
        enabled: true,
        weight: 1,
        cooldown: 30,
        availability: "always",
        speedScale: 1,
        durationScale: 1,
      };
      const read = () => ({
        ...defaults,
        ...this.config.idle.scenes[scene.id],
      });
      for (const [k, zh, en, min, max, step] of [
        ["enabled", "启用", "Enabled"],
        ["weight", "相对权重", "Relative weight", 0, 10, 0.1],
        ["cooldown", "冷却（秒）", "Cooldown (seconds)", 0, 600, 1],
        ["speedScale", "速度倍率", "Speed scale", 0.25, 1.5, 0.05],
        ["durationScale", "时长倍率", "Duration scale", 0.5, 2, 0.05],
      ]) {
        const input = element("input", {
          type: k === "enabled" ? "checkbox" : "number",
        });
        if (k === "enabled") input.checked = read()[k];
        else {
          input.value = read()[k];
          input.min = min;
          input.max = max;
          input.step = step;
        }
        input.onchange = () => {
          const next = clone(this.config);
          next.idle.scenes[scene.id] = {
            ...read(),
            [k]: k === "enabled" ? input.checked : Number(input.value),
          };
          try {
            this.save(next);
          } catch (e) {
            input.type === "checkbox"
              ? (input.checked = read()[k])
              : (input.value = read()[k]);
            this.error(e);
          }
        };
        field(box, zh, en, input);
      }
      const select = element("select");
      for (const [v, zh, en] of [
        ["always", "所有状态", "All states"],
        ["awake", "清醒", "Awake"],
        ["sleeping", "休眠", "Sleeping"],
      ])
        select.append(element("option", { value: v }, t(zh, en)));
      select.value = read().availability;
      select.onchange = this.safe(() => {
        const next = clone(this.config);
        next.idle.scenes[scene.id] = { ...read(), availability: select.value };
        this.save(next);
      });
      field(box, "适用状态", "Availability", select);
      box.append(
        button(
          "预览一次",
          "Preview once",
          this.safe(() => this.preview(scene)),
        ),
      );
      details.append(box);
      details.addEventListener("toggle", () => {
        if (!details.open && this.selectedScene === scene.id)
          this.cancelScene("preview_closed");
      });
      idle.append(details);
    }
    const life = this.card(pages.personality, "生命状态", "Life state");
    life.append(
      element(
        "p",
        {},
        t(
          "以下为模拟状态。没有可靠输入时，用户身份、距离与障碍均为未知。",
          "These are simulated states. User identity, distance and obstacles remain unknown without reliable input.",
        ),
      ),
    );
    this.lifeView = element("div", { class: "companion-metrics" });
    life.append(this.lifeView);
    const config = this.card(
      pages.personality,
      "配置文件",
      "Configuration files",
    );
    config.append(
      element(
        "p",
        {},
        t(
          "通用陪伴配置与 iOS / Android 兼容；Web 完整备份另外包含本地高级调参，不包含凭据或设备标识。",
          "Common configuration is compatible with iOS / Android. Web backup also includes advanced local tuning and excludes credentials and device identifiers.",
        ),
      ),
    );
    const actions = element("div", { class: "companion-actions" });
    actions.append(
      button("导出通用配置", "Export common config", () =>
        download("looi-companion-1.3.0.json", this.config),
      ),
      button("导入配置", "Import configuration", () => this.importFile(false)),
      button("导出人格", "Export personality", () =>
        download("looi-personality.json", this.config.profile),
      ),
      button("导入人格", "Import personality", () => this.importFile(true)),
      button("Web 完整备份", "Web backup", () => this.exportBackup()),
      button("恢复 Web 备份", "Restore Web backup", () => this.importBackup()),
    );
    config.append(actions);
    this.buildVision(pages.vision);
    const voice = this.card(pages.settings, "语音与唤醒", "Voice & wake");
    voice.append(
      element(
        "p",
        {},
        t(
          "离线中英预设仅供 Gemini Live 使用。等待时不连接 Live，不上传音视频。后台后需手动恢复采集。",
          "Offline bilingual presets are for Gemini Live. Waiting does not connect Live or upload media. Capture must be explicitly resumed after backgrounding.",
        ),
      ),
    );
    this.formValue(voice, "离线唤醒模式", "Offline wake mode", "wake.enabled");
    this.formValue(voice, "唤醒预设", "Wake preset", "wake.preset", {
      options: [
        ["chinese", ["你好 LOOI", "你好 LOOI (Chinese)"]],
        ["english", ["Hey LOOI", "Hey LOOI (English)"]],
      ],
    });
    this.formValue(
      voice,
      "静默返回等待（秒）",
      "Silence timeout (seconds)",
      "wake.silenceTimeout",
      { min: 30, max: 300 },
    );
    this.wakeInfo = element(
      "p",
      {},
      t(
        "首次启用会下载并校验离线模型。",
        "First use downloads and verifies the offline model.",
      ),
    );
    voice.append(this.wakeInfo);
    const models = this.card(
      pages.settings,
      "本地资源与页面更新",
      "Local resources & page updates",
    );
    this.resourceStatus = element(
      "p",
      {},
      t(
        "本地模型按需加载，普通陪伴无需等待下载。",
        "Local models load on demand; ordinary companionship does not wait for them.",
      ),
    );
    models.append(
      this.resourceStatus,
      button("取消下载", "Cancel download", () => {
        this.modelAbort?.abort();
        this.visionAbort?.abort();
      }),
      button(
        "释放与清理检测模型",
        "Release & clear detector",
        this.safe(async () => {
          this.stopDetection();
          await clearResourceCache("vision");
        }),
      ),
      button(
        "释放与清理唤醒模型",
        "Release & clear wake model",
        this.safe(async () => {
          if (this.active && this.config.wake.enabled)
            await this.suspend("wake_model_released");
          this.wakeWorker?.terminate();
          this.wakeWorker = null;
          await clearResourceCache("wake");
        }),
      ),
      button(
        "检查页面更新",
        "Check page update",
        this.safe(async () => {
          const r = await navigator.serviceWorker?.getRegistration();
          await r?.update();
          this.shell.notice(
            r?.waiting
              ? t(
                  "新版本已就绪，请点击应用更新。",
                  "Update ready. Apply to restart.",
                )
              : t("已检查更新。", "Update checked."),
          );
        }),
      ),
      button(
        "应用更新",
        "Apply update",
        this.safe(async () => {
          const r = await navigator.serviceWorker?.getRegistration();
          if (!r?.waiting)
            return this.shell.notice(
              t("尚无就绪更新。", "No update is ready."),
            );
          if (
            !confirm(
              t(
                "停止陪伴并更新页面？",
                "Stop companionship and update the page?",
              ),
            )
          )
            return;
          await this.stop();
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => location.reload(),
            { once: true },
          );
          r.waiting.postMessage({ type: "activate-approved" });
        }),
      ),
    );
    this.buildDiagnostics(pages.settings);
    this.proactiveText = element("p", { "aria-live": "polite" });
    behavior.append(this.proactiveText);
  }
  async readFile() {
    const picker = element("input", {
      type: "file",
      accept: ".json,application/json",
    });
    return new Promise((resolve) => {
      picker.onchange = () => resolve(picker.files?.[0] ?? null);
      picker.oncancel = () => resolve(null);
      picker.click();
    });
  }
  async importFile(personality) {
    try {
      const file = await this.readFile();
      if (!file) return;
      if (file.size > 262144)
        throw Error("Configuration exceeds 256 KiB / 配置超过 256 KiB");
      const value = parseSized(await file.text(), 262144);
      const next = personality
        ? { ...this.config, profile: validateProfile(value) }
        : validateConfig(value, new Set(this.catalog.map((s) => s.id)));
      this.save(next);
      this.personality.patchProfile(next.profile);
      this.personality.save();
      this.shell.notice(
        t(
          "配置已完整导入。刷新配置页可查看新值。",
          "Configuration imported atomically. Reopen the configuration page to view updated values.",
        ),
      );
      this.refreshConfigInputs();
    } catch (e) {
      this.error(e);
    }
  }
  refreshConfigInputs() {
    for (const input of document.querySelectorAll("[data-config]")) {
      const v = input.dataset.config
        .split(".")
        .reduce((a, k) => a[k], this.config);
      if (input.type === "checkbox") input.checked = v;
      else input.value = v;
    }
  }
  backupKeys() {
    return [
      "looi.web.advancedTiming.v1",
      "looi.idleScenarioSettings.v2",
      "looi.bodyCalibration.v1",
      "looi.idleScenarioFrameSequencer.v1",
      "looi.scenarioFrames.v1",
      "looi.idle.settings",
      "looi.idleScenarioTuning.v1",
    ];
  }
  exportBackup() {
    const advanced = {};
    for (const key of this.backupKeys()) {
      const value = localStorage.getItem(key);
      if (value) advanced[key] = parseSized(value, 262144);
    }
    download("looi-web-backup-1.3.0.json", {
      format: "looi-web-backup",
      version: 1,
      configuration: this.config,
      advanced,
    });
  }
  async importBackup() {
    try {
      const f = await this.readFile();
      if (!f) return;
      if (f.size > 1048576) throw Error("Backup exceeds 1 MiB");
      const b = parseSized(await f.text(), 1048576);
      if (
        b.format !== "looi-web-backup" ||
        b.version !== 1 ||
        !b.advanced ||
        typeof b.advanced !== "object" ||
        Array.isArray(b.advanced)
      )
        throw Error("Invalid Web backup");
      const c = validateConfig(
        b.configuration,
        new Set(this.catalog.map((s) => s.id)),
      );
      for (const k of Object.keys(b.advanced))
        if (!this.backupKeys().includes(k))
          throw Error("Unsupported backup field");
      commitStorageValues(localStorage, [
        ["looi.companion.v1", JSON.stringify(c)],
        ...Object.entries(b.advanced).map(([key, value]) => [
          key,
          JSON.stringify(value),
        ]),
      ]);
      this.config = c;
      this.requestGeneration++;
      this.personality.patchProfile(c.profile);
      this.refreshConfigInputs();
      this.shell.notice(
        t(
          "备份已恢复；高级参数将在重载页面后生效。",
          "Backup restored; reload the page to apply advanced tuning.",
        ),
      );
    } catch (e) {
      this.error(e);
    }
  }
  buildVision(page) {
    const legacy = document.getElementById("settingsCamera");
    legacy.hidden = true;
    const card = this.card(
      page,
      "本地视觉与实验跟随",
      "Local vision & experimental follow",
    );
    card.append(
      element(
        "p",
        {},
        t(
          "不提供测距、避障或防跌落。选定目标、设置参考后，再启用陪伴跟随。丢失或接管会取消，不能自动恢复。",
          "No ranging, obstacle avoidance or fall protection. Select a target, set reference size and arm follow before companionship. Target loss or takeover cancels follow without automatic recovery.",
        ),
      ),
    );
    const preview = element("div", { class: "companion-vision" });
    this.video = document.getElementById("cameraPreview");
    this.overlay = element("canvas", { "aria-hidden": "true" });
    preview.append(this.video, this.overlay);
    card.append(preview);
    const controls = element("div", { class: "companion-actions" });
    controls.append(
      button(
        "相机开关",
        "Toggle camera",
        this.safe(() => this.cameraToggle()),
      ),
      button(
        "切换镜头",
        "Switch camera",
        this.safe(async () => {
          await this.cancelFollow("camera_changed");
          this.detections = [];
          this.follow.clear();
          await this.camera.switchCamera();
          this.mirrorPreview();
        }),
      ),
      button(
        "启用本地检测",
        "Enable detection",
        this.safe(() => this.startDetection()),
      ),
      button("关闭检测", "Disable detection", () => this.stopDetection()),
    );
    card.append(controls);
    this.detectInfo = element(
      "p",
      {},
      t("检测默认关闭。", "Detection is off."),
    );
    this.targets = element("div", { class: "companion-targets" });
    card.append(
      this.detectInfo,
      this.targets,
      button("设定选中目标的参考面积", "Set selected target reference", () => {
        if (!this.follow.calibrate(now()))
          this.error(
            Error(
              t("目标已过期，请重新选择。", "Target expired; select it again."),
            ),
          );
        else this.shell.notice(t("参考已保存。", "Reference saved."));
      }),
    );
    this.followToggle = element("input", { type: "checkbox" });
    this.followToggle.onchange = () => {
      if (this.followToggle.checked && !this.follow.reference) {
        this.followToggle.checked = false;
        this.error(
          Error(
            t(
              "请先选择目标并设置参考面积。",
              "Select a target and set reference size first.",
            ),
          ),
        );
      }
    };
    field(
      card,
      "陪伴时跟随此目标",
      "Follow this target during companionship",
      this.followToggle,
    );
  }
  buildDiagnostics(page) {
    const card = this.card(page, "集中诊断", "Diagnostics");
    card.append(
      element(
        "p",
        {},
        t(
          "最多保留 500 条事件和 100 条决策；导出不包含聊天、识别文字、音视频、凭据或设备完整标识。",
          "Keeps up to 500 events and 100 decisions. Export excludes chats, recognized text, media, credentials and full device identifiers.",
        ),
      ),
    );
    this.diagnosticView = element("pre");
    card.append(this.diagnosticView);
    const actions = element("div", { class: "companion-actions" });
    actions.append(
      button(
        "运行一次规则",
        "Run one rule",
        this.safe(() => this.runRule(true)),
      ),
      button(
        "思考一次",
        "Think once",
        this.safe(() => this.think(true)),
      ),
      button("清空记录", "Clear records", () => this.diagnostics.clear()),
      button("导出脱敏诊断", "Export redacted diagnostics", () =>
        download(
          "looi-diagnostics.json",
          this.diagnostics.export(this.publicState()),
        ),
      ),
    );
    card.append(actions);
  }
  installEvents() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.stopDetectionFrames();
        this.detections = [];
        this.follow.clear();
        this.drawDetections();
        this.suspend("background");
      } else if (this.active) this.shell.showControls();
    });
    window.addEventListener("pagehide", () => {
      this.capture.stop();
      this.live.stop("pagehide");
      this.motion.stop().catch(() => {});
    });
    window.addEventListener("blur", () => this.cancelRemote("window_blur"));
    this.video?.addEventListener("emptied", () => {
      this.detections = [];
      this.cancelFollow("camera_emptied");
      this.drawDetections();
    });
    document.addEventListener("looi-open-device-panel", () => {
      if (!this.active) this.shell.select("robot");
      this.cancelFollow("device_management");
      this.cancelScene("device_management");
    });
    document.querySelector("#workspaceMain")?.addEventListener("input", () => {
      this.requestGeneration++;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.remote?.open) {
        e.preventDefault();
        this.closeRemote();
      }
    });
    navigator.serviceWorker?.addEventListener("message", (e) => {
      if (e.data?.type === "update-ready")
        this.shell.notice(
          t(
            "页面更新已下载。可在设置中确认更新。",
            "Page update downloaded. Apply it from Settings when ready.",
          ),
        );
    });
  }
  async start() {
    const token = this.session.begin();
    if (token === null) return;
    this.sceneGeneration++;
    this.selectedScene = null;
    this.shell.busy(true);
    this.active = true;
    this.bodyArmed = false;
    this.autonomousExpression = false;
    this.shell.setRunning(true);
    this.shell.bringNotice();
    this.requestGeneration++;
    this.life.stop();
    this.life.state = createDefaultLifeState();
    this.life.setPersonalityProfile(this.config.profile);
    this.life.start();
    this.scenes.reset(now(), this.effectiveConfig().idle);
    this.balanceDebt = null;
    this.lastThought = -Infinity;
    this.lastExpression = -Infinity;
    this.live.configure(this.getConfig());
    try {
      await this.cancelLegacy?.("new_session");
      await this.motion.stop();
      if (!this.session.valid(token)) return;
      if (this.config.wake.enabled || this.getConfig().geminiLiveEnabled) {
        await this.capture.unlock();
        if (!this.session.valid(token)) return;
      }
      this.session.active(token);
      this.wakeBusy = false;
      this.wakeQueue = [];
      this.wake.wait(now());
      if (this.config.wake.enabled) {
        if (!this.getConfig().geminiLiveEnabled)
          throw Error(
            t(
              "唤醒模式需要 Gemini Live。可关闭唤醒并使用文字模式。",
              "Wake mode requires Gemini Live. Disable wake to use text mode.",
            ),
          );
        this.shell.wakeStatus(t("等待唤醒", "Waiting"));
        await this.prepareWake();
        if (!this.session.valid(token)) return;
        await this.capture.start();
      } else {
        this.wake.phase = "conversation";
        if (this.getConfig().geminiLiveEnabled) {
          await this.startLive(token);
          this.wake.phase = "conversation";
        }
      }
      if (!this.session.valid(token)) return;
      const armed =
        document.getElementById("localMotionArmedToggle")?.checked === true;
      this.bodyArmed = armed;
      if (armed && this.followToggle.checked && this.follow.start(now())) {
        this.followLease = await this.motion.acquire("follow");
        this.diagnostics.add("follow", "Selected target armed");
      }
      this.diagnostics.add("session", "Started");
    } catch (e) {
      if (this.session.valid(token)) {
        this.wake.phase = "failed";
        this.error(e, () => this.manualWake());
      }
    } finally {
      this.shell.busy(false);
      this.updateButtons();
    }
  }
  async waitForLiveSetup(token, epoch) {
    if (this.live.getStatus().setupComplete) return;
    await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(Error("Live setup timed out / 实时会话准备超时"));
      }, 20000);
      unsubscribe = this.live.onStatus((status) => {
        if (
          !this.session.valid(token) ||
          epoch !== this.liveStartEpoch ||
          status.lastError
        ) {
          clearTimeout(timer);
          unsubscribe();
          reject(Error(status.lastError || "Cancelled Live setup"));
        } else if (status.setupComplete) {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
  }
  async startLive(token = this.session.generation) {
    const epoch = (this.liveStartEpoch = (this.liveStartEpoch ?? 0) + 1);
    this.wake.phase = "connecting";
    this.shell.wakeStatus(t("连接中", "Connecting"));
    await this.live.start({ captureAudio: false });
    if (!this.session.valid(token) || epoch !== this.liveStartEpoch)
      return false;
    await this.waitForLiveSetup(token, epoch);
    if (!this.session.valid(token) || epoch !== this.liveStartEpoch)
      return false;
    await this.live.startAudioInput("shared_capture");
    if (!this.session.valid(token) || epoch !== this.liveStartEpoch)
      return false;
    this.shell.wakeStatus(t("连续对话", "Conversation"));
    return true;
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopInternal().finally(() => (this.stopping = null));
    return this.stopping;
  }
  async stopInternal() {
    this.liveStartEpoch = (this.liveStartEpoch ?? 0) + 1;
    this.modelAbort?.abort();
    this.visionAbort?.abort();
    this.session.stop();
    this.active = false;
    this.requestGeneration++;
    this.sceneGeneration++;
    this.stopWakeWorker();
    this.wake.stop();
    this.capture.stop();
    this.wakeWorker?.postMessage({ type: "reset" });
    this.live.stop("user_stop");
    this.brain.stop();
    this.life.stop();
    this.lifeEvents.stop();
    this.oldIdle.stop();
    this.queue.executionToken += 1;
    const legacyStop = this.cancelLegacy?.("user_stop");
    this.queue.clear("user_stop");
    this.follow.clear();
    this.followToggle.checked = false;
    this.bodyArmed = false;
    const armedToggle = document.getElementById("localMotionArmedToggle");
    if (armedToggle) {
      armedToggle.checked = false;
      armedToggle.dispatchEvent(new Event("change"));
    }
    this.clearRemote();
    this.shell.busy(true);
    try {
      await Promise.all([legacyStop, this.motion.stop()]);
      this.shell.notice("");
    } catch (e) {
      this.error(Error(t("停止未获确认：", "Stop unconfirmed: ") + e.message));
    } finally {
      this.shell.setRunning(false);
      this.shell.bringNotice();
      this.shell.busy(false);
      this.updateButtons();
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      screen.orientation?.unlock?.();
      this.diagnostics.add("session", "Stopped");
    }
  }
  async suspend(reason) {
    const wasActive = this.active;
    this.pausedAt = now();
    this.liveStartEpoch = (this.liveStartEpoch ?? 0) + 1;
    this.modelAbort?.abort();
    this.requestGeneration++;
    this.sceneGeneration++;
    this.session.suspend();
    this.stopWakeWorker();
    this.wake.stop("paused");
    this.capture.stop();
    this.live.stop(reason);
    this.cancelLegacy?.(reason)?.catch((e) => this.error(e));
    this.life.stop();
    this.bodyArmed = false;
    this.cancelRemote(reason);
    this.cancelScene(reason);
    this.cancelFollow(reason);
    await this.stopCameraOnBackground();
    if (wasActive) {
      this.shell.wakeStatus(
        t("已暂停，需手动恢复", "Paused; resume explicitly"),
      );
      this.shell.showControls();
      this.diagnostics.add("paused", reason);
    } else this.session.stop();
  }
  async stopCameraOnBackground() {
    if (document.hidden) {
      this.cameraWasRunning = this.camera.getCameraStatus().running;
      await this.camera.stopCamera({ quiet: true });
    }
  }
  async resume() {
    if (!this.active || document.hidden) return;
    try {
      if (this.session.phase === "suspended") {
        this.session.phase = "active";
        this.session.generation++;
        const paused = Math.max(0, now() - (this.pausedAt ?? now()));
        this.scenes.lastInteraction += paused;
        this.scenes.next += paused;
        this.life.start();
        this.wakeBusy = false;
        this.wakeQueue = [];
        this.wake.wait(now());
        await this.capture.unlock();
        if (this.config.wake.enabled) {
          await this.prepareWake();
          await this.capture.start();
          this.shell.wakeStatus(t("等待唤醒", "Waiting"));
        } else {
          await this.manualWake();
        }
        if (this.cameraWasRunning) await this.camera.startCamera();
      }
    } catch (e) {
      this.error(e, () => this.resume());
    }
  }
  async prepareWake() {
    if (this.wakeWorker && this.wakePreset === this.config.wake.preset) return;
    this.wakeWorker?.terminate();
    this.modelAbort?.abort();
    this.modelAbort = new AbortController();
    this.shell.wakeStatus(t("正在加载本地唤醒…", "Loading local wake…"));
    this.resourceStatus.textContent = t(
      "正在加载唤醒模型…",
      "Loading wake model…",
    );
    const { files } = await loadResources("wake", {
      signal: this.modelAbort.signal,
      onProgress: (p) =>
        (this.resourceStatus.textContent =
          t("唤醒模型 ", "Wake model ") + Math.round(p * 100) + "%"),
    });
    if (this.modelAbort.signal.aborted) return;
    const worker = new Worker(new URL("./wake-worker.js", import.meta.url));
    this.wakeWorker = worker;
    this.wakePreset = this.config.wake.preset;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error("Wake model initialization timed out"));
      }, 60000);
      this.cancelWakeLoad = () => {
        clearTimeout(timer);
        worker.terminate();
        reject(new DOMException("Cancelled", "AbortError"));
        this.cancelWakeLoad = null;
      };
      worker.onerror = (e) => {
        if (worker !== this.wakeWorker) return;
        clearTimeout(timer);
        reject(Error(e.message || "Wake worker failed"));
      };
      worker.onmessage = ({ data }) => {
        if (!this.isCurrentWakeMessage(worker, data)) return;
        if (data.type === "ready") {
          this.cancelWakeLoad = null;
          clearTimeout(timer);
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timer);
          worker.terminate();
          this.wakeWorker = null;
          this.wake.phase = "failed";
          const e = Error(data.reason);
          reject(e);
          this.error(e, () => this.manualWake());
        } else if (data.type === "wake") {
          this.wakeQueue = [];
          if (this.active && this.wake.phase === "waiting") this.manualWake();
        } else if (data.type === "processed") {
          this.wakeBusy = false;
          if (this.wake.phase === "waiting") {
            const next = this.wakeQueue.shift();
            if (next) this.sendWakePCM(next);
          } else this.wakeQueue = [];
        }
      };
      worker.postMessage(
        { type: "load", files, preset: this.config.wake.preset },
        Object.values(files),
      );
    });
    this.resourceStatus.textContent = t(
      "唤醒模型已校验并加载。",
      "Wake model verified and loaded.",
    );
    if (this.wake.phase === "waiting")
      this.shell.wakeStatus(t("等待唤醒", "Waiting"));
    this.wakeInfo.textContent = t(
      "本地离线识别可用。",
      "Local offline recognition is ready.",
    );
  }
  async manualWake() {
    if (
      !this.active ||
      this.wake.phase === "connecting" ||
      this.wake.phase === "conversation" ||
      this.session.phase === "suspended"
    )
      return;
    const generation = this.session.generation;
    this.wake.phase =
      this.wake.phase === "failed" ? "waiting" : this.wake.phase;
    const wakeToken = this.wake.wake(now());
    if (wakeToken === null) return;
    this.requestGeneration++;
    try {
      await this.capture.unlock();
      if (!(await this.startLive(generation))) return;
      if (!this.session.valid(generation) || this.wake.phase !== "connecting")
        return;
      const overflow = this.wake.overflow;
      const buffer = this.wake.connected(wakeToken, now());
      if (buffer && !overflow) this.live.sendSharedPCMBytes(buffer);
      this.wakeWorker?.postMessage({ type: "reset" });
      if (overflow)
        this.error(
          Error(
            t(
              "连接期间音频超过 8 秒，已清空。连接已就绪，请重说问题。",
              "Audio exceeded 8 seconds while connecting and was cleared. Ready now; please repeat your question.",
            ),
          ),
        );
      else this.shell.notice("");
      this.diagnostics.add("wake", "Conversation ready");
    } catch (e) {
      if (this.session.valid(generation)) {
        await this.live.stop("wake_failed");
        this.wake.stop("failed");
        this.error(e, () => this.manualWake());
        this.shell.wakeStatus(
          t("连接失败，可手动重试", "Connection failed; retry manually"),
        );
      }
    }
  }
  async returnWaiting() {
    if (!this.active || !this.config.wake.enabled) return;
    this.requestGeneration++;
    this.liveStartEpoch = (this.liveStartEpoch ?? 0) + 1;
    this.live.stop("return_waiting");
    this.cancelLegacy?.("return_waiting")?.catch((e) => this.error(e));
    this.bodyArmed = false;
    this.wakeBusy = false;
    this.wakeQueue = [];
    this.wake.wait(now());
    await this.cancelFollow("return_waiting");
    await this.cancelScene("return_waiting");
    this.wakeWorker?.postMessage({ type: "reset" });
    this.shell.wakeStatus(t("等待唤醒", "Waiting"));
    this.diagnostics.add("wake", "Waiting, no Live or media uplink");
    try {
      await this.prepareWake();
      await this.capture.start();
    } catch (e) {
      this.wake.stop("failed");
      this.error(e, () => this.manualWake());
    }
  }
  isCurrentWakeMessage(worker, data) {
    return (
      worker === this.wakeWorker &&
      (data.generation === undefined ||
        data.generation === this.wake.generation)
    );
  }
  stopWakeWorker() {
    this.cancelWakeLoad?.();
    this.cancelWakeLoad = null;
    const worker = this.wakeWorker;
    this.wakeWorker = null;
    worker?.terminate();
    this.wakeBusy = false;
    this.wakeQueue = [];
  }
  sendWakePCM(samples) {
    if (!this.wakeWorker || this.wake.phase !== "waiting") return;
    this.wakeBusy = true;
    this.wakeWorker.postMessage(
      { type: "pcm", samples, generation: this.wake.generation },
      [samples.buffer],
    );
  }
  onPCM(samples) {
    if (!this.active || document.hidden) return;
    const voice =
      Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length) >
      0.018;
    const bytes = pcm16(samples);
    if (this.config.wake.enabled) {
      const send = this.wake.append(
        bytes,
        now(),
        voice && this.wake.phase === "conversation",
      );
      if (send) this.live.sendSharedPCMBytes(send, samples);
      if (this.wake.phase === "waiting" && this.wakeWorker) {
        const frame = samples.slice();
        if (this.wakeBusy) {
          if (this.wakeQueue.length >= 10) {
            this.stopWakeWorker();
            this.wake.stop("failed");
            this.error(
              Error(
                t(
                  "本地唤醒处理过慢，已暂停。请手动唤醒。",
                  "Local wake processing is too slow and was paused. Wake manually.",
                ),
              ),
            );
          } else this.wakeQueue.push(frame);
        } else this.sendWakePCM(frame);
      }
    } else if (this.live.getStatus().micStreaming)
      this.live.sendSharedPCMBytes(new Uint8Array(bytes.buffer), samples);
    if (voice && this.wake.phase === "conversation") {
      this.scenes.interact(now());
      this.requestGeneration++;
    }
  }
  onLiveStatus(status) {
    if (!this.config) return;
    const previous = this.lastLiveStatus ?? {};
    if (
      status.lastInputTranscriptAt &&
      status.lastInputTranscriptAt !== previous.lastInputTranscriptAt
    )
      this.autonomousExpression = false;
    this.lastLiveStatus = status;
    if (
      status.audioPlaying ||
      status.thinking ||
      status.inputActive ||
      status.generationActive ||
      status.toolCallActive ||
      status.connecting
    )
      this.wake.lastActivity = now();
    if (status.audioPlaying && !previous.audioPlaying) {
      this.sceneGeneration++;
      this.life.applyEvent?.({ type: "speech_start", timestamp: Date.now() });
      if (this.motion.owner === "idle")
        this.motion.stop().catch((e) => this.error(e));
    }
    if (!status.audioPlaying && previous.audioPlaying)
      this.scenes.interact(now());
    if (
      this.active &&
      !document.hidden &&
      status.lastError &&
      status.lastError !== previous.lastError
    ) {
      this.wake.stop("failed");
      this.error(Error(status.lastError), () => this.manualWake());
    }
    if (
      this.active &&
      previous.connected &&
      !status.connected &&
      !status.connecting &&
      this.wake.phase === "conversation"
    ) {
      this.wake.stop("failed");
      this.error(
        Error(
          t(
            "实时会话已断开；可手动重试，陪伴仍保留。",
            "Live session disconnected. Companionship remains open; retry manually.",
          ),
        ),
        () => this.manualWake(),
      );
    }
  }
  async sendText(text, event) {
    if (!this.active || this.session.phase !== "active") return;
    const generation = this.requestGeneration;
    try {
      if (this.getConfig().geminiLiveEnabled) {
        if (!this.live.getStatus().connected)
          throw Error(
            t(
              "实时连接未就绪，请先手动唤醒或重试。",
              "Live is not ready; wake manually or retry first.",
            ),
          );
        await this.live.sendUserText(text, { source: "typed" });
      } else {
        const thought = await this.brain.thinkNow("user_text", event);
        if (generation === this.requestGeneration && this.active) {
          const message =
            thought?.text ?? thought?.response?.text ?? thought?.message;
          if (message) {
            this.proactiveText.textContent = message;
            this.shell.notice(String(message).slice(0, 1200));
          }
        }
      }
    } catch (e) {
      this.error(e);
    }
  }
  async stopBody() {
    this.cancelLegacy?.("body_stop")?.catch((e) => this.error(e));
    this.bodyArmed = false;
    this.requestGeneration++;
    this.sceneGeneration++;
    this.follow.clear();
    this.followToggle.checked = false;
    const toggle = document.getElementById("localMotionArmedToggle");
    if (toggle) {
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
    }
    try {
      await this.motion.stop();
    } catch (e) {
      this.error(Error("Stop unconfirmed / 停止未获确认: " + e.message));
    }
    this.updateButtons();
  }
  async prepareInput() {
    this.scenes.interact(now());
    this.requestGeneration++;
    this.autonomousExpression = false;
    this.life.state.lastInteractionAt = Date.now();
    if (
      this.active &&
      this.config.wake.enabled &&
      this.wake.phase !== "conversation"
    )
      await this.manualWake();
  }
  toggleArm() {
    this.bodyArmed = !this.bodyArmed;
    const toggle = document.getElementById("localMotionArmedToggle");
    if (toggle) {
      toggle.checked = this.bodyArmed;
      toggle.dispatchEvent(new Event("change"));
    }
    if (!this.bodyArmed) {
      this.cancelLegacy?.("motion_disarmed")?.catch((e) => this.error(e));
      this.cancelFollow("motion_disarmed");
      this.cancelScene("motion_disarmed");
      this.motion.stop().catch((e) => this.error(e));
    }
    this.updateButtons();
  }
  updateButtons() {
    if (this.bodyButton)
      this.bodyButton.textContent = this.bodyArmed
        ? t("关闭身体运动", "Disable body motion")
        : t("启用身体运动", "Enable body motion");
  }
  async cameraToggle() {
    try {
      if (this.camera.getCameraStatus().running) {
        await this.cancelFollow("camera_off");
        this.stopDetectionFrames();
        this.detections = [];
        await this.camera.stopCamera();
        this.drawDetections();
      } else {
        const r = await this.camera.startCamera();
        if (r?.ok === false) throw Error(r.error || "Camera unavailable");
        this.mirrorPreview();
        if (this.visionWorker) this.scheduleDetection();
      }
    } catch (e) {
      this.error(e, () => this.cameraToggle());
    }
  }
  mirrorPreview() {
    const front = this.camera.getCameraStatus().facingMode !== "environment";
    this.video.style.transform = front ? "scaleX(-1)" : "";
    this.overlay.style.transform = this.video.style.transform;
  }
  soundToggle() {
    const muted = !this.live.getStatus().outputMuted;
    this.live.setOutputMuted(muted);
    this.shell.notice(
      muted
        ? t("声音已静音。", "Sound muted.")
        : t("声音已开启。", "Sound on."),
    );
  }
  async startDetection() {
    if (this.visionWorker || this.visionLoading) return;
    this.visionLoading = true;
    this.visionAbort = new AbortController();
    try {
      if (!globalThis.OffscreenCanvas || !globalThis.createImageBitmap)
        throw Error(
          t(
            "此浏览器缺少本地检测所需的 Worker 图像能力。",
            "This browser lacks Worker image support required for local detection.",
          ),
        );
      const { files } = await loadResources("vision", {
        signal: this.visionAbort.signal,
        onProgress: (p) =>
          (this.resourceStatus.textContent =
            t("检测模型 ", "Detector ") + Math.round(p * 100) + "%"),
      });
      if (this.visionAbort.signal.aborted) return;
      const worker = new Worker(new URL("./vision-worker.js", import.meta.url));
      this.visionWorker = worker;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.terminate();
          reject(Error("Detector initialization timed out"));
        }, 60000);
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(Error(e.message || "Detector worker failed"));
        };
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (data.type === "error") {
            clearTimeout(timer);
            this.stopDetection();
            reject(Error(data.reason));
            this.error(Error(data.reason));
          } else if (data.type === "detections") {
            this.detectBusy = false;
            this.detectMs = data.ms;
            this.detectInterval = Math.max(100, Math.min(1000, data.ms * 1.5));
            this.detections = data.values;
            this.follow.update(data.values, now());
            this.drawDetections();
            this.targets.replaceChildren(
              ...data.values.map((d) =>
                button(
                  `${d.label} ${Math.round(d.confidence * 100)}%`,
                  `${d.label} ${Math.round(d.confidence * 100)}%`,
                  () => {
                    this.follow.select(d);
                    this.followToggle.checked = false;
                    this.drawDetections();
                  },
                ),
              ),
            );
            const categories = [...new Set(data.values.map((d) => d.label))]
              .sort()
              .join(",");
            if (categories !== this.lastCategories) {
              this.lastCategories = categories;
              this.life.state.curiosity = Math.min(
                1,
                this.life.state.curiosity + 0.02,
              );
              this.diagnostics.add("vision", "Valid local categories changed");
            }
          }
        };
        worker.postMessage({ type: "load", files }, Object.values(files));
      });
      this.detectInfo.textContent = t(
        "本地检测已开启；最高 10 Hz。",
        "Local detection enabled; up to 10 Hz.",
      );
      if (!this.camera.getCameraStatus().running) await this.cameraToggle();
      this.scheduleDetection();
    } catch (e) {
      this.visionWorker?.terminate();
      this.visionWorker = null;
      if (e.name !== "AbortError") this.error(e, () => this.startDetection());
    } finally {
      this.visionLoading = false;
    }
  }
  scheduleDetection() {
    cancelAnimationFrame(this.visionRAF);
    const loop = async () => {
      this.visionRAF = requestAnimationFrame(loop);
      if (
        !this.visionWorker ||
        document.hidden ||
        this.video.readyState < 2 ||
        this.detectBusy ||
        performance.now() - (this.lastDetectAt ?? 0) <
          (this.detectInterval ?? 100)
      )
        return;
      this.detectBusy = true;
      this.lastDetectAt = performance.now();
      const generation = this.visionWorker;
      try {
        const frame = await createImageBitmap(this.video);
        if (this.visionWorker !== generation) {
          frame.close();
          this.detectBusy = false;
          return;
        }
        generation.postMessage(
          { type: "frame", frame, timestamp: performance.now() },
          [frame],
        );
      } catch (e) {
        this.detectBusy = false;
        this.error(e);
        this.stopDetectionFrames();
      }
    };
    this.visionRAF = requestAnimationFrame(loop);
  }
  stopDetectionFrames() {
    cancelAnimationFrame(this.visionRAF);
    this.visionRAF = null;
  }
  stopDetection() {
    this.visionAbort?.abort();
    this.stopDetectionFrames();
    this.visionWorker?.terminate();
    this.visionWorker = null;
    this.detectBusy = false;
    this.detections = [];
    this.targets?.replaceChildren();
    this.cancelFollow("detection_off");
    this.drawDetections();
    if (this.detectInfo)
      this.detectInfo.textContent = t("检测已关闭。", "Detection off.");
  }
  drawDetections() {
    if (!this.overlay) return;
    const w = this.video.videoWidth || 640,
      h = this.video.videoHeight || 480;
    this.overlay.width = w;
    this.overlay.height = h;
    const c = this.overlay.getContext("2d");
    c.clearRect(0, 0, w, h);
    for (const d of this.detections ?? []) {
      if (now() - d.time > 0.3) continue;
      c.strokeStyle = this.follow.target?.box === d.box ? "#f5d479" : "#b6edd4";
      c.lineWidth = 3;
      c.strokeRect(d.box.x * w, d.box.y * h, d.box.w * w, d.box.h * h);
    }
  }
  async cancelFollow(reason) {
    const was = this.follow.enabled || this.followLease;
    this.follow.clear();
    this.followToggle && (this.followToggle.checked = false);
    this.followLease = null;
    if (was) {
      this.diagnostics.add("follow_cancel", reason);
      try {
        await this.motion.stop();
      } catch (e) {
        this.error(Error("Stop unconfirmed / 停止未获确认: " + e.message));
      }
    }
  }
  async followTick() {
    if (!this.active || !this.follow.enabled) return;
    if (this.followSending) return;
    const intent = this.follow.intent(now());
    if (
      !this.follow.enabled ||
      !this.robot.isConnected() ||
      !this.bodyArmed ||
      document.hidden
    ) {
      await this.cancelFollow("stale_lost_or_disconnected");
      return;
    }
    this.followSending = true;
    try {
      if (!this.motion.valid(this.followLease)) {
        await this.cancelFollow("control_taken");
        return;
      }
      await this.motion.motion(
        { ...intent, duration_ms: 150 },
        this.followLease,
      );
    } catch (e) {
      await this.cancelFollow("transport_error");
      this.error(e);
    } finally {
      this.followSending = false;
    }
  }
  async sendExplicit(item) {
    if (this.autonomousExpression)
      throw Error("Automatic expression cannot command body movement");
    if (!this.bodyArmed) throw Error("Body motion disabled / 身体运动未授权");
    if (this.follow.enabled)
      throw Error("Follow owns body motion / 跟随正在使用身体");
    if (
      document.hidden ||
      document.getElementById("deviceManagement")?.open ||
      this.session.phase === "suspended" ||
      (this.config.wake.enabled &&
        this.active &&
        this.wake.phase !== "conversation")
    )
      throw Error("Motion paused / 运动已暂停");
    this.sceneGeneration++;
    this.requestGeneration++;
    const generation = this.session.generation;
    const queueToken = this.queue.executionToken;
    let lease = this.explicitLease;
    if (!this.motion.valid(lease)) {
      lease = await this.motion.acquire("explicit");
      this.explicitLease = lease;
    }
    if (
      generation !== this.session.generation ||
      queueToken !== this.queue.executionToken
    )
      throw Error("Cancelled motion");
    await this.motion.motion(
      {
        linear: item.linear,
        angular: item.angular,
        duration_ms: item.durationMs,
        ramp_ms: item.rampMs ?? 0,
      },
      lease,
    );
    return { messageId: "acknowledged" };
  }
  async preview(scene) {
    await this.cancelScene("new_preview");
    if (scene.body && !this.bodyArmed)
      throw Error(
        t(
          "请先在机器人页授权身体运动。",
          "Enable body motion on the Robot page first.",
        ),
      );
    await this.cancelFollow("preview");
    return this.executeScene(scene, "test");
  }
  async cancelScene(reason) {
    this.sceneGeneration++;
    this.selectedScene = null;
    if (["idle", "test"].includes(this.motion.owner)) {
      try {
        await this.motion.stop();
      } catch (e) {
        this.error(e);
      }
    }
    this.diagnostics.add("scene_cancel", reason);
  }
  async executeScene(scene, source = "idle") {
    const generation = ++this.sceneGeneration;
    this.selectedScene = scene.id;
    const s = this.config.idle.scenes[scene.id] ?? {};
    const duration = this.config.idle.durationScale * (s.durationScale ?? 1),
      speed = this.config.idle.speedScale * (s.speedScale ?? 1);
    if (scene.body && (this.lastLiveStatus?.audioPlaying || !this.bodyArmed))
      return;
    let lease;
    try {
      if (scene.body) lease = await this.motion.acquire(source);
      const delay = Math.round(
        (1 - this.config.profile.behaviorStyle.reactionSpeed) * 250,
      );
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (generation !== this.sceneGeneration) return;
      this.pose(scene.pose || "pose_neutral");
      this.diagnostics.add("scene", scene.id, true);
      for (const step of scene.steps) {
        if (
          generation !== this.sceneGeneration ||
          document.hidden ||
          (source === "idle" && (!this.active || this.follow.enabled)) ||
          !this.motion.valid(lease)
        )
          return;
        if (step.kind === "stop") {
          await this.motion.stop();
          lease = await this.motion.acquire(source);
        } else
          await this.motion.motion(
            {
              linear: Math.max(
                -0.1,
                Math.min(0.1, ((step.left + step.right) / 2) * speed),
              ),
              angular: Math.max(
                -0.1,
                Math.min(0.1, ((step.right - step.left) / 2) * speed),
              ),
              duration_ms: Math.min(1000, step.durationMs * duration),
              ramp_ms:
                step.rampMs ??
                Math.min(
                  150,
                  step.durationMs *
                    this.config.profile.behaviorStyle.movementSoftness *
                    0.4,
                ),
            },
            lease,
          );
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(1000, step.durationMs * duration) + (step.pauseMs ?? 0),
          ),
        );
      }
    } finally {
      if (lease && this.motion.valid(lease)) {
        try {
          await this.motion.stop();
        } catch (e) {
          this.error(e);
        }
      }
      if (generation === this.sceneGeneration) this.selectedScene = null;
    }
  }
  webAdvanced() {
    let value = {};
    try {
      value = JSON.parse(
        localStorage.getItem("looi.idleScenarioSettings.v2") || "{}",
      );
    } catch {}
    const number = (key, fallback, min, max) =>
      typeof value[key] === "number" && Number.isFinite(value[key])
        ? Math.max(min, Math.min(max, value[key]))
        : fallback;
    return {
      balanceStartPercent: number("balanceStartPercent", 20, 0, 100),
      balanceIncrementPercent: number("balanceIncrementPercent", 20, 0, 100),
      oppositeMixPercent: number("oppositeMixPercent", 25, 0, 100),
      firstIdleMinSec: number("firstIdleMinSec", 1, 1, 120),
      firstIdleMaxSec: number("firstIdleMaxSec", 4, 1, 120),
      silentIdleMinSec: number("silentIdleMinSec", 1, 1, 120),
      silentIdleMaxSec: number("silentIdleMaxSec", 4, 1, 120),
      speakingIdleMinSec: number("speakingIdleMinSec", 1, 1, 120),
      speakingIdleMaxSec: number("speakingIdleMaxSec", 4, 1, 120),
    };
  }
  effectiveConfig() {
    if (localStorage.getItem("looi.web.advancedTiming.v1") !== "true")
      return this.config;
    const c = clone(this.config),
      a = this.webAdvanced();
    for (const [key, prefix] of [
      ["first", "firstIdle"],
      ["silent", "silentIdle"],
      ["conversation", "speakingIdle"],
    ]) {
      const min = a[prefix + "MinSec"];
      c.idle[key] = {
        minimum: min,
        maximum: Math.max(min, a[prefix + "MaxSec"]),
      };
    }
    return c;
  }
  async runRule(manual = false) {
    if (
      !this.active ||
      document.hidden ||
      this.selectedScene ||
      this.follow.enabled ||
      this.motion.owner ||
      this.remote?.open ||
      document.getElementById("deviceManagement")?.open
    )
      return;
    const state = this.life.getState(),
      sleeping =
        now() - this.scenes.lastInteraction >= this.config.behavior.sleepAfter;
    const scene = this.scenes.select(
      now(),
      this.catalog,
      this.effectiveConfig(),
      {
        manual,
        body:
          this.bodyArmed &&
          this.config.behavior.idleBody &&
          this.wake.phase === "conversation",
        speaking: this.lastLiveStatus?.audioPlaying,
        sleeping,
        conversation: this.wake.phase === "conversation",
        mood: state.mood,
      },
    );
    if (!scene) {
      this.pose("pose_neutral");
      return;
    }
    const settings = this.webAdvanced();
    if (
      scene.body &&
      this.balanceDebt &&
      Math.random() < this.balanceDebt.chance
    ) {
      const pair = this.catalog.find((s) => s.id === this.balanceDebt.id);
      if (
        pair &&
        this.scenes.eligible(pair, now(), this.config.idle, {
          body: this.bodyArmed && this.config.behavior.idleBody,
          speaking: this.lastLiveStatus?.audioPlaying,
        })
      ) {
        this.scenes.admit(pair, now());
        await this.executeScene(pair);
        this.balanceDebt = null;
        return;
      }
    }
    await this.executeScene(scene);
    if (scene.body && scene.pairWith) {
      this.balanceDebt = {
        id: scene.pairWith,
        chance: Math.min(
          1,
          (this.balanceDebt?.chance ?? settings.balanceStartPercent / 100) +
            settings.balanceIncrementPercent / 100,
        ),
      };
      if (Math.random() < settings.oppositeMixPercent / 100)
        this.balanceDebt.chance = 1;
    }
  }
  async think(manual = false) {
    if (
      !this.active ||
      document.hidden ||
      this.wake.phase !== "conversation" ||
      this.thinking
    )
      return;
    if (!manual && !this.config.behavior.proactiveAI) return;
    if (now() - this.lastThought < 60 / this.config.behavior.thoughtsPerMinute)
      return;
    const generation = this.requestGeneration,
      session = this.session.generation;
    this.thinking = true;
    this.lastThought = now();
    try {
      const result = await this.adapter.think({
        reason: "proactive_scene_suggestion",
        personality: this.config.profile,
        lifeState: this.life.getState(),
        allowedSceneIds: this.catalog
          .filter((s) => !s.body || this.config.behavior.idleBody)
          .map((s) => s.id),
        instruction: "Suggest one allowed sceneId. Never send motor commands.",
      });
      if (
        generation !== this.requestGeneration ||
        !this.session.valid(session) ||
        this.wake.phase !== "conversation"
      )
        return;
      const id =
        result.sceneId ??
        result.response?.sceneId ??
        result.actions?.find((a) => a.sceneId)?.sceneId;
      const scene = this.catalog.find((s) => s.id === id);
      if (
        scene &&
        this.scenes.eligible(scene, now(), this.config.idle, {
          body: this.bodyArmed && this.config.behavior.idleBody,
          speaking: this.lastLiveStatus?.audioPlaying,
        })
      ) {
        this.scenes.admit(scene, now());
        if (!this.motion.owner && !this.follow.enabled)
          await this.executeScene(scene);
      } else await this.runRule(true);
      if (
        this.config.behavior.proactiveExpression &&
        now() - this.lastExpression >=
          this.config.behavior.expressionInterval &&
        generation === this.requestGeneration
      ) {
        this.lastExpression = now();
        if (this.live.getStatus().connected) {
          this.autonomousExpression = true;
          await this.live.sendUserText(
            "Offer one brief proactive companion remark. Do not perform any body action.",
            { source: "proactive" },
          );
        } else {
          const text = result.text ?? result.response?.text;
          if (text)
            this.proactiveText.textContent = String(text).slice(0, 1200);
        }
      }
      this.diagnostics.add("thought", "Whitelist suggestion evaluated", true);
    } catch (e) {
      this.diagnostics.add(
        "thought",
        "Provider failed; local rule fallback",
        true,
      );
      if (generation === this.requestGeneration && this.session.valid(session))
        await this.runRule(true);
    } finally {
      this.thinking = false;
    }
  }
  tick() {
    if (this.active && !document.hidden && this.session.phase === "active") {
      const status = this.live.getStatus();
      this.life.state.sleeping =
        now() - this.scenes.lastInteraction >= this.config.behavior.sleepAfter;
      if (
        this.life.state.sleeping &&
        !status.audioPlaying &&
        !status.inputActive
      ) {
        this.life.state.mood = "sleepy";
        this.life.state.attentionTarget = "none";
      }
      const busy =
        status.audioPlaying ||
        status.inputActive ||
        status.thinking ||
        status.generationActive ||
        status.toolCallActive ||
        status.connecting;
      if (
        this.config.wake.enabled &&
        this.wake.timedOut(now(), this.config.wake.silenceTimeout, busy)
      )
        this.returnWaiting().catch((e) => this.error(e));
      if (this.config.behavior.enabled)
        this.runRule().catch((e) => this.error(e));
      if (this.config.behavior.proactiveAI)
        this.think().catch((e) => this.error(e));
      if (this.motion.owner === "explicit" && !this.queue.isBusy())
        this.motion.release(this.explicitLease);
      if (!this.robot.isConnected() && this.follow.enabled)
        this.cancelFollow("disconnected");
    }
    if (
      this.detectBusy &&
      performance.now() - (this.lastDetectAt ?? 0) > 10000
    ) {
      this.stopDetection();
      this.error(
        Error(
          t(
            "检测超时，已停止本地推理。",
            "Detection timed out and was stopped.",
          ),
        ),
      );
    }
    if (
      (this.detections?.length ?? 0) &&
      now() - (this.detections[0]?.time ?? 0) > 0.3
    )
      this.drawDetections();
    this.renderState();
  }
  publicState() {
    const live = this.live.getStatus();
    return {
      version: "1.3.0",
      session: this.session.phase,
      wake: this.wake.phase,
      bufferBytes: this.wake.buffer.length,
      bufferOverflow: this.wake.overflow,
      scene: this.selectedScene,
      bodyArmed: this.bodyArmed,
      motionSource: this.motion.owner ?? "none",
      follow: this.follow.enabled,
      sleeping: !!this.life.state.sleeping,
      detectorMs: this.detectMs ?? null,
      microphone: !!this.capture.stream,
      audioRoute: "browser managed",
      microphoneFrames: this.live.audioDebug?.sentInputFrames ?? 0,
      playbackQueueSeconds: Math.max(
        0,
        (this.live.nextOutputTime ?? 0) -
          (this.live.outputAudioContext?.currentTime ?? 0),
      ),
      playbackSources: this.live.activeOutputSources?.size ?? 0,
      liveConnected: !!live.connected,
      playing: !!live.audioPlaying,
      processing: !!live.thinking,
      camera: this.camera.getCameraStatus().running,
      events: this.diagnostics.events.length,
      decisions: this.diagnostics.decisions.length,
    };
  }
  renderState() {
    if (!this.lifeView) return;
    for (const control of this.shell.controls.querySelectorAll(
      "[data-control]",
    )) {
      const key = control.dataset.control;
      if (key === "wake")
        control.hidden =
          !this.config.wake.enabled || this.wake.phase === "conversation";
      if (key === "wait")
        control.hidden =
          !this.config.wake.enabled || this.wake.phase !== "conversation";
      if (key === "resume") control.hidden = this.session.phase !== "suspended";
      if (key === "arm")
        control.setAttribute("aria-pressed", String(this.bodyArmed));
    }
    const widget = document.getElementById("looiVisionWidget");
    if (widget) {
      const cameraOn = this.active && this.camera.getCameraStatus().running;
      document.body.dataset.preview = cameraOn ? "on" : "off";
      const pip = document.getElementById("localVisionPreview");
      if (cameraOn && pip && pip.srcObject !== this.camera.stream) {
        pip.srcObject = this.camera.stream;
        pip.play().catch(() => {});
      }
    }
    const state = this.life.getState();
    this.lifeView.replaceChildren(
      ...Object.entries({
        energy: ["精力", "Energy"],
        boredom: ["无聊", "Boredom"],
        curiosity: ["好奇", "Curiosity"],
        affection: ["亲近", "Affection"],
        loneliness: ["孤独", "Loneliness"],
        comfort: ["舒适度", "Comfort"],
        mood: ["情绪", "Mood"],
        attentionTarget: ["注意力", "Attention"],
      }).map(([key, labels]) => {
        const e = element("div", { class: "companion-metric" });
        e.append(
          element("span", {}, t(...labels)),
          element(
            "strong",
            {},
            typeof state[key] === "number"
              ? Math.round(state[key] * 100) + "%"
              : String(state[key] ?? "unknown"),
          ),
        );
        return e;
      }),
    );
    this.diagnosticView.textContent = JSON.stringify(
      {
        state: this.publicState(),
        recentDecisions: this.diagnostics.decisions.slice(-8),
        recentEvents: this.diagnostics.events.slice(-8),
      },
      null,
      2,
    );
    if (this.detectInfo && this.visionWorker)
      this.detectInfo.textContent =
        t("本地推理 ", "Local inference ") +
        Math.round(this.detectMs ?? 0) +
        " ms";
  }
  showRemote() {
    this.cancelLegacy?.("manual_takeover")?.catch((e) => this.error(e));
    if (this.remote?.open) return;
    this.cancelFollow("manual_takeover");
    this.cancelScene("manual_takeover");
    this.requestGeneration++;
    const dialog = element("dialog", {
      id: "companionRemote",
      "aria-label": t("遥控", "Remote"),
    });
    this.remote = dialog;
    const header = element("header");
    header.append(
      element("h2", {}, t("遥控", "Remote")),
      button("关闭", "Close", () => this.closeRemote()),
    );
    const info = element(
      "p",
      {},
      t(
        "按住方向键或拖动摇杆。松手会请求停止；停止未获 ACK 时会提示。",
        "Hold a direction or drag the joystick. Releasing requests a stop; missing acknowledgement is reported.",
      ),
    );
    const pad = element("div", { class: "remote-pad" });
    for (const [label, l, a, pos] of [
      ["↑", 0.12, 0, 2],
      ["←", 0, -0.12, 4],
      ["■", 0, 0, 5],
      ["→", 0, 0.12, 6],
      ["↓", -0.1, 0, 8],
    ]) {
      const b = button(label, label, () => {});
      b.style.gridArea =
        pos <= 3
          ? `1 / ${pos}`
          : pos <= 6
            ? `2 / ${pos - 3}`
            : `3 / ${pos - 6}`;
      b.setAttribute(
        "aria-label",
        t(
          { 2: "前进", 4: "左转", 5: "停止", 6: "右转", 8: "后退" }[pos],
          { 2: "Forward", 4: "Left", 5: "Stop", 6: "Right", 8: "Backward" }[
            pos
          ],
        ),
      );
      this.bindRemotePointer(b, () => ({ linear: l, angular: a }));
      pad.append(b);
    }
    const joystick = element("div", {
      class: "remote-joystick",
      tabindex: "0",
      role: "group",
      "aria-label": t(
        "摇杆；键盘请使用方向按钮",
        "Joystick; keyboard users can use direction buttons",
      ),
    });
    this.bindRemotePointer(joystick, (e) => {
      const r = joystick.getBoundingClientRect(),
        x = Math.max(
          -1,
          Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2)),
        ),
        y = Math.max(
          -1,
          Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2)),
        );
      joystick.style.setProperty("--jx", x * 40 + "px");
      joystick.style.setProperty("--jy", y * 40 + "px");
      return { linear: -y * 0.12, angular: x * 0.12 };
    });
    dialog.append(header, info, pad, joystick);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.closeRemote();
    });
    dialog.addEventListener("close", () => this.cancelRemote("remote_closed"));
    document.body.append(dialog);
    dialog.showModal();
    header.querySelector("button").focus();
  }
  bindRemotePointer(target, intent) {
    const start = (e) => {
      if ((e.type === "keydown" && ![" ", "Enter"].includes(e.key)) || e.repeat)
        return;
      e.preventDefault();
      if (e.pointerId !== undefined) target.setPointerCapture(e.pointerId);
      this.remoteIntent = intent(e);
      this.remoteHeld = true;
      this.startRemote();
    };
    target.addEventListener("pointerdown", start);
    target.addEventListener("keydown", start);
    target.addEventListener("pointermove", (e) => {
      if (this.remoteHeld && target.hasPointerCapture(e.pointerId)) {
        if (!target.classList.contains("remote-joystick")) {
          const r = target.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          ) {
            this.cancelRemote("pointer_left");
            return;
          }
        }
        this.remoteIntent = intent(e);
      }
    });
    for (const type of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "blur",
      "keyup",
    ])
      target.addEventListener(type, () => this.cancelRemote(type));
  }
  async startRemote() {
    if (this.remoteLease && this.motion.valid(this.remoteLease)) return;
    if (this.remoteStarting) return;
    this.remoteStarting = true;
    try {
      if (!this.bodyArmed)
        throw Error(t("请先授权身体运动。", "Enable body motion first."));
      const lease = await this.motion.acquire("manual");
      if (!this.remoteHeld) {
        await this.motion.stop();
        return;
      }
      this.remoteLease = lease;
      const pulse = async () => {
        if (this.remoteSending || !this.remoteHeld || !this.motion.valid(lease))
          return;
        this.remoteSending = true;
        try {
          await this.motion.motion(
            { ...this.remoteIntent, duration_ms: 200 },
            lease,
          );
        } catch (e) {
          this.cancelRemote("remote_error");
          this.error(e);
        } finally {
          this.remoteSending = false;
        }
      };
      pulse();
      clearInterval(this.remoteTimer);
      this.remoteTimer = setInterval(pulse, 150);
    } catch (e) {
      this.error(e);
    } finally {
      this.remoteStarting = false;
    }
  }
  clearRemote() {
    this.remoteHeld = false;
    clearInterval(this.remoteTimer);
    this.remoteTimer = null;
    this.remoteLease = null;
    const j = this.remote?.querySelector(".remote-joystick");
    j?.style.setProperty("--jx", "0px");
    j?.style.setProperty("--jy", "0px");
  }
  async cancelRemote(reason) {
    const had = this.remoteHeld || this.remoteLease;
    this.clearRemote();
    if (had) {
      try {
        await this.motion.stop();
        this.diagnostics.add("manual_stop", reason);
      } catch (e) {
        this.error(
          Error(t("停止未获确认：", "Stop unconfirmed: ") + e.message),
        );
      }
    }
  }
  async closeRemote() {
    await this.cancelRemote("remote_closed");
    this.remote?.close();
    this.remote?.remove();
    this.remote = null;
  }
}
