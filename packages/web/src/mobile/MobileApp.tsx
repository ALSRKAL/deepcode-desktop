/* eslint-disable max-lines -- 移动端首页与会话共享连接态，避免拆分状态投影所有权。 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderOpen,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  Square,
  X,
} from "lucide-react";
import {
  MobileRemoteControlClient,
  readPairingParamsFromLocation,
} from "./protocol.js";
import {
  presentMobileConnection,
  type MobileConnectionSnapshot,
} from "./connectionPresentation.js";
import {
  conversationReducer,
  initialConversationState,
  type ConversationAction,
  type ConversationScope,
} from "./conversationReducer.js";
// 手机首页目录 hook 走 @zcode/ui 公开子入口；不再跨包深引 ui/src 文件路径。
import { useMobileProjectDirectory } from "@zcode/ui/mobile-project-directory";
import { TaskConversationLifecycle } from "./taskConversationLifecycle.js";
import { findKnownDeviceDisplay, rememberKnownDeviceDisplay } from "./knownDeviceDisplayCache.js";
import { logger } from "../../../ui/src/logger.js";
import type {
  WebRemoteControlBootstrapResult,
  WebRemoteControlAppPayload,
  WebRemoteControlWorkspaceRef,
  ZCodeConfigOption,
} from "@zcode/shared";
import type { MobileProjectRoot } from "@zcode/client";
import { mobileLocale, t } from "./mobileI18n.js";
import {
  collectTaskSources,
  loadAllTasks,
  pickBridgeWorkspace,
  relativeTime,
  tasksFromBootstrap,
  type MobileTask,
} from "./mobileTasks.js";
import { MessageView } from "./MessageView.js";

/**
 * 移动端远控应用（DeepCode Studio，2026-11-18 重做）。
 *
 * 修复原因：原页面只显示桌面弹层推送的当前项目任务、纯文本气泡，没有思考/工具进度、
 * 复制、换模型、停止，用户在手机上「看不到对话、打不开东西」。现在：
 * - 首页列出窗口内所有本地项目的对话（直接读 Host `listTasks`），可搜索、按项目筛选；
 * - 会话页渲染正文/思考/工具步骤，实时流 + 快照对账，可复制、停止、换模型、切换对话、新建任务。
 *
 * 状态所有者不变：会话事实在 Host；本页只持有视图态、草稿和 optimistic 用户消息。
 * 发送仍走 IZCodeTaskService.sendPrompt（clientMode = web-remote-replayable）。
 */

type View = { kind: "home" } | { kind: "task"; task: MobileTask };
type Sheet = null | "switch" | "model" | "newTask";

const TASK_REFRESH_MS = 5_000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findModelOption(options: ZCodeConfigOption[] | null): ZCodeConfigOption | undefined {
  return options?.find(
    (option) => option.type === "select" && (option.category === "model" || option.id === "model"),
  );
}

function modelLabel(option: ZCodeConfigOption | undefined): string | null {
  if (!option) return null;
  const current = option.options?.find((item) => item.value === option.currentValue);
  return current?.name ?? (typeof option.currentValue === "string" ? option.currentValue : null);
}

export function MobileApp() {
  const [params, setParams] = useState<ReturnType<typeof readPairingParamsFromLocation> | null>(
    null,
  );
  const [paramsError, setParamsError] = useState<string | null>(null);
  // 仅用于首页展示的桌面名；权威值来自本次 pairing URL，URL 缺省时才读有界显示缓存。
  const [knownDeviceName, setKnownDeviceName] = useState<string | null>(null);
  const [client, setClient] = useState<MobileRemoteControlClient | null>(null);
  const clientRef = useRef<MobileRemoteControlClient | null>(null);
  const [connectionSnapshot, setConnectionSnapshot] = useState<MobileConnectionSnapshot>({
    state: "connecting",
  });
  const connection = connectionSnapshot.state;
  const [bootstrap, setBootstrap] = useState<WebRemoteControlBootstrapResult | null>(null);
  const [tasks, setTasks] = useState<MobileTask[] | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [view, setView] = useState<View>({ kind: "home" });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [conversation, dispatchConversation] = useReducer(
    conversationReducer,
    initialConversationState,
  );
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [configOptions, setConfigOptions] = useState<ZCodeConfigOption[] | null>(null);
  const [stopping, setStopping] = useState(false);
  const [modelPending, setModelPending] = useState(false);
  const bridgeWorkspace = useMemo(() => pickBridgeWorkspace(bootstrap), [bootstrap]);
  const directory = useMobileProjectDirectory(
    client,
    bridgeWorkspace?.workspaceKey,
    connection === "paired",
    bootstrap ?? undefined,
  );
  // 传输降级回调由「订阅 effect」注册：`onPayload` 在 client 构造时绑定，
  // 之后通过 ref 把 bridge-degraded 路由到当前 task 的完整桥恢复。
  const onTransportDegradedRef = useRef<() => void>(() => {});

  const showNotice = useCallback((text: string, tone: "error" | "info" = "error") => {
    setNotice({ text, tone });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 6000 : 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reportError = useCallback(
    (message: string, error: unknown) => {
      logger.error(message, error);
      showNotice(describeError(error));
    },
    [showNotice],
  );

  useEffect(() => {
    try {
      const parsed = readPairingParamsFromLocation();
      const pairingName = parsed.deviceName?.trim() || null;
      setParams(parsed);
      setKnownDeviceName(pairingName ?? findKnownDeviceDisplay(parsed.deviceMid)?.name ?? null);
      if (parsed.deviceMid && pairingName) {
        rememberKnownDeviceDisplay({
          deviceMid: parsed.deviceMid,
          name: pairingName,
          appVersion: parsed.appVersion,
        });
      }
    } catch (error) {
      setParamsError(describeError(error));
    }
  }, []);

  const refreshBootstrap = useCallback(async () => {
    const current = clientRef.current;
    if (!current) return;
    const response = await current.request({
      zcode_type: "bootstrap-request",
      requestId: `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    if (response.zcode_type === "bootstrap-response") setBootstrap(response.result);
  }, []);

  useEffect(() => {
    if (!params) return;
    const next = new MobileRemoteControlClient(params, {
      onStateChange: (state, detail) => setConnectionSnapshot({ state, detail }),
      onPayload: (payload) => {
        if (payload.zcode_type === "workspace-list-updated") {
          setBootstrap((current) =>
            current
              ? {
                  ...current,
                  workspaces: payload.result.workspaces,
                  tasks: payload.result.tasks,
                }
              : current,
          );
        }
        if (payload.zcode_type === "bridge-degraded") onTransportDegradedRef.current();
        if (payload.zcode_type === "app-error") showNotice(payload.error ?? payload.reason);
      },
    });
    clientRef.current = next;
    setClient(next);
    next.connect();
    return () => {
      next.dispose();
      clientRef.current = null;
      setClient(null);
    };
  }, [params, showNotice]);

  // 网络恢复 / 页面回到前台时立刻补一次重连；其余情况交给客户端内部的退避重连。
  useEffect(() => {
    const onOnline = () => clientRef.current?.retryNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") clientRef.current?.retryNow();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (connection !== "paired" || bootstrap) return;
    void refreshBootstrap().catch((error) => reportError("[mobile] bootstrap 拉取失败", error));
  }, [connection, bootstrap, refreshBootstrap, reportError]);

  /* ---------- 全部对话：读 Host listTasks，周期刷新（仅页面可见时） ---------- */

  const tasksInFlight = useRef(false);
  const refreshTasks = useCallback(async () => {
    const current = clientRef.current;
    if (!current || !bootstrap || tasksInFlight.current) return;
    tasksInFlight.current = true;
    setTasksLoading(true);
    try {
      const sources = collectTaskSources(bootstrap, directory.roots);
      const next = await loadAllTasks(current, sources);
      setTasks(next);
    } catch (error) {
      logger.warn("[mobile] 读取任务清单失败，回落到桌面推送清单", error);
      setTasks((existing) => existing ?? tasksFromBootstrap(bootstrap));
    } finally {
      tasksInFlight.current = false;
      setTasksLoading(false);
    }
  }, [bootstrap, directory.roots]);

  useEffect(() => {
    if (connection !== "paired" || !bootstrap) return;
    void refreshTasks();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshTasks();
    }, TASK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [connection, bootstrap, refreshTasks]);

  /* ---------- 会话订阅 ---------- */

  const openTask = view.kind === "task" ? view.task : null;
  const taskId = openTask?.taskId;
  const bridgeKey = openTask?.bridgeKey;
  const taskPath = openTask?.workspacePath;
  const taskIdentity = openTask?.workspaceIdentity;
  const taskRemoteSession = openTask?.remoteSessionId;

  // 进入任务即订阅 Host replayable 事件流；退出/切换任务释放旧订阅。
  // 断线重连（connection 重新变 paired）会重跑本 effect：重开 bridge + 重订阅 + 重读快照。
  useEffect(() => {
    if (!taskId || !bridgeKey || taskPath === undefined || connection !== "paired") return;
    const current = clientRef.current;
    if (!current) return;
    const scope: ConversationScope = { workspaceKey: bridgeKey, taskId };
    const dispatch = (action: ConversationAction) => {
      // 模型等 configOptions 的实时变化随事件流到达，直接更新选择器。
      if (action.type === "streamEvent" && action.event.type === "config_option_update") {
        setConfigOptions(action.event.configOptions);
      }
      dispatchConversation(action);
    };
    const lifecycle = new TaskConversationLifecycle(scope, {
      subscribe: (onEvent) =>
        current.subscribeTaskStream(
          {
            workspaceKey: bridgeKey,
            workspacePath: taskPath,
            workspaceIdentity: taskIdentity,
            taskId,
          },
          onEvent,
        ),
      read: () =>
        current.readTaskSnapshot({
          workspaceKey: bridgeKey,
          taskId,
          workspacePath: taskPath,
          workspaceIdentity: taskIdentity,
          remoteSessionId: taskRemoteSession,
          limit: 200,
        }),
      dispatch,
      onError: (error) => reportError("[mobile] 会话同步失败", error),
    });
    // 协议先作废 bridge，控制器再重订阅/补读；不依赖 flags 变化触发 React effect。
    onTransportDegradedRef.current = () => lifecycle.recoverBridge();
    lifecycle.start();
    return () => {
      lifecycle.dispose();
      onTransportDegradedRef.current = () => {};
    };
  }, [taskId, bridgeKey, taskPath, taskIdentity, taskRemoteSession, connection, reportError]);

  // 模型选项：进入任务读一次 Host 权威 configOptions。
  useEffect(() => {
    setConfigOptions(null);
    if (!taskId || !bridgeKey || connection !== "paired") return;
    let cancelled = false;
    void clientRef.current
      ?.readTaskConfigOptions({ workspaceKey: bridgeKey, taskId })
      .then((options) => {
        if (!cancelled) setConfigOptions(options);
      })
      .catch((error) => logger.warn("[mobile] 读取模型选项失败", error));
    return () => {
      cancelled = true;
    };
  }, [taskId, bridgeKey, connection]);

  const listedTask = useMemo(
    () => (taskId ? tasks?.find((task) => task.taskId === taskId) : undefined),
    [tasks, taskId],
  );
  const running =
    view.kind === "task"
      ? (conversation.running ?? listedTask?.status === "running")
      : false;

  // 一轮结束后刷新列表，让状态/标题与桌面一致。
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      setStopping(false);
      void refreshTasks();
    }
    wasRunning.current = running;
  }, [running, refreshTasks]);

  /* ---------- 自动滚动：在底部附近时跟随新内容 ---------- */

  const nearBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      nearBottom.current = distance < 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    nearBottom.current = true;
  }, [taskId]);
  useEffect(() => {
    if (view.kind !== "task" || !nearBottom.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [conversation.messages, running, view.kind]);

  /* ---------- 操作 ---------- */

  const sendPrompt = useCallback(async () => {
    const current = clientRef.current;
    const content = draft.trim();
    if (!current || !openTask || !content) return;
    setDraft("");
    nearBottom.current = true;
    dispatchConversation({
      type: "appendOptimisticUserMessage",
      scope: { workspaceKey: openTask.bridgeKey, taskId: openTask.taskId },
      id: `local-${Date.now()}`,
      text: content,
    });
    try {
      await current.sendTaskPrompt({
        workspaceKey: openTask.bridgeKey,
        taskId: openTask.taskId,
        content,
        remoteSessionId: openTask.remoteSessionId,
      });
    } catch (error) {
      setDraft((value) => value || content);
      reportError("[mobile] 发送消息失败", error);
    }
  }, [draft, openTask, reportError]);

  const stopTask = useCallback(async () => {
    const current = clientRef.current;
    if (!current || !openTask || stopping) return;
    setStopping(true);
    try {
      await current.stopTask({
        workspaceKey: openTask.bridgeKey,
        taskId: openTask.taskId,
        workspacePath: openTask.workspacePath,
        workspaceIdentity: openTask.workspaceIdentity,
      });
    } catch (error) {
      setStopping(false);
      reportError("[mobile] 停止任务失败", error);
    }
  }, [openTask, stopping, reportError]);

  const modelOption = findModelOption(configOptions);
  const chooseModel = useCallback(
    async (value: string, name: string) => {
      const current = clientRef.current;
      if (!current || !openTask || !modelOption) return;
      setSheet(null);
      setModelPending(true);
      try {
        const next = await current.setTaskConfigOption({
          workspaceKey: openTask.bridgeKey,
          taskId: openTask.taskId,
          configId: modelOption.id,
          value,
        });
        setConfigOptions(next);
        showNotice(t("modelChanged", { name }), "info");
      } catch (error) {
        reportError("[mobile] 切换模型失败", error);
      } finally {
        setModelPending(false);
      }
    },
    [openTask, modelOption, showNotice, reportError],
  );

  const projectRoots = useMemo(
    () => (directory.roots ?? []).filter((root) => root.enabled),
    [directory.roots],
  );

  const createTaskIn = useCallback(
    async (root: MobileProjectRoot) => {
      setSheet(null);
      const created = await directory.create(root);
      if (!created) return;
      const source = collectTaskSources(bootstrap, directory.roots).find(
        (item) =>
          item.workspacePath === root.rootIdentity.rootPath &&
          item.workspaceIdentity === root.workspaceIdentity,
      );
      const bridge = source?.bridgeKey ?? bridgeWorkspace?.workspaceKey;
      if (!bridge) return;
      const now = Date.now();
      setView({
        kind: "task",
        task: {
          taskId: created.taskId,
          title: created.title || t("newTask"),
          status: "idle",
          createdAt: now,
          updatedAt: now,
          unread: false,
          bridgeKey: bridge,
          workspacePath: root.rootIdentity.rootPath,
          ...(root.workspaceIdentity ? { workspaceIdentity: root.workspaceIdentity } : {}),
          ...(root.remoteSessionId ? { remoteSessionId: root.remoteSessionId } : {}),
          projectName: root.projectName,
        },
      });
      void refreshTasks();
    },
    [directory, bootstrap, bridgeWorkspace, refreshTasks],
  );

  useEffect(() => {
    if (directory.error) showNotice(directory.error);
  }, [directory.error, showNotice]);

  const openTaskView = useCallback((task: MobileTask) => {
    setSheet(null);
    setDraft("");
    setStopping(false);
    setView({ kind: "task", task });
    window.scrollTo({ top: 0 });
  }, []);

  /* ---------- 列表筛选 ---------- */

  const allTasks = tasks ?? [];
  const projectNames = useMemo(
    () => [...new Set(allTasks.map((task) => task.projectName))].sort(),
    [allTasks],
  );
  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allTasks.filter(
      (task) =>
        (!projectFilter || task.projectName === projectFilter) &&
        (!needle ||
          task.title.toLowerCase().includes(needle) ||
          task.projectName.toLowerCase().includes(needle)),
    );
  }, [allTasks, query, projectFilter]);

  /* ---------- 渲染 ---------- */

  const connectionPresentation = presentMobileConnection(connection, connectionSnapshot.detail);
  const banner =
    connection !== "paired" ? (
      <div
        role="status"
        className={`px-4 py-2 text-center text-ui-sm ${connectionPresentation.terminal ? "bg-destructive/10 text-destructive" : "bg-surface text-foreground-subtle"}`}
      >
        <p className="font-medium">{connectionPresentation.label}</p>
        <p>{connectionPresentation.description}</p>
      </div>
    ) : null;
  const noticeBar = notice ? (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={`fixed inset-x-3 top-16 z-40 rounded-xl px-3 py-2 text-ui-sm shadow-lg ${notice.tone === "error" ? "bg-destructive text-destructive-foreground" : "bg-foreground text-background"}`}
      onClick={() => setNotice(null)}
    >
      {notice.text}
    </div>
  ) : null;

  if (paramsError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <p className="text-ui-base text-foreground-subtle">{t("invalidLink")}</p>
      </div>
    );
  }

  const taskList = (list: MobileTask[], compact: boolean) =>
    list.length === 0 ? (
      <p className="px-4 py-10 text-center text-ui-base text-foreground-subtle">
        {allTasks.length === 0 ? t("noChats") : t("noMatches")}
      </p>
    ) : (
      <ul className="divide-y divide-border">
        {list.map((task) => {
          const active = openTask?.taskId === task.taskId;
          return (
            <li key={task.taskId}>
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-4 text-start active:bg-surface-hover ${compact ? "min-h-14 py-2" : "min-h-16 py-3"} ${active ? "bg-surface" : ""}`}
                onClick={() => openTaskView(task)}
              >
                <TaskStatusMark status={task.status} unread={task.unread} />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-ui-base font-medium text-foreground">
                    {task.title || t("taskTitle")}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
                    <span dir="auto" className="truncate">
                      {task.projectName}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">
                      {task.status === "running"
                        ? t("statusRunning")
                        : relativeTime(task.updatedAt, Date.now(), mobileLocale())}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  const searchBox = (
    <label className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3">
      <Search className="size-4 shrink-0 text-foreground-subtle" />
      <span className="sr-only">{t("searchTasks")}</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("searchTasks")}
        dir="auto"
        className="min-w-0 flex-1 bg-transparent text-mobile-input-safe text-foreground outline-none placeholder:text-foreground-subtle"
      />
      {query ? (
        <button type="button" aria-label={t("close")} onClick={() => setQuery("")}>
          <X className="size-4 text-foreground-subtle" />
        </button>
      ) : null}
    </label>
  );

  const sheets = (
    <>
      {sheet === "switch" ? (
        <BottomSheet title={t("switchChat")} onClose={() => setSheet(null)}>
          <div className="px-4 pb-2">{searchBox}</div>
          {taskList(filteredTasks, true)}
        </BottomSheet>
      ) : null}
      {sheet === "newTask" ? (
        <BottomSheet title={t("pickProject")} onClose={() => setSheet(null)}>
          {projectRoots.length === 0 ? (
            <p className="px-4 py-8 text-center text-ui-base text-foreground-subtle">
              {t("openOnDesktop")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projectRoots.map((root) => (
                <li key={JSON.stringify(root.rootIdentity)}>
                  <button
                    type="button"
                    disabled={directory.pending}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start active:bg-surface-hover disabled:opacity-50"
                    onClick={() => void createTaskIn(root)}
                  >
                    <FolderOpen className="size-5 shrink-0 text-foreground-subtle" />
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate text-ui-base text-foreground">
                        {root.projectName}
                      </span>
                      <span dir="ltr" className="block truncate font-mono text-ui-xs text-foreground-subtle">
                        {root.rootIdentity.rootPath}
                      </span>
                    </span>
                    <Plus className="size-4 shrink-0 text-primary" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </BottomSheet>
      ) : null}
      {sheet === "model" && modelOption ? (
        <BottomSheet title={t("chooseModel")} onClose={() => setSheet(null)}>
          <ModelList option={modelOption} onPick={(value, name) => void chooseModel(value, name)} />
        </BottomSheet>
      ) : null}
    </>
  );

  if (view.kind === "task" && openTask) {
    const title = listedTask?.title || openTask.title || t("taskTitle");
    const messages = conversation.messages;
    const lastMessage = messages[messages.length - 1];
    const loading = conversation.awaitingSnapshot && messages.length === 0;
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex h-14 items-center gap-1 px-1">
            <button
              type="button"
              aria-label={t("back")}
              className="grid size-11 place-items-center rounded-full active:bg-surface-hover"
              onClick={() => {
                setView({ kind: "home" });
                setSheet(null);
              }}
            >
              <ChevronLeft className="size-5 rtl:rotate-180" />
            </button>
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-ui-base font-semibold">
                {title}
              </p>
              <p className="flex items-center gap-1.5 truncate text-ui-sm text-foreground-subtle">
                {running ? <Loader2 className="size-3 animate-spin text-primary" /> : null}
                <span dir="auto" className="truncate">
                  {running ? t("working") : openTask.projectName}
                </span>
              </p>
            </div>
            <button
              type="button"
              aria-label={t("switchChat")}
              className="grid size-11 place-items-center rounded-full active:bg-surface-hover"
              onClick={() => setSheet("switch")}
            >
              <MessagesSquare className="size-5" />
            </button>
          </div>
          {banner}
        </header>
        {noticeBar}

        <main className="flex flex-col gap-5 px-4 pb-44 pt-4">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-ui-base text-foreground-subtle">
              <Loader2 className="size-4 animate-spin" />
              {t("loadingChat")}
            </p>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-ui-base text-foreground-subtle">
              {t("noMessages")}
            </p>
          ) : (
            messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                live={running && message === lastMessage && message.role === "assistant"}
              />
            ))
          )}
          {running && lastMessage?.role !== "assistant" ? (
            <p className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
              <Loader2 className="size-4 animate-spin text-primary" />
              {t("working")}
            </p>
          ) : null}
          {conversation.lastError ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
              {t("taskFailed", { error: conversation.lastError })}
            </p>
          ) : null}
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            {modelOption ? (
              <button
                type="button"
                disabled={modelPending || connection !== "paired"}
                className="inline-flex h-8 max-w-[70%] items-center gap-1.5 rounded-full border border-border px-3 text-ui-sm text-foreground active:bg-surface-hover disabled:opacity-50"
                onClick={() => setSheet("model")}
              >
                {modelPending ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                ) : (
                  <Cpu className="size-3.5 shrink-0 text-foreground-subtle" />
                )}
                <span dir="ltr" className="truncate">
                  {modelLabel(modelOption) ?? t("model")}
                </span>
              </button>
            ) : null}
            <span className="flex-1" />
            {running ? (
              <button
                type="button"
                disabled={stopping}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-destructive/10 px-3 text-ui-sm font-medium text-destructive disabled:opacity-60"
                onClick={() => void stopTask()}
              >
                {stopping ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Square className="size-3 fill-current" />
                )}
                {stopping ? t("stopping") : t("stop")}
              </button>
            ) : null}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              rows={1}
              dir="auto"
              onChange={(event) => {
                setDraft(event.target.value);
                const element = event.target;
                element.style.height = "auto";
                element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
              }}
              placeholder={t("messagePlaceholder")}
              aria-label={t("messagePlaceholder")}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-input-border bg-surface px-3.5 py-2.5 text-mobile-input-safe text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              aria-label={t("send")}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              disabled={!draft.trim() || connection !== "paired"}
              onClick={() => void sendPrompt()}
            >
              <ArrowUp className="size-5" />
            </button>
          </div>
        </footer>
        {sheets}
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${connection === "paired" ? "bg-success" : connectionPresentation.terminal ? "bg-destructive" : "bg-warning"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui-lg font-semibold">{t("chats")}</p>
            {knownDeviceName ? (
              <p
                data-testid="mobile-known-device-name"
                className="truncate text-ui-sm text-foreground-subtle"
              >
                {t("device", { name: knownDeviceName })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t("refresh")}
            className="grid size-11 place-items-center rounded-full active:bg-surface-hover"
            onClick={() => {
              void refreshBootstrap().catch((error) => reportError("[mobile] 刷新工作区失败", error));
              void refreshTasks();
            }}
          >
            <RefreshCw className={`size-5 ${tasksLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            aria-label={t("newTask")}
            disabled={connection !== "paired"}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-ui-base font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => setSheet("newTask")}
          >
            <Plus className="size-4" />
            {t("newTask")}
          </button>
        </div>
        {banner}
        <div className="space-y-2 px-4 pb-3 pt-1">
          {searchBox}
          {projectNames.length > 1 ? (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
              <FilterChip active={!projectFilter} onClick={() => setProjectFilter(null)}>
                {t("allProjects")}
              </FilterChip>
              {projectNames.map((name) => (
                <FilterChip
                  key={name}
                  active={projectFilter === name}
                  onClick={() => setProjectFilter(projectFilter === name ? null : name)}
                >
                  {name}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      {noticeBar}
      <main className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        {tasks === null ? (
          <p className="flex items-center justify-center gap-2 py-16 text-ui-base text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" />
            {connection === "paired" ? t("loadingChat") : connectionPresentation.label}
          </p>
        ) : (
          taskList(filteredTasks, false)
        )}
      </main>
      {sheets}
    </div>
  );
}

function TaskStatusMark({ status, unread }: { status: MobileTask["status"]; unread: boolean }) {
  const label =
    status === "running"
      ? t("statusRunning")
      : status === "error"
        ? t("statusError")
        : status === "completed"
          ? t("statusDone")
          : t("statusIdle");
  return (
    <span className="grid size-8 shrink-0 place-items-center" title={label}>
      <span className="sr-only">{label}</span>
      {status === "running" ? (
        <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
      ) : status === "error" ? (
        <span aria-hidden className="size-2.5 rounded-full bg-destructive" />
      ) : unread ? (
        <span aria-hidden className="size-2.5 rounded-full bg-primary" />
      ) : (
        <span aria-hidden className="size-2.5 rounded-full border border-border" />
      )}
    </span>
  );
}

function FilterChip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-ui-sm ${props.active ? "bg-foreground text-background" : "bg-surface text-foreground-subtle"}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function ModelList({
  option,
  onPick,
}: {
  option: ZCodeConfigOption;
  onPick: (value: string, name: string) => void;
}) {
  const groups = new Map<string, NonNullable<ZCodeConfigOption["options"]>>();
  for (const item of option.options ?? []) {
    const key = item.modelProviderName ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="pb-2">
      {[...groups.entries()].map(([provider, items]) => (
        <section key={provider || "default"}>
          {provider ? (
            <p className="px-4 pb-1 pt-3 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtle">
              {provider}
            </p>
          ) : null}
          <ul>
            {items.map((item) => {
              const selected = item.value === option.currentValue;
              return (
                <li key={item.value}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-start active:bg-surface-hover ${selected ? "bg-surface" : ""}`}
                    onClick={() => onPick(item.value, item.name)}
                  >
                    <span className="min-w-0 flex-1">
                      <span dir="ltr" className="block truncate text-ui-base text-foreground">
                        {item.name}
                      </span>
                      {item.description ? (
                        <span dir="auto" className="block truncate text-ui-sm text-foreground-subtle">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {selected ? <ChevronRight className="size-4 text-primary rtl:rotate-180" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BottomSheet(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose 每次渲染新建，挂载期间只绑定一次
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label={props.title}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
        onClick={props.onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="relative flex max-h-[85dvh] flex-col rounded-t-2xl bg-popover text-popover-foreground shadow-xl"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <p className="flex-1 text-ui-lg font-semibold">{props.title}</p>
          <button
            type="button"
            aria-label={t("close")}
            className="grid size-10 place-items-center rounded-full active:bg-surface-hover"
            onClick={props.onClose}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {props.children}
        </div>
      </div>
    </div>
  );
}

export type { WebRemoteControlAppPayload, WebRemoteControlWorkspaceRef };
