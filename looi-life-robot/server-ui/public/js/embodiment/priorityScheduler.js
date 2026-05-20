const DEFAULT_DEDUPE_MS = 650;

export const PRIORITY_LEVELS = Object.freeze({
  emergency_stop: 100,
  local_stop_phrase: 90,
  user_speech_attention: 80,
  direct_user_command: 70,
  local_brain_action: 60,
  camera_user_tracking: 50,
  decorative_face_only: 10
});

export class PriorityScheduler {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.currentTask = null;
    this.queue = [];
    this.history = [];
    this.maxHistory = 50;
    this.lastSubmitted = new Map();
  }

  submit(task = {}) {
    const normalized = this.normalizeTask(task);

    if (this.isDuplicate(normalized)) {
      return Promise.resolve({
        ok: true,
        skipped: true,
        reason: "duplicate_task",
        taskId: normalized.id
      });
    }

    if (normalized.priority >= PRIORITY_LEVELS.emergency_stop) {
      this.interruptBelow(normalized.priority, "emergency_task");
      this.clear();
    }

    if (this.currentTask) {
      const currentPriority = Number(this.currentTask.priority || 0);
      if (normalized.priority > currentPriority && this.currentTask.interruptible !== false) {
        this.interruptCurrent(`interrupted_by_${normalized.type}`);
      } else {
        this.queue.push(normalized);
        this.sortQueue();
        return normalized.promise;
      }
    }

    this.queue.push(normalized);
    this.sortQueue();
    this.runNext();
    return normalized.promise;
  }

  cancel(taskId) {
    const index = this.queue.findIndex((task) => task.id === taskId);
    if (index < 0) {
      return false;
    }

    const [task] = this.queue.splice(index, 1);
    task.resolve({
      ok: false,
      interrupted: true,
      taskId: task.id,
      reason: "cancelled"
    });
    return true;
  }

  interruptBelow(priority, reason = "interrupt") {
    this.queue = this.queue.filter((task) => {
      if (Number(task.priority || 0) < priority) {
        task.resolve({
          ok: false,
          interrupted: true,
          taskId: task.id,
          reason
        });
        return false;
      }
      return true;
    });

    if (this.currentTask && Number(this.currentTask.priority || 0) < priority) {
      this.interruptCurrent(reason);
    }
  }

  getCurrentTask() {
    return this.currentTask ? compactTask(this.currentTask) : null;
  }

  getQueue() {
    return this.queue.map(compactTask);
  }

  clear() {
    const count = this.queue.length;
    this.queue.forEach((task) => task.resolve({
      ok: false,
      interrupted: true,
      taskId: task.id,
      reason: "queue_cleared"
    }));
    this.queue = [];
    return count;
  }

  getHistory({ limit = 20 } = {}) {
    return this.history.slice(0, Math.max(1, Number(limit) || 20)).map((entry) => ({ ...entry }));
  }

  normalizeTask(task) {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return {
      id: task.id ?? `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      type: task.type ?? "task",
      priority: Number(task.priority ?? 0),
      source: task.source ?? "browser",
      interruptible: task.interruptible !== false,
      run: typeof task.run === "function" ? task.run : async () => ({ ok: true, skipped: true }),
      interrupt: typeof task.interrupt === "function" ? task.interrupt : null,
      createdAt: task.createdAt ?? new Date().toISOString(),
      reason: task.reason ?? "",
      physical: task.physical === true,
      resolve,
      promise
    };
  }

  isDuplicate(task) {
    const key = `${task.type}:${task.source}:${task.reason}`;
    const now = Date.now();
    const lastAt = Number(this.lastSubmitted.get(key) || 0);
    this.lastSubmitted.set(key, now);
    return now - lastAt < DEFAULT_DEDUPE_MS;
  }

  sortQueue() {
    this.queue.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  }

  runNext() {
    if (this.currentTask || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    this.currentTask = task;
    const startedAt = Date.now();
    Promise.resolve()
      .then(() => task.run())
      .then((result) => {
        task.resolve({
          ok: result?.ok !== false,
          taskId: task.id,
          type: task.type,
          result
        });
        this.record(task, result, startedAt);
      })
      .catch((error) => {
        const result = {
          ok: false,
          error: error.message,
          reason: error.message
        };
        task.resolve({
          ok: false,
          taskId: task.id,
          type: task.type,
          result
        });
        this.record(task, result, startedAt);
      })
      .finally(() => {
        if (this.currentTask === task) {
          this.currentTask = null;
        }
        this.runNext();
      });
  }

  interruptCurrent(reason) {
    if (!this.currentTask) {
      return;
    }

    const task = this.currentTask;
    task.interrupt?.(reason);
    task.resolve({
      ok: false,
      interrupted: true,
      taskId: task.id,
      reason
    });
    this.record(task, { ok: false, interrupted: true, reason }, Date.now());
    this.currentTask = null;
  }

  record(task, result, startedAt) {
    this.history.unshift({
      ...compactTask(task),
      resultOk: result?.ok !== false,
      resultReason: result?.reason ?? result?.sequence ?? result?.error ?? "completed",
      latencyMs: Math.max(0, Date.now() - startedAt),
      completedAt: new Date().toISOString()
    });
    this.history.length = Math.min(this.history.length, this.maxHistory);
  }
}

function compactTask(task) {
  return {
    id: task.id,
    type: task.type,
    priority: task.priority,
    source: task.source,
    interruptible: task.interruptible,
    createdAt: task.createdAt,
    reason: task.reason,
    physical: task.physical
  };
}
