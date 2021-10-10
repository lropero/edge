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

import Binance from 'node-binance-api'
import blessed from 'blessed'
import CFonts from 'cfonts'
import chalk from 'chalk'
import figures from 'figures'
import jsonfile from 'jsonfile'
import { debounceTime } from 'rxjs/operators'
import { format } from 'date-fns'
import { fromEvent } from 'rxjs'
import { program } from 'commander'

const store = {}

const addBox = type => {
  const { colors } = store
  switch (type) {
    case 'display': {
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
    case 'highway': {
      const highway = blessed.box({
        height: '100%',
        right: 0,
        style: { bg: colors.backgroundRight },
        width: 44
      })
      append({ box: highway, type })
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
  const { deltas, trades } = store
  const previousTrade = trades[0]
  if (!previousTrade) {
    return 0
  }
  const delta = Math.abs(price - previousTrade.price)
  if (delta > 0) {
    deltas.push(delta)
    const DELTAS_LENGTH = 300
    if (deltas.length > DELTAS_LENGTH) {
      do {
        deltas.shift()
      } while (deltas.length > DELTAS_LENGTH)
    }
    const average = deltas.reduce((average, delta) => average + delta, 0) / deltas.length
    let level = previousTrade.level
    if (price < previousTrade.price) {
      level -= Math.round((delta / average) * 8)
    } else if (price > previousTrade.price) {
      level += Math.round((delta / average) * 8)
    }
    const MAX_LEVEL = 320
    if (level > MAX_LEVEL) {
      level = MAX_LEVEL
    } else if (level < -MAX_LEVEL) {
      level = -MAX_LEVEL
    }
    return level
  }
  return previousTrade.level
}

const draw = () => {
  const { boxes, colors, currency, directionColor, pair, screen, trade, trades } = store
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
    boxes.display.setContent(`${pairRender.string}\n${priceRender.string}`)
    boxes.highway.setContent(
      `\n\n\n${trades
        .slice(0, screen.height - 4)
        .map(trade => getLine(trade))
        .join('')}`
    )
  }
  screen.render()
}

const getLine = trade => {
  const { colors } = store
  const level = Math.abs(trade.level)
  const blocks = Math.floor(level / 8)
  const eighths = level - blocks * 8
  return `\n${' '.repeat(42 - blocks - (eighths ? 1 : 0))}${chalk[trade.level > 0 ? colors.highway.up : colors.highway.down](
    `${getPartialBlock(eighths)}${'\u2588'.repeat(blocks)}`
  )}`
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
  addBox('highway')
  addBox('display')
  screen.key('q', () => process.exit())
  screen.title = title
  fromEvent(screen, 'resize')
    .pipe(debounceTime(50))
    .subscribe(draw)
  draw()
}

const start = () => {
  const { binance, pair } = store
  try {
    initialize()
    binance.websockets.trades(pair, trade => {
      // const { a: sellerOrderId, b: buyerOrderId, E: eventTime, e: eventType, m: marketMaker, p: price, q: quantity, s: symbol, t: tradeId, T: tradeTime } = trade
      const { m: marketMaker, p: price, q: quantity, T: tradeTime } = trade
      const level = calculateLevel(price)
      updateStore({ trade: { level, marketMaker, price, quantity, tradeTime } })
    })
  } catch (error) {
    console.log(`${chalk.gray(format(new Date(), 'HH:mm:ss'))} ${chalk.red(figures.cross)} ${error.toString()}`)
    process.exit()
  }
}

const updateStore = updates => {
  const { colors, initialized, trades } = store
  Object.keys(updates).forEach(key => {
    const previous = store[key]
    store[key] = updates[key]
    if (initialized) {
      switch (key) {
        case 'trade': {
          store.directionColor =
            updates[key].price > previous.price
              ? colors.display.priceUp
              : updates[key].price < previous.price
              ? colors.display.priceDown
              : store.directionColor ?? 'gray'
          trades.unshift(previous)
          const TRADES_LENGTH = 100
          if (trades.length > TRADES_LENGTH) {
            do {
              trades.pop()
            } while (trades.length > TRADES_LENGTH)
          }
          return draw()
        }
      }
    }
  })
}

program
  .argument('<pair>', 'pair')
  .action(async pair => {
    const { version } = await jsonfile.readFile('./package.json')
    updateStore({
      binance: new Binance().options({
        log: () => {},
        useServerTime: true
      }),
      boxes: {},
      colors: {
        backgroundRight: 'black',
        display: {
          pair: 'yellow',
          priceDown: 'red',
          priceUp: 'green'
        },
        highway: {
          down: 'red',
          up: 'green'
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
      trades: []
    })
    start()
  })
  .parse(process.argv)
