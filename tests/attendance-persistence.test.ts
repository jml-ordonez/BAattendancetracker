import { describe, expect, it } from "vitest";
import { getSeedScans, listScans, clearScans, resetToSeeds, loadPersistedScans } from "../lib/attendance/store";

describe("Attendance store durability and seeds", () => {
  it("provides seed scans for the default summit event session", () => {
    const seeds = getSeedScans();
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    expect(seeds.some((s) => s.studentName === "Maria Santos")).toBe(true);
    expect(seeds.some((s) => s.action === "time_in")).toBe(true);
  });

  it("reloads seed scans when reset to seeds is called", () => {
    clearScans();
    expect(listScans()).toHaveLength(0);
    resetToSeeds();
    const scans = listScans();
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.some((s) => s.sessionId === "b3c5d7e9-2222-3333-4444-555566667777")).toBe(true);
  });

  it("loads from seed if fallbackToSeedIfEmpty is true", () => {
    clearScans();
    loadPersistedScans(true);
    expect(listScans().length).toBeGreaterThan(0);
  });
});
