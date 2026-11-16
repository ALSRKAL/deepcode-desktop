import type { MobileConnectionState } from "./protocol.js";
import { t } from "./mobileI18n.js";

export interface MobileConnectionDetail {
  reason?: string;
  closeCode?: number;
}

export interface MobileConnectionSnapshot {
  state: MobileConnectionState;
  detail?: MobileConnectionDetail;
}

export interface MobileConnectionPresentation {
  label: string;
  description: string;
  terminal: boolean;
}

const TERMINAL_PRESENTATIONS: Record<string, MobileConnectionPresentation> = {
  AUTH_FAILED: {
    label: t("connEndedLabel"),
    description: t("connEndedExpired"),
    terminal: true,
  },
  KICKED: {
    label: t("connEndedLabel"),
    description: t("connEndedDuplicate"),
    terminal: true,
  },
  WRONG_PARAM: {
    label: t("connEndedLabel"),
    description: t("connEndedInvalid"),
    terminal: true,
  },
};

/** UI 只投影协议状态；未知原因不透传服务端文本，重试仍由协议客户端负责。 */
export function presentMobileConnection(
  state: MobileConnectionState,
  detail?: MobileConnectionDetail,
): MobileConnectionPresentation {
  const terminalPresentation = detail?.reason ? TERMINAL_PRESENTATIONS[detail.reason] : undefined;
  if (terminalPresentation) return terminalPresentation;

  // 终止错误帧可能丢失；关闭码必须呈现同样的互踢/过期语义，不能误报为可重试网络异常。
  if (detail?.closeCode === 4002) return TERMINAL_PRESENTATIONS.KICKED!;
  if (detail?.closeCode === 4003) return TERMINAL_PRESENTATIONS.AUTH_FAILED!;
  if (detail?.closeCode === 4001) {
    return {
      label: t("connEndedLabel"),
      description: t("connEndedRejected"),
      terminal: true,
    };
  }

  switch (state) {
    case "connecting":
      return detail?.closeCode !== undefined
        ? {
            label: t("connReconnectingLabel"),
            description: t("connReconnecting"),
            terminal: false,
          }
        : {
            label: t("connConnectingLabel"),
            description: t("connConnecting"),
            terminal: false,
          };
    case "authenticating":
      return {
        label: t("connVerifyingLabel"),
        description: t("connVerifying"),
        terminal: false,
      };
    case "waiting":
      return {
        label: t("connWaitingLabel"),
        description: t("connWaiting"),
        terminal: false,
      };
    case "paired":
      return {
        label: t("connPairedLabel"),
        description: t("connPaired"),
        terminal: false,
      };
    case "closed":
      return {
        label: t("connClosedLabel"),
        description: t("connClosed"),
        terminal: false,
      };
    case "error":
      return {
        label: t("connErrorLabel"),
        description: t("connError"),
        terminal: false,
      };
  }
}
