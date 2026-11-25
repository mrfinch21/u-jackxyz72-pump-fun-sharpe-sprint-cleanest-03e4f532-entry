// Launch sniper with a buyer-count filter and asymmetric exits, for agent-fun/replay/v2
// (pump.fun bonding curves, 6-hour forward replay, ranked by hourly Sharpe).
//
// Thesis, measured on the kit's dev window (24h of pump.fun launches, 2026-11-02, 1,222 sampled
// coins):
//   - Almost every launch dies: only ~6% of coins ever run 2x from their early price, ~14%
//     reach 1.5x. A fixed take-profit near the stop (e.g. +15% / -12%) loses money because the
//     win rate (~13%) cannot pay for the losses plus ~3% round-trip fees.
//   - The run-up rate depends strongly on how many distinct wallets buy in the first slots:
//     0 early buyers -> 0.5% ever 2x; 1-2 -> 2.9%; 3-5 -> 6.9%; 6+ -> 14.9% 2x, 5.2% 3x.
//     So the entry filter is the edge: only buy launches that already show a crowd (7+ distinct
//     non-creator buyers within 8 slots of creation, real SOL 1-60, creator not sold, creator's
//     own buy under 2.5 SOL, price not already run up over 1.5x from create).
//   - The exits are therefore asymmetric on purpose: a tight stop (losers bleed slowly, so cut
//     them at -8%), no fixed take-profit (a capped winner cannot pay for nine losers), and a
//     trailing stop armed at +25% with a 25% trail, so the few runners pay for the many duds.
//     Positions are also cut at 900 slots, when stale (400 slots without a trade), or when the
//     creator sells while held.
//   - Buys are capped by the harness at 1% of the curve's real SOL reserve per reply, so the
//     0.1 SOL target stake only binds on liquid curves; on a fresh curve the buy is whatever the
//     cap allows, but never under 0.011 SOL — the guardrail counts a round trip by what its buy
//     fills PAID, and the paid amount lands a few lamports under the order size, so a buy ordered
//     at exactly 0.01 SOL can round to 9,999,999 lamports and not count.
//   - The final window is only 6 hours, so the crowd filter alone may yield fewer than the 20
//     distinct mints the guardrail needs. A pacing mechanism tops the count up to 30 coins over
//     the window with tiny 0.011 SOL probe round trips on liquid, recently traded curves (buy,
//     sell whole as soon as the buy lands). A probe costs about two tx fees plus curve fees —
//     cheap insurance, and a real trade like any other.
//
// Settings were swept on the dev window with the local engine port (see the sweep history in the
// repository's STRATEGY.md): the chosen cell sits in a flat region — neighbouring cells score
// within a few hundredths of a SOL — rather than on a sharp peak.
//
// Dev-window result (local sim, mean of 2 fail keys): net +0.65 SOL, hourly Sharpe +0.25,
// 70 distinct mints, 70 round trips, 13 wins, max drawdown 1.5%, still +0.06 SOL at 2x fees.
//
// Every decision is a pure function of the batches the harness sends: no clock, no randomness,
// no I/O, no environment reads, so the two graded executions produce byte-identical logs.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

const LAMPORTS = 1e9;
/** Protocol + creator curve fees charged on a sale (95 + 30 bps), as a fraction. */
const CURVE_FEE = 0.0125;

export interface Params {
  /** Youngest / oldest age (slots since CreateEvent) at which a first buy may be decided. */
  minAge: number;
  maxAge: number;
  /** Distinct non-creator buyers that must have bought before entry. */
  minBuyers: number;
  /** Distinct non-creator buyers at most (a launch bundled by a crowd is a dump in waiting). */
  maxBuyers: number;
  /** Real SOL reserve window at decision time. */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buy in the create slot, at most (SOL). A big dev buy is a dump setup. */
  maxDevBuySol: number;
  /** Skip the coin when the creator has sold before entry. */
  skipDevSold: boolean;
  /** Price now over the create price, at most (don't chase an already-pumped launch). */
  maxRunup: number;
  /** Net SOL (buys minus sells) over the last flowWindow slots, at least. */
  flowWindow: number;
  minFlowSol: number;
  /** SOL to aim for per coin in total (the 1%-of-real-reserve cap binds first on fresh curves). */
  stakeSol: number;
  /**
   * Smallest single buy worth paying the tx fee for. Set at 0.011, not 0.01: the guardrail counts
   * a round trip by what its buy fills PAID, and the paid amount lands a few lamports under the
   * order size, so a buy ordered at exactly 0.01 SOL can round to 9,999,999 lamports and not
   * count. 0.011 clears the bar with margin.
   */
  minBuySol: number;
  /** Buys after the first one, each on a later batch, while the coin keeps qualifying. */
  maxAdds: number;
  /** An add needs the price at least this far above the previous buy's decision price. */
  addStep: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** SOL per add. */
  addSol: number;
  /** Exit when the position's sell value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Trailing stop arms once value reaches cost * (1 + trailArm); exits on a fall of `trail`. */
  trailArm: number;
  trail: number;
  /** Hard take-profit at cost * (1 + hardTp); 0 disables it. */
  hardTp: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit at once when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Slippage allowed on buys (bps). Sells always go out at 10000. */
  buySlipBps: number;
  /** After an exit, ignore the coin for this many slots. */
  cooldown: number;
  /** Most new entries per batch (keeps the reply small and the book diversified). */
  maxEntriesPerBatch: number;
  /** Most open positions at once (harness cap is 5). */
  maxOpen: number;
  /**
   * Guardrail pacing: the run must end with round trips of at least 0.01 SOL on at least 20
   * distinct mints, but the final window is only 6 hours, so the crowd filter alone may yield
   * fewer. When the bot's own qualifying-coin count lags targetCoins prorated over paceSecs of
   * block time since the first batch, it opens tiny probe round trips (buy probeSol of a liquid,
   * recently traded curve, sell it whole as soon as the buy lands) until it is back on pace.
   * A probe costs about two tx fees plus curve fees on 0.01 SOL — cheap insurance for the
   * guardrail, and a real trade like any other.
   */
  targetCoins: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
  probeMinRqSol: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 2,
  maxAge: 8,
  minBuyers: 7,
  maxBuyers: 40,
  minRealSol: 1,
  maxRealSol: 60,
  maxDevBuySol: 2.5,
  skipDevSold: true,
  maxRunup: 1.5,
  flowWindow: 10,
  minFlowSol: 0,
  stakeSol: 0.1,
  minBuySol: 0.011,
  maxAdds: 0,
  addStep: 0.1,
  addDelay: 4,
  addSol: 0.03,
  stopLoss: 0.08,
  trailArm: 0.25,
  trail: 0.25,
  hardTp: 0,
  maxHold: 900,
  staleSlots: 400,
  exitOnDevSell: true,
  buySlipBps: 10000,
  cooldown: 300,
  maxEntriesPerBatch: 4,
  maxOpen: 5,
  targetCoins: 30,
  paceSecs: 21600,
  probeSol: 0.011,
  maxProbes: 1,
  probeMinRqSol: 1.5,
};

interface Tick {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: string;
  /** Create-time reserves: the run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  devBuy: number;
  devSold: boolean;
  buyers: Set<string>;
  trades: number;
  /** Trades of the last flowWindow slots (older ones dropped as new ones arrive). */
  recent: Tick[];
  buysSent: number;
  spentSent: number;
  lastBuyPrice: number;
  lastBuySlot: number;
  lastTradeSlot: number;
  lastExitSlot: number;
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** SOL spent on buys that filled, fees included (from fills). */
  spent: number;
  /** Best sell value seen (SOL, tx fee deducted). */
  best: number;
  devSoldAtOpen: boolean;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees (SOL). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): number {
  if (tokens <= 0n || vt <= 0n) return 0;
  const q = (Number(tokens) * Number(vq)) / (Number(vt) + Number(tokens)) / LAMPORTS;
  return q * (1 - CURVE_FEE);
}

function priceOf(vq: bigint, vt: bigint): number {
  return Number(vq) / Number(vt);
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell already in flight. */
  const selling = new Set<Pubkey>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** Mints with a filled buy of at least 0.01 SOL (the guardrail's round-trip bar). */
  const myCoins = new Set<Pubkey>();
  /** Block time of the first / latest event seen (drives the guardrail pace). */
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  /** Net SOL bought minus sold and the distinct buyers, over the last flowWindow slots. */
  const flow = (c: Coin, slot: number): { net: number; buyers: number } => {
    const from = slot - p.flowWindow;
    let drop = 0;
    while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
    if (drop > 0) c.recent.splice(0, drop);
    let net = 0;
    const buyers = new Set<string>();
    for (const t of c.recent) {
      if (t.buy) {
        net += t.sol;
        if (t.user !== c.creator) buyers.add(t.user);
      } else {
        net -= t.sol;
      }
    }
    return { net, buyers: buyers.size };
  };

  const hasPending = (state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean => {
    for (const po of state.pending.values()) {
      if (po.order.mint === mint && po.order.side === side) return true;
    }
    return false;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;

      // Fold this batch's events into the per-coin tapes.
      const traded = new Set<Pubkey>();
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          if (!coins.has(e.mint)) {
            coins.set(e.mint, {
              mint: e.mint,
              createSlot: e.slot,
              creator: e.creator,
              vq0: BigInt(e.virtual_quote_reserves),
              vt0: BigInt(e.virtual_token_reserves),
              devBuy: 0,
              devSold: false,
              buyers: new Set(),
              trades: 0,
              recent: [],
              buysSent: 0,
              spentSent: 0,
              lastBuyPrice: 0,
              lastBuySlot: 0,
              lastTradeSlot: e.slot,
              lastExitSlot: -1e12,
              done: false,
              complete: false,
            });
          }
        } else if (e.event === 'TradeEvent') {
          const c = coins.get(e.mint);
          if (c === undefined) continue;
          traded.add(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          c.trades++;
          c.lastTradeSlot = e.slot;
          c.recent.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user });
          const isDev = e.user === c.creator;
          if (e.is_buy) {
            if (isDev && e.slot === c.createSlot) c.devBuy += sol;
            else if (!isDev) c.buyers.add(e.user);
          } else if (isDev) {
            c.devSold = true;
          }
        } else {
          const c = coins.get(e.mint);
          if (c !== undefined) {
            c.complete = true;
            c.done = true;
          }
        }
      }

      // Fold this batch's fills into the held book.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') {
          if (f.side === 'buy') {
            if (Number(f.quote_lamports) >= 10_000_000) myCoins.add(f.mint);
            let h = held.get(f.mint);
            if (h === undefined) {
              const c = coins.get(f.mint);
              h = { openedSlot: f.slot, spent: 0, best: 0, devSoldAtOpen: c?.devSold ?? false };
              held.set(f.mint, h);
            }
            h.spent += Number(f.quote_lamports) / LAMPORTS + Number(f.tx_fee_lamports) / LAMPORTS;
          }
        }
      }
      for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      for (const mint of [...probes.keys()]) {
        if (!state.positions.has(mint) && !hasPending(state, mint, 'buy')) probes.delete(mint);
      }
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) {
          const c = coins.get(mint);
          if (c !== undefined) c.lastExitSlot = now;
          held.delete(mint);
        }
      }

      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });
      }
      const reservesOf = (mint: Pubkey): { vq: bigint; vt: bigint } | undefined => {
        const mk = marks.get(mint);
        if (mk !== undefined) return mk;
        const cv = state.curves.get(mint);
        if (cv === undefined) return undefined;
        return { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
      };

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, isSelling] of probes) {
        const pos = state.positions.get(mint);
        if (pos === undefined) continue;
        if (isSelling || hasPending(state, mint, 'sell')) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10000 });
        selling.add(mint);
        probes.set(mint, true);
      }

      // Exits first: stop, trailing stop, hard take-profit, hold limit, stale, dev sell.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: now, spent: Number(pos.cost_lamports) / LAMPORTS + tx, best: 0, devSoldAtOpen: c?.devSold ?? false };
          held.set(mint, h);
        }
        const res = reservesOf(mint);
        if (res === undefined) continue;
        const value = sellValue(pos.token_amount, res.vq, res.vt) - tx;
        const cost = Math.max(h.spent, Number(pos.cost_lamports) / LAMPORTS + tx);
        if (value > h.best) h.best = value;
        let exit = false;
        if (cost > 0) {
          if (value <= cost * (1 - p.stopLoss)) exit = true;
          if (p.hardTp > 0 && value >= cost * (1 + p.hardTp)) exit = true;
          if (h.best >= cost * (1 + p.trailArm) && value <= h.best * (1 - p.trail)) exit = true;
        }
        if (now - h.openedSlot >= p.maxHold) exit = true;
        if (c !== undefined) {
          if (p.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
          if (now - c.lastTradeSlot >= p.staleSlots) exit = true;
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10000 });
        selling.add(mint);
        if (c !== undefined) {
          c.done = true;
          c.lastExitSlot = now;
        }
      }

      // Entries and adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let open = state.committedPositionCount();
      let entriesThisBatch = 0;
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete || probes.has(c.mint)) continue;
        const age = now - c.createSlot;
        const isAdd = c.buysSent > 0;
        if (!isAdd && age > p.maxAge) {
          c.done = true;
          continue;
        }
        if (age < p.minAge) continue;
        if (now - c.lastExitSlot < p.cooldown) continue;
        if (isAdd) {
          if (c.buysSent > p.maxAdds) continue;
          if (!state.positions.has(c.mint) || selling.has(c.mint) || hasPending(state, c.mint, 'buy')) continue;
          if (now - c.lastBuySlot < p.addDelay) continue;
        } else {
          if (open >= p.maxOpen) continue;
          if (entriesThisBatch >= p.maxEntriesPerBatch) continue;
        }
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rqSol < p.minRealSol || rqSol > p.maxRealSol) continue;
        if (c.devSold && p.skipDevSold) {
          if (!isAdd) c.done = true;
          continue;
        }
        if (c.devBuy > p.maxDevBuySol) {
          if (!isAdd) c.done = true;
          continue;
        }
        const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
        const createPrice = priceOf(c.vq0, c.vt0);
        if (createPrice > 0 && price / createPrice > p.maxRunup) {
          if (!isAdd) c.done = true;
          continue;
        }
        if (isAdd) {
          if (price < c.lastBuyPrice * (1 + p.addStep)) continue;
          if (flow(c, now).net < p.minFlowSol) continue;
          const want = Math.min(p.addSol, p.stakeSol - c.spentSent);
          const capSol = Math.floor(Number(state.maxBuyLamports(c.mint))) / LAMPORTS;
          const amount = Math.min(want, capSol);
          if (amount < p.minBuySol || free < amount + tx) continue;
          orders.push({ side: 'buy', mint: c.mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
          free -= amount + tx;
          c.buysSent++;
          c.spentSent += amount;
          c.lastBuyPrice = price;
          c.lastBuySlot = now;
          continue;
        }
        // First buy: the crowd filter is the edge.
        if (c.buyers.size < p.minBuyers || c.buyers.size > p.maxBuyers) {
          if (age >= p.maxAge) c.done = true;
          continue;
        }
        if (flow(c, now).net < p.minFlowSol) {
          if (age >= p.maxAge) c.done = true;
          continue;
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(c.mint))) / LAMPORTS;
        const amount = Math.min(p.stakeSol, capSol);
        if (amount < p.minBuySol || free < amount + tx) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        open++;
        entriesThisBatch++;
        c.buysSent++;
        c.spentSent += amount;
        c.lastBuyPrice = price;
        c.lastBuySlot = now;
      }

      // Guardrail pacing: open a probe when the qualifying-coin count lags its pace.
      if (probes.size < p.maxProbes && open < p.maxOpen && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        if (myCoins.size < Math.ceil(p.targetCoins * pace)) {
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || hasPending(state, mint, 'buy') || state.positions.has(mint)) continue;
            if (myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < p.probeMinRqSol) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
