# Edge 📈 &middot; [![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)

Trading edge.

### Requires

- [Node v18.15.0](https://nodejs.org/)
- npm v9.6.2

### Installation

```sh
$ npm ci
```

### Usage

```sh
$ node edge.js <SYMBOL> # e.g. 'node edge.js BTCUSDT'
```

### Options

##### `-s` / `--size`

Candle size in seconds (defaults to 60)

```sh
node edge.js <SYMBOL> -s 300 # 5m candles
```
