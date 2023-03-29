#!/usr/bin/env node
/**
 * Copyright (c) 2023, Luciano Ropero <lropero@gmail.com>
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import _ from 'lodash'
import asciichart from 'asciichart'
import blessed from 'blessed'
import cfonts from 'cfonts'
import chalk from 'chalk'
import figures from 'figures'
import jsonfile from 'jsonfile'
import stripAnsi from 'strip-ansi'
import WebSocket from 'ws'
import { exec } from 'child_process'
import { format } from 'date-fns'
import { program } from 'commander'

const BINANCE = 'wss://fstream.binance.com/ws'
const PLAY = { darwin: 'afplay <SOUND>', win32: '"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" --intf=null --play-and-exit <SOUND>' }

const store = {}

const addBox = type => {
  switch (type) {
    case 'chart': {
      const { screen } = store
      const box = blessed.box({ height: screen.height - 26, style: { bg: 'yellow' }, top: 5, width: screen.width })
      const title = blessed.box({ content: 'Chart', height: 1, right: 0, parent: screen, style: { bg: 'yellow' }, top: 0, width: 5 })
      box.append(title)
      append({ box, type })
      break
    }
    case 'display': {
      const { symbol } = store
      const priceBox = blessed.box({ height: 2, left: symbol.length * 4 + 1, style: { bg: 'black' }, top: 0 })
      const symbolBox = blessed.box({ height: 2, style: { bg: 'black' }, top: 0 })
      append({ box: symbolBox, type: 'symbol' })
      append({ box: priceBox, type: 'price' })
      break
    }
    case 'info': {
      const { screen } = store
      const box = blessed.box({ height: 3, style: { bg: 'black' }, top: 2, width: screen.width })
      append({ box, type })
      break
    }
    case 'polarvol': {
      const { screen } = store
      const box = blessed.box({ bottom: 0, height: 5, style: { bg: 'red' }, width: screen.width })
      const title = blessed.box({ content: 'Polarvol', height: 1, right: 0, parent: screen, style: { bg: 'red' }, top: 0, width: 8 })
      box.append(title)
      append({ box, type })
      break
    }
    case 'tick': {
      const { screen } = store
      const box = blessed.box({ bottom: 5, height: 8, style: { bg: 'black' }, width: screen.width })
      const title = blessed.box({ content: 'Tick', height: 1, right: 0, parent: screen, style: { bg: 'black' }, top: 0, width: 4 })
      box.append(title)
      append({ box, type })
      break
    }
    case 'volume': {
      const { screen } = store
      const box = blessed.box({ bottom: 13, height: 8, style: { bg: 'blue' }, width: screen.width })
      const title = blessed.box({ content: 'Volume', height: 1, right: 0, parent: screen, style: { bg: 'blue' }, top: 0, width: 6 })
      box.append(title)
      append({ box, type })
      break
    }
  }
}

const analyze = () => {
  const { candles } = store
  const values = Object.values(candles).slice(0, -1)
  const diffs = values.map(candle => (candle.volumeBuy / candle.tickBuy - candle.volumeSell / candle.tickSell) * (candle.tickBuy + candle.tickSell))
  const max = Math.max(...diffs.map(diff => Math.abs(diff)))
  if (max > 0) {
    const polarvol = diffs.map(diff => diff / max)
    if (Math.abs(polarvol[polarvol.length - 1]) >= 0.95) {
      log({ message: `${polarvol[polarvol.length - 1] > 0 ? chalk.green('⬆') : chalk.red('⬇')} ${Math.round(diffs[diffs.length - 1] * 100) / 100}`, type: 'info' })
      play('signal')
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

const connect = () => {
  const { symbol, timers, webSocket } = store
  timers.list && clearInterval(timers.list)
  webSocket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`${symbol.toLowerCase()}@aggTrade`] }))
  log({ message: 'socket connected', type: 'success' })
  timers.list = setInterval(() => {
    const { webSocket } = store
    webSocket.send(JSON.stringify({ id: 1337, method: 'LIST_SUBSCRIPTIONS' }))
  }, 25000)
  resetWatchdog()
}

const createWebSocket = () =>
  new Promise((resolve, reject) => {
    const webSocket = new WebSocket(BINANCE)
    webSocket.on('error', error => reject(error))
    webSocket.on('message', message => {
      const { e, ...rest } = JSON.parse(message)
      switch (e) {
        case 'aggTrade': {
          updateStore({ trade: rest })
          break
        }
        default: {
          if (rest.id === 1337 && rest.result.length === 1) {
            resetWatchdog()
          }
        }
      }
    })
    webSocket.on('open', () => resolve(webSocket))
  })

const draw = () => {
  const { boxes, buffer, candles, currency, directionColor, lastTrade, messages, rotation, screen, symbol } = store
  if (lastTrade) {
    const symbolRender = cfonts.render(symbol, { colors: [candles.length >= buffer ? 'yellow' : 'white'], font: 'tiny', space: false })
    boxes.symbol.setContent(symbolRender.string)
    const priceRender = cfonts.render(currency.format(lastTrade.price), { colors: [directionColor], font: 'tiny', space: false })
    boxes.price.setContent(priceRender.string)
  }
  boxes.info.setContent(messages.map(message => ` ${message}`).join('\n'))
  const values = Object.values(candles).slice(-(screen.width - 11))
  if (values.length > 2) {
    if (screen.height - 26 > 0) {
      const close = values.map(candle => candle.close)
      boxes.chart.setContent(asciichart.plot(close, { colors: [asciichart.black], format: close => chalk.black(close.toFixed(2).padStart(9)), height: screen.height - 27 }))
    } else {
      boxes.chart.setContent('')
    }
    if (screen.height - 18 > 0) {
      const colors = [asciichart.white, asciichart.green, asciichart.red]
      const volume = values.map(candle => candle.volumeBuy + candle.volumeSell)
      const volumeBuy = values.map(candle => candle.volumeBuy)
      const volumeSell = values.map(candle => candle.volumeSell)
      const series = [volume, volumeBuy, volumeSell]
      boxes.volume.setContent(asciichart.plot([series[rotation[0]], series[rotation[1]], series[rotation[2]]], { colors: [colors[rotation[0]], colors[rotation[1]], colors[rotation[2]]], format: volume => chalk.white(volume.toFixed(2).padStart(9)), height: 7 }))
    } else {
      boxes.volume.setContent('')
    }
    if (screen.height - 10 > 0) {
      const colors = [asciichart.yellow, asciichart.cyan, asciichart.magenta]
      const tick = values.map(candle => candle.tickBuy + candle.tickSell)
      const tickBuy = values.map(candle => candle.tickBuy)
      const tickSell = values.map(candle => candle.tickSell)
      const series = [tick, tickBuy, tickSell]
      boxes.tick.setContent(asciichart.plot([series[rotation[0]], series[rotation[1]], series[rotation[2]]], { colors: [colors[rotation[0]], colors[rotation[1]], colors[rotation[2]]], format: tick => chalk.yellow(tick.toFixed(2).padStart(9)), height: 7 }))
    } else {
      boxes.tick.setContent('')
    }
    if (screen.height - 5 > 0) {
      const diffs = values.map(candle => (candle.volumeBuy / candle.tickBuy - candle.volumeSell / candle.tickSell) * (candle.tickBuy + candle.tickSell))
      const max = Math.max(...diffs.map(diff => Math.abs(diff)))
      if (max > 0) {
        const polarvol = diffs.map(diff => diff / max)
        boxes.polarvol.setContent(asciichart.plot(polarvol, { colors: [asciichart.white], format: polarvol => chalk.black(polarvol.toFixed(2).padStart(9)), height: 4 }))
      }
    } else {
      boxes.polarvol.setContent('')
    }
  }
  screen.render()
}

const log = ({ message, type = '' }) => {
  updateStore({ message: `${logType(type)}${type !== '' ? `${chalk.white(format(new Date(), 'EEE dd/MM HH:mm:ss'))} ` : ''}${message}` })
}

const logType = type => {
  switch (type) {
    case 'error':
      return `${chalk.red(figures.cross)} `
    case 'info':
      return `${chalk.blue(figures.bullet)} `
    case 'success':
      return `${chalk.green(figures.tick)} `
    case 'warning':
      return `${chalk.yellow(figures.warning)} `
    default:
      return ''
  }
}

const play = sound => {
  PLAY[process.platform] && exec(PLAY[process.platform].replace('<SOUND>', `mp3/${sound}.mp3`))
}

const resetWatchdog = () => {
  const { timers } = store
  timers.reconnect && clearTimeout(timers.reconnect)
  timers.reconnect = setTimeout(async () => {
    log({ message: 'disconnected, attempting to reconnect...', type: 'warning' })
    try {
      const webSocket = await createWebSocket()
      updateStore({ webSocket })
    } catch (error) {
      resetWatchdog()
    }
  }, 60000)
}

const rotateVolume = () => {
  const { rotation } = store
  updateStore({ rotation: rotation.map(index => (index + 1 === rotation.length ? 0 : index + 1)) })
}

const setAlert = () => {
  const { header, screen } = store
  const left = stripAnsi(header).length + 2
  const $ = blessed.box({ content: '$', height: 1, left, parent: screen, style: { bg: 'blue' }, top: 2, width: 1 })
  const input = blessed.textbox({ height: 1, inputOnFocus: true, left: left + 1, parent: screen, style: { bg: 'blue' }, top: 2, width: 11 })
  input.on('cancel', () => {
    $.destroy()
    input.destroy()
  })
  input.on('submit', () => {
    const alert = parseFloat(input.getValue().replace(',', '.'))
    updateStore({ alert: alert > 0 ? alert : 0 })
    $.destroy()
    input.destroy()
  })
  input.focus()
}

const start = title => {
  const { screen } = store
  addBox('chart')
  addBox('volume')
  addBox('tick')
  addBox('polarvol')
  addBox('info')
  addBox('display')
  screen.key('a', setAlert)
  screen.key('q', process.exit)
  screen.on(
    'resize',
    _.debounce(() => {
      addBox('chart')
      addBox('volume')
      addBox('tick')
      addBox('polarvol')
      addBox('info')
      addBox('display')
    }, 500)
  )
  screen.title = title
  updateStore({ initialized: true })
  connect()
  setInterval(draw, 50)
  setInterval(rotateVolume, 2000)
}

const updateStore = updates => {
  const { initialized } = store
  Object.keys(updates).forEach(key => {
    if (!initialized) {
      store[key] = updates[key]
    } else {
      switch (key) {
        case 'alert': {
          const { currency, header, lastTrade } = store
          if (lastTrade) {
            const alert = updates[key]
            if (alert > 0) {
              store.alert = alert
              store.messages[0] = `${header} ${chalk[alert > lastTrade.price ? 'cyan' : 'magenta'](currency.format(updates[key]))}`
            } else {
              delete store.alert
              store.messages[0] = `${header}`
            }
          }
          break
        }
        case 'message': {
          const { messages } = store
          store.messages = [messages[0], updates[key], ...messages.slice(1, 100)]
          break
        }
        case 'trade': {
          const { alert, buffer, candles, currency, directionColor, lastTrade, size } = store
          const { m: marketMaker, p: price, q: quantity, T: tradeTime } = updates[key]
          const trade = { marketMaker, price: parseFloat(price), quantity: parseFloat(quantity), tradeTime }
          if (alert && lastTrade) {
            if (lastTrade.price < alert && trade.price >= alert) {
              log({ message: chalk.green(currency.format(alert)), type: 'info' })
              play('up')
              updateStore({ alert: 0 })
            } else if (lastTrade.price > alert && trade.price <= alert) {
              log({ message: chalk.red(currency.format(alert)), type: 'info' })
              play('down')
              updateStore({ alert: 0 })
            }
          }
          const id = Math.floor(trade.tradeTime / size)
          if (!candles[id]) {
            candles[id] = { tickBuy: 0, tickSell: 0, time: id * size, volumeBuy: 0, volumeSell: 0 }
            const ids = Object.keys(candles).sort()
            if (ids.length > buffer) {
              do {
                delete candles[ids[0]]
                ids.shift()
              } while (ids.length > buffer)
              analyze()
            }
          }
          candles[id].close = trade.price
          candles[id].tickBuy += !trade.marketMaker ? 1 : 0
          candles[id].tickSell += trade.marketMaker ? 1 : 0
          candles[id].volumeBuy += !trade.marketMaker ? trade.quantity : 0
          candles[id].volumeSell += trade.marketMaker ? trade.quantity : 0
          updateStore({ directionColor: trade.price > lastTrade?.price ? 'green' : trade.price < lastTrade?.price ? 'red' : directionColor ?? 'white', lastTrade: trade })
          break
        }
        case 'webSocket': {
          const { webSocket } = store
          webSocket && webSocket.terminate()
          store.webSocket = updates[key]
          connect()
          break
        }
        default: {
          store[key] = updates[key]
        }
      }
    }
  })
}

program
  .argument('<symbol>', 'symbol')
  .option('-s, --size <seconds>', 'candle size in seconds (defaults to 60)')
  .action(async (symbol, options) => {
    try {
      const { description, name, version } = await jsonfile.readFile('./package.json')
      const currency = new Intl.NumberFormat('en-US', { currency: 'USD', minimumFractionDigits: 2, style: 'currency' })
      const screen = blessed.screen({ forceUnicode: true, fullUnicode: true, smartCSR: true })
      const size = parseInt(options.size ?? 60, 10) > 0 ? parseInt(options.size ?? 60, 10) : 60
      const header = chalk.white(`${chalk.green(description.replace('.', ''))} v${version} - ${chalk.cyan('a')}lert ${chalk.cyan('q')}uit ${chalk.yellow(`${size}s`)}`)
      const webSocket = await createWebSocket()
      updateStore({ boxes: {}, buffer: Math.ceil(86400 / size), candles: {}, currency, header, messages: [header], rotation: [0, 1, 2], screen, size: size * 1000, symbol, timers: {}, webSocket })
      start(`${name.charAt(0).toUpperCase()}${name.slice(1)} v${version}`)
    } catch (error) {
      log({ message: error.toString(), type: 'error' })
      process.exit()
    }
  })
  .parse(process.argv)
