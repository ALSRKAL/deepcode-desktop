import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";

/**
 * How the phone connects (DeepCode Studio, 2026-11-16): through the DeepCode server
 * relay by default (any network, no firewall change), same Wi-Fi only, or the user's
 * own relay / tunnel.
 */
export function WebRemoteControlEndpointSection() {
  const { intl } = useZCodeIntl();
  const settings = useSettings();
  const savedMode =
    settings.settings?.webRemoteControlConnection ??
    (settings.settings?.webRemoteControlEndpointMode === "custom" ? "custom" : "deepcode");
  const choose = (mode: "deepcode" | "lan" | "custom") =>
    void settings.update({ webRemoteControlConnection: mode }).catch(() => undefined);
  const savedUrl = settings.settings?.webRemoteControlCustomEndpointUrl ?? "";
  const [url, setUrl] = useState(savedUrl);
  const [saving, setSaving] = useState(false);

  // 保存后设置快照会推新值；同步回输入框，避免显示过期地址。
  useEffect(() => {
    setUrl(savedUrl);
  }, [savedUrl]);

  const save = async () => {
    const trimmed = url.trim();
    if (trimmed && !/^wss?:\/\//u.test(trimmed)) {
      toast(intl.formatMessage({ id: "webRemoteControl.endpoint.invalidUrl" }));
      return;
    }
    setSaving(true);
    try {
      await settings.update({
        webRemoteControlConnection: trimmed ? "custom" : "deepcode",
        webRemoteControlEndpointMode: trimmed ? "custom" : "lan",
        ...(trimmed ? { webRemoteControlCustomEndpointUrl: trimmed } : {}),
      });
      toast(intl.formatMessage({ id: "webRemoteControl.endpoint.saved" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.endpoint.saveFailed" }, { error: message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "webRemoteControl.endpoint.title" })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={savedMode === "deepcode" ? "default" : "outline"}
          size="sm"
          className="enabled:cursor-pointer"
          onClick={() => choose("deepcode")}
        >
          {intl.formatMessage({ id: "webRemoteControl.endpoint.modeDeepcode" })}
        </Button>
        <Button
          type="button"
          variant={savedMode === "lan" ? "default" : "outline"}
          size="sm"
          className="enabled:cursor-pointer"
          onClick={() => choose("lan")}
        >
          {intl.formatMessage({ id: "webRemoteControl.endpoint.modeLan" })}
        </Button>
        <Button
          type="button"
          variant={savedMode === "custom" ? "default" : "outline"}
          size="sm"
          className="enabled:cursor-pointer"
          onClick={() => choose("custom")}
        >
          {intl.formatMessage({ id: "webRemoteControl.endpoint.modeCustom" })}
        </Button>
      </div>
      <p className="text-ui-xs/relaxed text-foreground-subtle">
        {intl.formatMessage({
          id:
            savedMode === "custom"
              ? "webRemoteControl.endpoint.modeCustomHint"
              : savedMode === "lan"
                ? "webRemoteControl.endpoint.modeLanHint"
                : "webRemoteControl.endpoint.modeDeepcodeHint",
        })}
      </p>
      {savedMode === "custom" ? (
      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={intl.formatMessage({ id: "webRemoteControl.endpoint.urlPlaceholder" })}
          aria-label={intl.formatMessage({ id: "webRemoteControl.endpoint.urlLabel" })}
          className="h-9 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="enabled:cursor-pointer"
          disabled={saving}
          onClick={() => void save()}
        >
          {intl.formatMessage({ id: "webRemoteControl.endpoint.save" })}
        </Button>
      </div>
      ) : null}
    </section>
  );
}
