# Edge 📈 &middot; [![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active) ![GitHub package.json version](https://img.shields.io/github/package-json/v/lropero/highway) ![Exchange](https://img.shields.io/badge/Exchange-Binance-yellowgreen)

Trading edge.

### Requires

- [Node v18.16.0](https://nodejs.org/)
- npm v9.6.4

### Installation

```sh
npm ci
```

### Usage

```sh
node edge.js <SYMBOL> # e.g. 1m candles 'node edge.js BTCUSDT'
```

```sh
npm run start # BTCUSDT 1m candles
npm run start:3m # BTCUSDT 3m candles
npm run start:5m # BTCUSDT 5m candles
npm run start:15m # BTCUSDT 15m candles
```

### Options

##### `-s <seconds>` / `--size <seconds>`

Candle size in seconds (default 60).

```sh
node edge.js <SYMBOL> -s <seconds> # e.g. 5m candles 'node edge.js BTCUSDT -s 300'
```

##### `-x <device>` / `--lifx <device>`

Use LIFX light device.
