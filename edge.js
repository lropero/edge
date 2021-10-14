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
import { exec } from 'child_process'
import { format } from 'date-fns'
import { fromEvent, interval } from 'rxjs'
import { program } from 'commander'

const BINANCE_STREAM = 'wss://fstream.binance.com/ws'
const CANDLES_LENGTH = [720, 360, 288, 192, 72]
const GAUGES = [375, 750, 1500, 3000]
const HIGHWAY_DELTAS = 100
const HIGHWAY_LEVEL = 368
const PLAY_MAC = 'afplay <SOUND>'
const PLAY_WINDOWS = '"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" --intf=null --play-and-exit <SOUND>'
const TIMEFRAMES = [1, 3, 5, 15, 60]

const store = {}

const addBox = type => {
  switch (type) {
    case 'chart': {
      const { colors, screen } = store
      const chart = blessed.box({
        height: screen.height - 22,
        style: { bg: colors.chart.background },
        top: 4,
        width: screen.width - 50
      })
      append({ box: chart, type })
      break
    }
    case 'count': {
      const { colors, screen } = store
      const count = blessed.box({
        bottom: 13,
        height: 5,
        style: { bg: colors.count.background },
        width: screen.width - 50
      })
      append({ box: count, type })
      break
    }
    case 'display': {
      const { colors, screen } = store
      const display = blessed.box({
        align: 'right',
        height: 4,
        right: 1,
        style: { bg: colors.display.background },
        top: 0,
        width: 49
      })
      append({ box: display, type })
      screen.append(
        blessed.box({
          height: 4,
          right: 0,
          style: { bg: colors.display.background },
          top: 0,
          width: 1
        })
      )
      break
    }
    case 'gauges': {
      const { colors, screen } = store
      const gauges = blessed.box({
        height: 4,
        style: { bg: colors.gauges.background },
        width: screen.width - 50
      })
      append({ box: gauges, type })
      break
    }
    case 'highway': {
      const { colors, screen } = store
      const highway = blessed.box({
        height: screen.height - 12,
        right: 0,
        style: { bg: colors.highway.background },
        top: 4,
        width: 50
      })
      append({ box: highway, type })
      break
    }
    case 'log': {
      const { colors } = store
      const log = blessed.box({
        align: 'right',
        bottom: 0,
        height: 8,
        right: 0,
        style: { bg: colors.log.background, fg: colors.log.foreground },
        width: 50
      })
      append({ box: log, type })
      break
    }
    case 'polarvol': {
      const { colors, screen } = store
      const polarvol = blessed.box({
        bottom: 8,
        height: 5,
        style: { bg: colors.polarvol.background },
        width: screen.width - 50
      })
      append({ box: polarvol, type })
      break
    }
    case 'volume': {
      const { colors, screen } = store
      const volume = blessed.box({
        bottom: 0,
        height: 8,
        style: { bg: colors.volume.background },
        width: screen.width - 50
      })
      append({ box: volume, type })
      break
    }
  }
}

const analyze = timeframe => {
  const { candles, chartsActive, pair } = store
  const values = Object.values(candles[timeframe]).slice(0, -1)
  const volDiff = values.map(candle => (candle.buy - candle.sell) * candle.volume)
  const maxVolDiff = Math.max(...volDiff.map(value => Math.abs(value)))
  const polarvol = volDiff.map(value => value / maxVolDiff)
  if (Math.abs(polarvol[polarvol.length - 1]) === 1) {
    log(`${pair} ${timeframe}m ${polarvol[polarvol.length - 1] === 1 ? chalk.green('⬆') : chalk.red('⬇')}`)
    play('signal.mp3')
  }
  if (!chartsActive.includes(timeframe)) {
    updateStore({ chartsActive: [...chartsActive, timeframe] })
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
    if (deltas.length > HIGHWAY_DELTAS) {
      do {
        deltas.shift()
      } while (deltas.length > HIGHWAY_DELTAS)
    }
    const average = deltas.reduce((average, delta) => average + delta, 0) / deltas.length
    let level = trade.level
    if (price < trade.price) {
      level -= Math.round((delta / average) * 8)
    } else if (price > trade.price) {
      level += Math.round((delta / average) * 8)
    }
    if (level > HIGHWAY_LEVEL) {
      level = HIGHWAY_LEVEL
    } else if (level < -HIGHWAY_LEVEL) {
      level = -HIGHWAY_LEVEL
    }
    return level
  }
  return trade.level
}

const cycleChart = (previous = false) => {
  const { charts, currentChart, drawInterval, drawTimeout } = store
  if (charts.length > 1) {
    let index = charts.indexOf(currentChart)
    if (previous) {
      index--
    } else {
      index++
    }
    if (index < 0) {
      index = charts.length - 1
    } else if (index === charts.length) {
      index = 0
    }
    updateStore({ currentChart: charts[index] })
  }
  drawTimeout && clearTimeout(drawTimeout)
  drawInterval.unsubscribe()
  store.drawInterval = interval(50).subscribe(draw)
  store.drawTimeout = setTimeout(() => {
    store.drawInterval.unsubscribe()
    store.drawInterval = interval(200).subscribe(draw)
  }, 900000)
}

const draw = () => {
  const { boxes, candles, chartsActive, colors, currency, currentChart, directionColor, messages, pair, rotationVolume, screen, trade, trades } = store
  if (trade) {
    const pairRender = CFonts.render(`${pair}${currentChart ? ` ${currentChart}m` : ''}`, {
      colors: [colors.display[chartsActive.includes(currentChart) ? 'pairActive' : 'pair']],
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
      `${trades
        .slice(0, screen.height - 12)
        .map(trade => getLine(trade))
        .join('\n')}`
    )
    boxes.log.setContent(messages.join('\n'))
    boxes.gauges.setContent(getGauges())
    if (currentChart) {
      const values = Object.values(candles[currentChart])
      const width = screen.width - 60
      if (values.length > 1 && width > 1) {
        boxes.count.setContent(
          asciichart.plot(
            values.slice(-width).map(candle => candle.count),
            {
              colors: [colors.count.line],
              format: count => chalk[colors.count.label](count.toFixed(0).padStart(8)),
              height: 4
            }
          )
        )
        const volDiff = values.slice(-width).map(candle => (candle.buy - candle.sell) * candle.volume)
        const maxVolDiff = Math.max(...volDiff.map(value => Math.abs(value)))
        boxes.polarvol.setContent(
          asciichart.plot(
            volDiff.map(value => value / maxVolDiff),
            {
              colors: [colors.polarvol.line],
              format: close => chalk[colors.polarvol.label](close.toFixed(2).padStart(8)),
              height: 4
            }
          )
        )
        const lineColors = [colors.volume.buy, colors.volume.sell, colors.volume.line]
        const series = [values.slice(-width).map(candle => candle.buy), values.slice(-width).map(candle => candle.sell), values.slice(-width).map(candle => candle.volume)]
        boxes.volume.setContent(
          asciichart.plot([series[rotationVolume[0]], series[rotationVolume[1]], series[rotationVolume[2]]], {
            colors: [lineColors[rotationVolume[0]], lineColors[rotationVolume[1]], lineColors[rotationVolume[2]]],
            format: volume => chalk[colors.volume.label](volume.toFixed(2).padStart(8)),
            height: 7
          })
        )
        if (screen.height - 22 > 0) {
          boxes.chart.setContent(
            asciichart.plot(
              values.slice(-width).map(candle => candle.close),
              {
                colors: [colors.chart.line],
                format: close => chalk[colors.chart.label](close.toFixed(2).padStart(8)),
                height: screen.height - 23
              }
            )
          )
        } else {
          boxes.chart.setContent('')
        }
      } else {
        boxes.chart.setContent('')
        boxes.polarvol.setContent('')
        boxes.volume.setContent('')
      }
    } else {
      boxes.chart.setContent('')
      boxes.polarvol.setContent('')
      boxes.volume.setContent('')
    }
  }
  screen.render()
}

const getGauges = () => {
  const { colors, screen, trades } = store
  const lines = []
  const width = screen.width - 50
  if (width > 0) {
    GAUGES.forEach(window => {
      const wTrades = trades.slice(0, window)
      const buy = wTrades.reduce((buy, trade) => buy + (trade.marketMaker ? parseFloat(trade.quantity) : 0), 0)
      const sell = wTrades.reduce((sell, trade) => sell + (!trade.marketMaker ? parseFloat(trade.quantity) : 0), 0)
      const volume = buy + sell
      const widthBuy = Math.round((buy * width) / volume)
      const widthSell = width - widthBuy
      lines.push(`${chalk[colors.gauges.buy]('\u2588'.repeat(widthBuy))}${chalk[colors.gauges.sell]('\u2588'.repeat(widthSell))}`)
    })
    return lines.join('\n')
  }
  return ''
}

const getLine = trade => {
  const { colors } = store
  const level = Math.abs(trade.level)
  const blocks = Math.floor(level / 8)
  const eighths = level - blocks * 8
  return `${' '.repeat(48 - blocks - (eighths ? 1 : 0))}${chalk[colors.highway[trade.level > 0 ? 'up' : 'down']](`${getPartialBlock(eighths)}${'\u2588'.repeat(blocks)}`)}`
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
  addBox('count')
  addBox('display')
  addBox('gauges')
  addBox('highway')
  addBox('log')
  addBox('polarvol')
  addBox('volume')
  screen.key('n', () => cycleChart(true))
  screen.key('m', () => cycleChart())
  screen.key('q', () => process.exit())
  screen.title = title
  fromEvent(screen, 'resize')
    .pipe(debounceTime(500))
    .subscribe(() => {
      addBox('chart')
      addBox('count')
      addBox('display')
      addBox('gauges')
      addBox('highway')
      addBox('log')
      addBox('polarvol')
      addBox('volume')
    })
  updateStore({ drawInterval: interval(50).subscribe(draw) })
  updateStore({
    drawTimeout: setTimeout(() => {
      store.drawInterval.unsubscribe()
      store.drawInterval = interval(200).subscribe(draw)
    }, 900000)
  })
  updateStore({ message: `${title} ${chalk.gray('|')} ${chalk.cyan('n')}/${chalk.cyan('m')} cycle charts - ${chalk.cyan('q')}uit  ` })
  interval(2000).subscribe(() => {
    updateStore({ rotationVolume: store.rotationVolume.map(index => (index + 1 === 3 ? 0 : index + 1)) })
  })
  draw()
}

const log = message => {
  const { colors } = store
  updateStore({ message: `${message} ${chalk[colors.log.date](format(new Date(), 'HH:mm:ss'))}  ` })
}

const play = sound => {
  exec((process.platform === 'win32' ? PLAY_WINDOWS : PLAY_MAC).replace('<SOUND>', sound))
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
  const { initialized } = store
  Object.keys(updates).forEach(key => {
    if (initialized) {
      switch (key) {
        case 'charts': {
          const { currentChart } = store
          !currentChart && updateStore({ currentChart: updates[key][0] })
          store.charts = updates[key]
          break
        }
        case 'message': {
          const { messages } = store
          store.messages = [...messages, updates[key]]
          break
        }
        case 'trade': {
          const { candles, charts, colors, directionColor, trade, trades } = store
          const { m: marketMaker, p: price, q: quantity, T: tradeTime } = updates[key]
          const newTrade = { marketMaker, price: parseFloat(price), quantity: parseFloat(quantity), tradeTime }
          newTrade.level = calculateLevel(newTrade.price)
          const date = new Date(newTrade.tradeTime)
          const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
          const prefix = `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}-${`${date.getUTCDate()}`.padStart(2, '0')}`
          TIMEFRAMES.forEach((timeframe, index) => {
            const candleId = `${prefix}-${Math.floor(minutes / timeframe)}`
            if (!candles[timeframe][candleId]) {
              candles[timeframe][candleId] = { buy: 0, count: 0, sell: 0, volume: 0 }
              const candleIds = Object.keys(candles[timeframe]).sort()
              if (candleIds.length > CANDLES_LENGTH[index]) {
                do {
                  delete candles[timeframe][candleIds[0]]
                  candleIds.shift()
                } while (candleIds.length > CANDLES_LENGTH[index])
                analyze(timeframe)
              } else if (candleIds.length === 2 && !charts.includes(timeframe)) {
                updateStore({
                  charts: TIMEFRAMES.reduce((charts, tf) => {
                    if (store.charts.includes(tf) || tf === timeframe) {
                      charts.push(tf)
                    }
                    return charts
                  }, [])
                })
              }
            }
            candles[timeframe][candleId].close = newTrade.price
            candles[timeframe][candleId].count++
            candles[timeframe][candleId].volume += newTrade.quantity
            candles[timeframe][candleId][marketMaker ? 'buy' : 'sell'] += newTrade.quantity
          })
          trades.unshift(newTrade)
          const maxWindow = Math.max(...GAUGES)
          if (trades.length > maxWindow) {
            do {
              trades.pop()
            } while (trades.length > maxWindow)
          }
          updateStore({ directionColor: newTrade.price > trade?.price ? colors.display.priceUp : newTrade.price < trade?.price ? colors.display.priceDown : directionColor ?? 'gray' })
          store.trade = newTrade
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
        candles: TIMEFRAMES.reduce((candles, timeframe) => {
          candles[timeframe] = {}
          return candles
        }, {}),
        charts: [],
        chartsActive: [],
        colors: {
          chart: {
            background: 'yellow',
            label: 'gray',
            line: asciichart.darkgray
          },
          count: {
            background: 'green',
            label: 'gray',
            line: asciichart.darkgray
          },
          display: {
            background: 'black',
            pair: process.platform === 'win32' ? 'gray' : 'yellow',
            pairActive: 'white',
            priceDown: 'red',
            priceUp: 'green'
          },
          gauges: {
            background: 'black',
            buy: 'cyan',
            sell: 'magenta'
          },
          highway: {
            background: 'black',
            down: 'red',
            up: 'green'
          },
          log: {
            background: 'blue',
            date: 'black',
            foreground: 'white'
          },
          polarvol: {
            background: 'red',
            label: 'black',
            line: asciichart.default
          },
          volume: {
            background: 'white',
            buy: asciichart.cyan,
            label: 'gray',
            line: asciichart.darkgray,
            sell: asciichart.magenta
          }
        },
        currency: new Intl.NumberFormat('en-US', {
          currency: 'USD',
          minimumFractionDigits: 2,
          style: 'currency'
        }),
        deltas: [],
        initialized: true,
        messages: [],
        pair,
        rotationVolume: [0, 1, 2],
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
