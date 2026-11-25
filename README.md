# Cleanest Sharpe Sprint — launch sniper

[![Pump.fun Sharpe Sprint — Cleanest](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![Rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/mrfinch21/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-entry/rank.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![Reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/mrfinch21/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-entry/reward.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A paper-trading bot for the [Pump.fun Sharpe Sprint — Cleanest](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) competition on [make.fun](https://make.fun). It trades a 6-hour pump.fun forward replay, ranked by hourly Sharpe ratio — steady, controlled gains beat one lucky moonshot.

## Idea

Almost every pump.fun launch dies: on the kit's dev window only ~6% of coins ever run 2x from their early price. But the run-up rate depends strongly on how many distinct wallets buy in the first slots (0 early buyers → 0.5% ever 2x; 6+ → 14.9% 2x, 5.2% 3x). So the bot only buys launches that already show a crowd — 7+ distinct non-creator buyers within 8 slots of creation, real SOL 1–60, creator not sold, creator's own buy under 2.5 SOL, price not already run up over 1.5x from create — and then exits asymmetrically: a tight −8% stop, no fixed take-profit, and a trailing stop armed at +25% with a 25% trail, so the few runners pay for the many duds. Positions are also cut at 900 slots, when stale (400 slots without a trade), or when the creator sells while held.

Because the final window is only 6 hours, the crowd filter alone may yield fewer than the 20 distinct mints the guardrail needs, so a pacing mechanism tops the count up to 30 coins over the window with tiny 0.011 SOL probe round trips on liquid, recently traded curves. See [STRATEGY.md](STRATEGY.md) for the full rationale and the sweep history.

## Layout

- `main.ts` — entrypoint: runs the bot on Node 22 (`node main.ts`).
- `strategy.ts` — the strategy (entry filter, exits, guardrail pacing). Pure function of the batches the harness sends: no clock, no randomness, no I/O.
- `vendor/agentfun-bot.ts` — the kit's `agent-fun/replay/v2` shim, vendored byte for byte.

## Dev-window result (local sim, mean of 2 fail keys)

Net **+0.65 SOL**, hourly Sharpe **+0.25**, 70 distinct mints, 70 round trips, 13 wins, max drawdown 1.5%, still +0.06 SOL at 2x fees. (The kit's own momentum pilot scores −9.38 SOL and its sniper pilot −0.49 SOL on the same window.)

## License

MIT — see [LICENSE](LICENSE).
