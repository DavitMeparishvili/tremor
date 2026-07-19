import { describe, expect, it } from "vitest";
import { ARMING_MS, BETTING_MS, STARTING_BALANCE } from "../sim/constants";
import { createEngine } from "../sim/engine";
import { LocalSeededProvider } from "../sim/outcome";
import { verifyRoundResult } from "../sim/verify";
import { createTremorStore } from "./store";

const flush = async (levels = 6): Promise<void> => {
  for (let i = 0; i < levels; i++) await Promise.resolve();
};

describe("store bridge", () => {
  it("mirrors engine phase, wallet, bets, and history through a full round", async () => {
    const engine = createEngine({
      provider: new LocalSeededProvider("store-test-seed"),
      initialBalance: STARTING_BALANCE,
    });
    const store = createTremorStore(engine);

    engine.tick(0);
    await flush();
    expect(store.getState().phase).toBe("betting");
    expect(store.getState().phaseEndsAt).toBe(BETTING_MS);
    expect(store.getState().balance).toBe(STARTING_BALANCE);

    store.getState().placeBet(0, 50, null);
    expect(store.getState().balance).toBe(STARTING_BALANCE - 50);
    expect(store.getState().bets[0]).toMatchObject({ state: "placed", amount: 50 });

    engine.tick(BETTING_MS + ARMING_MS);
    await flush();
    expect(store.getState().phase).toBe("running");
    expect(store.getState().bets[0].state).toBe("live");

    // drive until the round crashes (nominal fast-forward is exercised elsewhere)
    let t = BETTING_MS + ARMING_MS;
    while (store.getState().phase === "running" && t < 1_000_000) {
      t += 100;
      engine.tick(t);
      await flush();
    }
    expect(store.getState().phase).toBe("crashed");
    expect(store.getState().bets[0].state).toBe("busted");

    const [latest] = store.getState().history;
    expect(latest.seed).toBe("store-test-seed");
    expect(latest.nonce).toBe(1);
    expect(verifyRoundResult(latest)).toBe(true);
  });

  it("keeps `multiplier` transient — engine events never write it", async () => {
    const engine = createEngine({ provider: new LocalSeededProvider("transient-seed") });
    const store = createTremorStore(engine);
    engine.tick(0);
    await flush();
    engine.tick(1_000_000); // deep into a round; only the game loop writes multiplier
    expect(store.getState().multiplier).toBe(1);
  });

  it("updates settings via setSetting", () => {
    const engine = createEngine({ provider: new LocalSeededProvider("settings-seed") });
    const store = createTremorStore(engine, { reducedMotion: true });
    expect(store.getState().settings).toEqual({ reducedMotion: true, muted: false });
    store.getState().setSetting("muted", true);
    expect(store.getState().settings.muted).toBe(true);
  });
});
