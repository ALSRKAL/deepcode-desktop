import { describe, expect, it } from "vitest";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import {
  filterModelSelectGroups,
  filterModelSelectItems,
  modelSelectItemMatches,
  reasoningLevelIndex,
  reasoningLevelValue,
} from "./modelSelectFilters.js";

const groups: ModelSelectGroup[] = [
  {
    key: "provider:opencode",
    label: "opencode",
    items: [
      {
        key: "opencode:deepseek",
        value: "account:deepcode/deepseek-v4.1-flash",
        name: "DeepSeek Flash",
        detail: "DeepSeek V4.1 Flash",
        supportsVisionInput: true,
        reasoningLevels: ["low", "high", "max"],
      },
      {
        key: "opencode:hungerg",
        value: "account:deepcode/hungerg-free",
        name: "HungerG Free",
        detail: "Stealth reasoning model",
        supportsVisionInput: true,
        supportsVideoInput: true,
      },
    ],
  },
  {
    key: "provider:other",
    label: "Other",
    items: [{ key: "other:model", value: "other/model", name: "Other Model" }],
  },
];

describe("model picker search", () => {
  it("matches names, upstream detail and raw values", () => {
    expect(modelSelectItemMatches(groups[0]!.items[0]!, "deepseek")).toBe(true);
    expect(modelSelectItemMatches(groups[0]!.items[0]!, "flash")).toBe(true);
    expect(modelSelectItemMatches(groups[0]!.items[0]!, "v4.1")).toBe(true);
    expect(modelSelectItemMatches(groups[0]!.items[0]!, "hunger")).toBe(false);
  });

  it("keeps only groups with matches and returns everything for an empty query", () => {
    expect(filterModelSelectGroups(groups, "")).toEqual(groups);
    const filtered = filterModelSelectGroups(groups, "hunger");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.items.map((item) => item.name)).toEqual(["HungerG Free"]);
    expect(filterModelSelectGroups(groups, "nothing-matches")).toEqual([]);
    expect(filterModelSelectItems(groups[0]!.items, "flash").map((item) => item.name)).toEqual([
      "DeepSeek Flash",
    ]);
  });
});

describe("reasoning slider", () => {
  it("maps a level to its index and falls back to the lowest level", () => {
    expect(reasoningLevelIndex(["low", "high", "max"], "high")).toBe(1);
    expect(reasoningLevelIndex(["low", "high", "max"], "max")).toBe(2);
    expect(reasoningLevelIndex(["low", "high", "max"], "unknown")).toBe(0);
    expect(reasoningLevelIndex([], "max")).toBe(0);
  });

  it("maps a slider index back to a level and clamps out-of-range values", () => {
    expect(reasoningLevelValue(["low", "high", "max"], 0)).toBe("low");
    expect(reasoningLevelValue(["low", "high", "max"], 2)).toBe("max");
    expect(reasoningLevelValue(["low", "high", "max"], 99)).toBe("max");
    expect(reasoningLevelValue(["low", "high", "max"], -1)).toBe("low");
    expect(reasoningLevelValue([], 0)).toBeUndefined();
  });
});
