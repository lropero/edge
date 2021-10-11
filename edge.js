#!/usr/bin/env node
/**
 * Copyright (c) 2021, Luciano Ropero <lropero@gmail.com>
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import asciichart from 'asciichart'
import blessed from 'blessed'
import CFonts from 'cfonts'
import chalk from 'chalk'
import figures from 'figures'
import jsonfile from 'jsonfile'
import WebSocket from 'ws'
import { debounceTime } from 'rxjs/operators'
import { format } from 'date-fns'
import { fromEvent, interval } from 'rxjs'
import { program } from 'commander'

const BINANCE_STREAM = 'wss://fstream.binance.com/ws'
const CANDLES_LENGTH = 300
const DELTAS_LENGTH = 100
const MAX_LEVEL = 320
const TRADES_LENGTH = 3000

const store = {}

const addBox = type => {
  switch (type) {
    case 'chart': {
      const { colors, screen } = store
      const chart = blessed.box({
        height: screen.height - 12,
        style: { bg: colors.backgroundLeft },
        top: 4,
        width: screen.width - 44
      })
      append({ box: chart, type })
      break
    }
    case 'display': {
      const { colors } = store
      const display = blessed.box({
        align: 'right',
        height: 4,
        right: 1,
        style: { bg: colors.backgroundRight },
        top: 0,
        width: 43
      })
      append({ box: display, type })
      break
    }
    case 'gauge': {
      const { colors, screen } = store
      const gauge = blessed.box({
        height: 4,
        style: { bg: colors.backgroundLeft },
        width: screen.width - 44
      })
      append({ box: gauge, type })
      break
    }
    case 'highway': {
      const { colors } = store
      const highway = blessed.box({
        height: '100%',
        right: 0,
        style: { bg: colors.backgroundRight },
        width: 44
      })
      append({ box: highway, type })
      addBox('display')
      break
    }
    case 'volume': {
      const { colors, screen } = store
      const volume = blessed.box({
        bottom: 0,
        height: 8,
        style: { bg: colors.volume.background },
        width: screen.width - 44
      })
      append({ box: volume, type })
      break
    }
  }
}

const append = ({ box, type }) => {
  const { boxes, screen } = store
  if (boxes[type]) {
    screen.remove(boxes[type])
  }
  screen.append(box)
  updateStore({ boxes: { ...boxes, [type]: box } })
}

const calculateLevel = price => {
  const { deltas, trade } = store
  if (!trade) {
    return 0
  }
  const delta = Math.abs(price - trade.price)
  if (delta > 0) {
    deltas.push(delta)
    if (deltas.length > DELTAS_LENGTH) {
      do {
        deltas.shift()
      } while (deltas.length > DELTAS_LENGTH)
    }
    const average = deltas.reduce((average, delta) => average + delta, 0) / deltas.length
    let level = trade.level
    if (price < trade.price) {
      level -= Math.round((delta / average) * 8)
    } else if (price > trade.price) {
      level += Math.round((delta / average) * 8)
    }
    if (level > MAX_LEVEL) {
      level = MAX_LEVEL
    } else if (level < -MAX_LEVEL) {
      level = -MAX_LEVEL
    }
    return level
  }
  return trade.level
}

const draw = () => {
  const { boxes, candles, colors, currency, directionColor, pair, screen, trade, trades } = store
  if (trade) {
    const pairRender = CFonts.render(pair, {
      colors: [colors.display.pair],
      font: 'tiny',
      space: false
    })
    const priceRender = CFonts.render(currency.format(trade.price), {
      colors: [directionColor],
      font: 'tiny',
      space: false
    })
    const values = Object.values(candles)
    const width = screen.width - 54
    boxes.chart.setContent(
      screen.height - 12 > 0 && values.length > 1 && width > 1
        ? asciichart.plot(
            values.slice(-width).map(candle => candle.close),
            {
              colors: [colors.chart.line],
              format: close => chalk[colors.chart.label](close.toFixed(2).padStart(8)),
              height: screen.height - 13
            }
          )
        : ''
    )
    boxes.display.setContent(`${pairRender.string}\n${priceRender.string}`)
    boxes.gauge.setContent(getGauge())
    boxes.highway.setContent(
      `\n\n\n${trades
        .slice(0, screen.height - 4)
        .map(trade => getLine(trade))
        .join('')}`
    )
    boxes.volume.setContent(
      values.length > 1 && width > 1
        ? asciichart.plot(
            values.slice(-width).map(candle => candle.volume),
            {
              colors: [colors.volume.line],
              format: volume => chalk[colors.volume.label](volume.toFixed(2).padStart(8)),
              height: 7
            }
          )
        : ''
    )
  }
  screen.render()
}

const getGauge = () => {
  const { colors, screen, trades } = store
  const buy = trades.reduce((buy, trade) => buy + (trade.marketMaker ? parseFloat(trade.quantity) : 0), 0)
  const sell = trades.reduce((sell, trade) => sell + (!trade.marketMaker ? parseFloat(trade.quantity) : 0), 0)
  const volume = buy + sell
  const width = screen.width - 44
  if (width > 0) {
    const widthBuy = Math.round((buy * width) / volume)
    const widthSell = width - widthBuy
    return Array(4)
      .fill(`${chalk[colors.gauge.buy]('\u2588'.repeat(widthBuy))}${chalk[colors.gauge.sell]('\u2588'.repeat(widthSell))}`)
      .join('\n')
  }
  return ''
}

const getLine = trade => {
  const { colors } = store
  const level = Math.abs(trade.level)
  const blocks = Math.floor(level / 8)
  const eighths = level - blocks * 8
  return `\n${' '.repeat(42 - blocks - (eighths ? 1 : 0))}${chalk[colors.highway[trade.level > 0 ? 'up' : 'down']](`${getPartialBlock(eighths)}${'\u2588'.repeat(blocks)}`)}`
}

const getPartialBlock = eighths => {
  switch (eighths) {
    case 0:
      return ''
    case 1:
      return '\u{2595}'
    case 2:
      return '\u{1FB87}'
    case 3:
      return '\u{1FB88}'
    case 4:
      return '\u{2590}'
    case 5:
      return '\u{1FB89}'
    case 6:
      return '\u{1FB8A}'
    case 7:
      return '\u{1FB8B}'
  }
}

const initialize = () => {
  const { screen, title } = store
  addBox('chart')
  addBox('gauge')
  addBox('highway')
  addBox('volume')
  screen.key('q', () => process.exit())
  screen.title = title
  fromEvent(screen, 'resize')
    .pipe(debounceTime(50))
    .subscribe(() => {
      addBox('chart')
      addBox('gauge')
      addBox('volume')
    })
  interval(50).subscribe(draw)
  draw()
}

const start = () => {
  const { pair, webSocket } = store
  try {
    initialize()
    webSocket.on('message', message => {
      const { e, ...rest } = JSON.parse(message)
      e === 'aggTrade' && updateStore({ trade: rest })
    })
    webSocket.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: [`${pair.toLowerCase()}@aggTrade`]
      })
    )
  } catch (error) {
    console.log(`${chalk.gray(format(new Date(), 'HH:mm:ss'))} ${chalk.red(figures.cross)} ${error.toString()}`)
    process.exit()
  }
}

const updateStore = updates => {
  Object.keys(updates).forEach(key => {
    if (store.initialized) {
      switch (key) {
        case 'trade': {
          const { candles, colors, trades } = store
          const { m: marketMaker, p: price, q: quantity, T: tradeTime } = updates[key]
          const trade = { marketMaker, price: parseFloat(price), quantity: parseFloat(quantity), tradeTime }
          trade.level = calculateLevel(trade.price)
          const date = new Date(trade.tradeTime)
          const candleId = `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}-${`${date.getUTCDate()}`.padStart(2, '0')}-${date.getUTCHours() * 60 + date.getUTCMinutes()}`
          if (!candles[candleId]) {
            candles[candleId] = { buy: 0, count: 0, sell: 0, volume: 0 }
            const candleIds = Object.keys(candles).sort()
            if (candleIds.length > CANDLES_LENGTH) {
              do {
                delete candles[candleIds[0]]
                candleIds.shift()
              } while (candleIds.length > CANDLES_LENGTH)
            }
          }
          candles[candleId].close = trade.price
          candles[candleId].count++
          candles[candleId].volume += trade.quantity
          candles[candleId][marketMaker ? 'buy' : 'sell'] += trade.quantity
          trades.unshift(trade)
          if (trades.length > TRADES_LENGTH) {
            do {
              trades.pop()
            } while (trades.length > TRADES_LENGTH)
          }
          const previous = store[key]
          store[key] = trade
          store.directionColor = trade.price > previous?.price ? colors.display.priceUp : trade.price < previous?.price ? colors.display.priceDown : store.directionColor ?? 'gray'
          break
        }
        default: {
          store[key] = updates[key]
        }
      }
    } else {
      store[key] = updates[key]
    }
  })
}

program
  .argument('<pair>', 'pair')
  .action(async pair => {
    const { version } = await jsonfile.readFile('./package.json')
    const webSocket = new WebSocket(BINANCE_STREAM)
    webSocket.on('error', error => {
      console.error(error.message)
    })
    webSocket.on('open', () => {
      updateStore({
        boxes: {},
        candles: {},
        colors: {
          backgroundLeft: 'gray',
          backgroundRight: 'black',
          chart: {
            label: 'yellow',
            line: asciichart.yellow
          },
          display: {
            pair: 'yellow',
            priceDown: 'red',
            priceUp: 'green'
          },
          gauge: {
            buy: 'cyan',
            sell: 'magenta'
          },
          highway: {
            down: 'red',
            up: 'green'
          },
          volume: {
            background: 'blue',
            label: 'gray',
            line: asciichart.darkgray
          }
        },
        currency: new Intl.NumberFormat('en-US', {
          currency: 'USD',
          minimumFractionDigits: 2,
          style: 'currency'
        }),
        deltas: [],
        initialized: true,
        pair,
        screen: blessed.screen({
          forceUnicode: true,
          fullUnicode: true,
          smartCSR: true
        }),
        title: `Edge v${version}`,
        trades: [],
        webSocket
      })
      start()
    })
  })
  .parse(process.argv)
