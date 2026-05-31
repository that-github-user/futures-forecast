/**
 * Unit tests for resolveChipPresentation — the StrategyMonitorCard
 * status-chip resolver. Pins the P6 honest-chip behavior: a broker
 * no-fill (blocked_order) must NOT read "JUST FIRED" / "FIRED EARLIER",
 * while keeping the highlighted fired style (operator preference).
 */

import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../../../lib/dcLifecycle";
import { resolveChipPresentation } from "./chipPresentation";

const resolve = (
  state: LifecycleState,
  opts: { slGateFailing?: boolean; brokerNoFill?: boolean } = {},
) =>
  resolveChipPresentation({
    state,
    slGateFailing: opts.slGateFailing ?? false,
    brokerNoFill: opts.brokerNoFill ?? false,
  });

describe("resolveChipPresentation — default (no overrides)", () => {
  it("uses the plain per-state label + style key", () => {
    expect(resolve("recently_fired")).toEqual({
      label: "JUST FIRED",
      styleKey: "recently_fired",
    });
    expect(resolve("passed_will_fire")).toEqual({
      label: "FIRED EARLIER",
      styleKey: "passed_will_fire",
    });
    expect(resolve("primed")).toEqual({ label: "PRIMED", styleKey: "primed" });
  });
});

describe("resolveChipPresentation — broker no-fill (P6)", () => {
  it("relabels fired states to NO FILL but KEEPS the fired style", () => {
    // recently_fired + passed_will_fire are the two "JUST FIRED"/"FIRED
    // EARLIER" labels the operator called out as misleading.
    expect(resolve("recently_fired", { brokerNoFill: true })).toEqual({
      label: "NO FILL",
      styleKey: "recently_fired", // green/highlighted — not grayed out
    });
    expect(resolve("passed_will_fire", { brokerNoFill: true })).toEqual({
      label: "NO FILL",
      styleKey: "passed_will_fire",
    });
  });

  it("also covers an in-window firing no-fill", () => {
    expect(resolve("firing", { brokerNoFill: true })).toEqual({
      label: "NO FILL",
      styleKey: "firing",
    });
  });

  it("does NOT touch non-fired states (no fill to misrepresent)", () => {
    // A blocked_order shouldn't normally land here, but if it did the
    // plain label is correct and not misleading.
    expect(resolve("primed", { brokerNoFill: true })).toEqual({
      label: "PRIMED",
      styleKey: "primed",
    });
    expect(resolve("passed_skipped", { brokerNoFill: true })).toEqual({
      label: "NO FIRE",
      styleKey: "passed_skipped",
    });
  });
});

describe("resolveChipPresentation — S/L gate failing (unchanged)", () => {
  it("neutralizes label + style: SKIPPED after entry, GATE FAIL before", () => {
    expect(resolve("recently_fired", { slGateFailing: true })).toEqual({
      label: "SKIPPED",
      styleKey: "not_fired_yet",
    });
    expect(resolve("passed_will_fire", { slGateFailing: true })).toEqual({
      label: "SKIPPED",
      styleKey: "not_fired_yet",
    });
    expect(resolve("firing", { slGateFailing: true })).toEqual({
      label: "GATE FAIL",
      styleKey: "not_fired_yet",
    });
    expect(resolve("imminent", { slGateFailing: true })).toEqual({
      label: "GATE FAIL",
      styleKey: "not_fired_yet",
    });
  });

  it("S/L gate failing takes precedence over broker no-fill (live gate-state wins; rare overlap)", () => {
    expect(
      resolve("recently_fired", { slGateFailing: true, brokerNoFill: true }),
    ).toEqual({ label: "SKIPPED", styleKey: "not_fired_yet" });
  });
});
