import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export const MODEL_INPUT_CAPABILITY_BADGE_CLASS_NAME =
  "pointer-events-none inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-1 py-px text-ui-xs font-medium leading-normal text-foreground-subtle";

export type ModelInputCapabilityKind = "vision" | "video" | "pdf" | "audio";

const LABEL_IDS: Record<ModelInputCapabilityKind, string> = {
  vision: "model.capability.vision",
  video: "model.capability.video",
  pdf: "model.capability.pdf",
  audio: "model.capability.audio",
};

/** One compact pill per input modality the model actually accepts. */
export function ModelInputCapabilityBadge({
  kind = "vision",
  className,
}: {
  kind?: ModelInputCapabilityKind;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: LABEL_IDS[kind] });

  return (
    <span
      className={cn(MODEL_INPUT_CAPABILITY_BADGE_CLASS_NAME, className)}
      data-model-input-capability={kind}
      aria-label={label}
      title={label}
    >
      {label}
    </span>
  );
}
