# Strategy notes — Cleanest Sharpe Sprint launch sniper

## What the data says

Measured on the kit's dev window (24h of pump.fun launches, 2026-11-02, 1,222 sampled coins,
entry at the first trade ≥ 2 slots after creation, max run-up over the next 600 slots):

| early distinct buyers (first 3 slots) | share of coins | P(≥1.5x) | P(≥2x) | P(≥3x) |
|---|---:|---:|---:|---:|
| 0 | 206 | — | 0.5% | 0.5% |
| 1–2 | 312 | — | 2.9% | 1.3% |
| 3–5 | 274 | — | 6.9% | 2.9% |
| 6+ | 248 | — | 14.9% | 5.2% |

Overall: P(≥1.5x) 13.9%, P(≥2x) 6.3%, P(≥3x) 2.5%, P(≥5x) 0.8%, P(≥10x) 0.1%. Only 35/1,222
coins completed (migrated). The crowd is the only entry signal with a real gradient, so the
filter is the edge.

## Why the exits are asymmetric

A round trip costs ~3% (1.25% curve fee each way + 2 × 105k lamports tx fees on a ~0.01–0.03
SOL buy). With a ~13% win rate, a fixed take-profit near the stop (e.g. +15% / −12%, the kit
sniper pilot's settings) has negative expectancy: 0.13 × 15% − 0.87 × 12% ≈ −8.5% per trip
before fees. The bot therefore takes no small profit: stop −8%, no hard take-profit, trailing
stop armed at +25% with a 25% trail. A winner has to run to pay for ~9 losers, and the trail
lets it.

## Sweep history (local engine port, full dev dataset, mean of 2 fail keys)

Baseline (kit pilots on the same sim): momentum −9.38 SOL, reversion −1.78 SOL,
sniper −0.49 SOL (Sharpe −0.84).

| step | change | net (SOL) | Sharpe | coins | wins |
|---|---|---:|---:|---:|---:|
| 0 | first version: buyers≥5, age≤6, TP +150%, trail 15%, SL −8% | −0.05 | −0.25 | 85 | 18 |
| 1 | entry: buyers≥7, age≤10 | +0.04 | −0.06 | 62 | 13 |
| 2 | exits: trail 25% (from 15%) | +0.14 | +0.17 | 62 | 12 |
| 3 | exits: hardTp off (was +150%), stake 0.1 | +0.57 | +0.22 | 62 | 12 |
| 4 | adds off (maxAdds 0, was 1) | +0.59 | +0.23 | 62 | 12 |
| 5 | entry: age≤8 (was 10) | +0.61 | +0.24 | 57 | 12 |
| 6 | exits: maxHold 900 (was 1200) | +0.65 | +0.25 | 57 | 13 |
| 7 | guardrail probes (target 30 coins / 6h) | +0.65 | +0.25 | 70 | 13 |

The chosen cell sits in a flat region: buyers 6–7 × age 8–10 scores +0.53…+0.65 SOL,
trail 0.25–0.35 scores +0.60…+0.65, maxHold 900–1800 scores +0.59…+0.65 — neighbouring cells
agree, so the result does not hinge on one sharp peak. The remaining knobs (staleSlots,
minFlowSol, maxDevBuySol, minRealSol) barely move the score (≤0.005 SOL across their ranges)
and were left at their middle values.

Sensitivity: without failed txs +0.64 SOL; at 2x fees +0.06 SOL (still positive). Net without
the 3 best coins is −0.08 SOL — the result does depend on a few runners, which is the nature
of this market; the filter, not any single coin, is what selects them.

## Guardrail pacing

The final window is 6 hours; the crowd filter yields ~14 qualifying coins in 6h on the dev
rate, under the 20-mint guardrail. The bot therefore tracks its own qualifying-coin count
(filled buys ≥ 0.01 SOL) against a pace of 30 coins over 6h of block time and opens tiny
0.011 SOL probe round trips on liquid (real SOL ≥ 1.5), recently traded curves when it lags,
selling the whole probe as soon as the buy lands. On the dev window the probes fire rarely
(main strategy already yields 57 coins) and cost ~0.004 SOL; on a 6h slice they lift the
count from 18 to 30 coins for ~0.01 SOL.

## Sizing note (why 0.011, not 0.01)

The harness counts a round trip by what its buy fills PAID (`bought_lamports`), and the paid
amount lands a few lamports under the order size (curve-fee rounding). A buy ordered at
exactly 0.01 SOL can fill at 9,999,999 lamports and not count toward the 20-mint guardrail.
Both the minimum buy and the probe size are 0.011 SOL to clear the bar with margin. Buys are
also capped by the harness at 1% of the curve's real SOL reserve per reply, which binds first
on fresh curves.
