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
  const { buffer, candles, dark, screen, symbol, threshold, timers } = store
  switch (type) {
    case 'chart': {
      const box = blessed.box({ height: screen.height - 26, style: { bg: dark ? 'black' : 'yellow' }, top: 5, width: screen.width })
      const title = blessed.box({ content: 'Chart', height: 1, right: 0, style: { bg: dark ? 'black' : 'yellow', fg: dark ? 'yellow' : 'white' }, width: 5 })
      box.append(title)
      append({ box, type })
      break
    }
    case 'disconnected': {
      const box = blessed.box({ content: 'disconnected, attempting to reconnect...', height: 1, left: Math.round(screen.width / 2) - 20, style: { bg: 'red' }, top: 3, width: 40 })
      append({ box, type })
      break
    }
    case 'display': {
      const priceBox = blessed.box({ height: 2, left: symbol.length * 4 + 1, style: { bg: dark ? 'blue' : 'black' } })
      const symbolBox = blessed.box({ height: 2, style: { bg: dark ? 'blue' : 'black' } })
      append({ box: symbolBox, type: 'symbol' })
      append({ box: priceBox, type: 'price' })
      break
    }
    case 'info': {
      const box = blessed.box({ height: 3, style: { bg: dark ? 'blue' : 'black' }, top: 2, width: screen.width })
      append({ box, type })
      break
    }
    case 'polarvol': {
      const box = blessed.box({ bottom: 0, height: 5, style: { bg: dark ? 'black' : 'red' }, width: screen.width })
      const content = `Polarvol ${threshold}`
      const title = blessed.box({ content, height: 1, right: 0, style: { bg: dark ? 'black' : 'red', fg: dark ? 'yellow' : 'white' }, width: content.length })
      box.append(title)
      append({ box, type })
      break
    }
    case 'tick': {
      const box = blessed.box({ bottom: 5, height: 8, style: { bg: 'black' }, width: screen.width })
      const title = blessed.box({ content: 'Tick', height: 1, right: 0, style: { bg: 'black', fg: dark ? 'yellow' : 'white' }, width: 4 })
      box.append(title)
      append({ box, type })
      break
    }
    case 'unready': {
      timers.unready && clearTimeout(timers.unready)
      const amount = buffer - Object.keys(candles).length
      const content = `Polarvol signal unready, awaiting ${amount} new candle${amount > 1 ? 's' : ''}`
      const box = blessed.box({ content, height: 1, left: Math.round((screen.width - content.length) / 2), style: { bg: 'red' }, top: 3, width: content.length })
      append({ box, type })
      timers.unready = setTimeout(() => {
        const { boxes } = store
        if (boxes.unready) {
          screen.remove(boxes.unready)
          delete boxes.unready
        }
      }, 3000)
      break
    }
    case 'volume': {
      const box = blessed.box({ bottom: 13, height: 8, style: { bg: dark ? 'black' : 'blue' }, width: screen.width })
      const title = blessed.box({ content: 'Volume', height: 1, right: 0, style: { bg: dark ? 'black' : 'blue', fg: dark ? 'yellow' : 'white' }, width: 6 })
      box.append(title)
      append({ box, type })
      break
    }
  }
}

const addBoxes = () => {
  const { boxes } = store
  const types = ['chart', 'volume', 'tick', 'polarvol', 'info', 'display']
  types.forEach(type => addBox(type))
  boxes.disconnected && addBox('disconnected')
}

const analyze = () => {
  const { candles, threshold } = store
  const values = Object.values(candles).slice(0, -1)
  const diffs = values.map(candle => (candle.volumeBuy - candle.volumeSell) * (candle.tickBuy + candle.tickSell))
  const max = Math.max(...diffs.map(diff => Math.abs(diff)))
  if (max > 0) {
    const polarvol = diffs.map(diff => diff / max)
    if (Math.abs(polarvol[polarvol.length - 1]) >= threshold) {
      log(`${polarvol[polarvol.length - 1] > 0 ? chalk.green('⬆') : chalk.red('⬇')} ${Math.round(polarvol[polarvol.length - 1] * 100) / 100}`)
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

const clear = () => {
  const { messages } = store
  store.messages = [messages[0]]
}

const connect = () => {
  const { symbol, timers, webSocket } = store
  timers.list && clearInterval(timers.list)
  webSocket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`${symbol.toLowerCase()}@aggTrade`] }))
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
  const { boxes, buffer, candles, currency, dark, directionColor, lastTrade, messages, rotation, screen, symbol } = store
  const values = Object.values(candles)
  if (lastTrade) {
    const symbolRender = cfonts.render(symbol, { colors: [values.length >= buffer ? 'yellow' : 'white'], font: 'tiny', space: false })
    boxes.symbol.setContent(symbolRender.string)
    const priceRender = cfonts.render(currency.format(lastTrade.price), { colors: [directionColor], font: 'tiny', space: false })
    boxes.price.setContent(priceRender.string)
  }
  boxes.info.setContent(messages.map(message => ` ${message}`).join('\n'))
  const slice = values.slice(-(screen.width - 11))
  if (slice.length > 2) {
    if (screen.height - 26 > 0) {
      const close = slice.map(candle => candle.close)
      boxes.chart.setContent(asciichart.plot(close, { colors: [asciichart[dark ? 'yellow' : 'black']], format: close => chalk[dark ? 'yellow' : 'black'](close.toFixed(2).padStart(9)), height: screen.height - 27 }))
    } else {
      boxes.chart.setContent('')
    }
    if (screen.height - 18 > 0) {
      const colors = [asciichart.white, asciichart.green, asciichart.red]
      const volume = slice.map(candle => candle.volumeBuy + candle.volumeSell)
      const volumeBuy = slice.map(candle => candle.volumeBuy)
      const volumeSell = slice.map(candle => candle.volumeSell)
      const series = [volume, volumeBuy, volumeSell]
      boxes.volume.setContent(asciichart.plot([series[rotation[0]], series[rotation[1]], series[rotation[2]]], { colors: [colors[rotation[0]], colors[rotation[1]], colors[rotation[2]]], format: volume => chalk[dark ? 'blue' : 'white'](volume.toFixed(2).padStart(9)), height: 7 }))
    } else {
      boxes.volume.setContent('')
    }
    if (screen.height - 10 > 0) {
      const colors = [asciichart.yellow, asciichart.cyan, asciichart.magenta]
      const tick = slice.map(candle => candle.tickBuy + candle.tickSell)
      const tickBuy = slice.map(candle => candle.tickBuy)
      const tickSell = slice.map(candle => candle.tickSell)
      const series = [tick, tickBuy, tickSell]
      boxes.tick.setContent(asciichart.plot([series[rotation[0]], series[rotation[1]], series[rotation[2]]], { colors: [colors[rotation[0]], colors[rotation[1]], colors[rotation[2]]], format: tick => chalk[dark ? 'white' : 'yellow'](tick.toFixed(2).padStart(9)), height: 7 }))
    } else {
      boxes.tick.setContent('')
    }
    if (screen.height - 5 > 0) {
      const diffs = slice.map(candle => (candle.volumeBuy - candle.volumeSell) * (candle.tickBuy + candle.tickSell))
      const max = Math.max(...diffs.map(diff => Math.abs(diff)))
      if (max > 0) {
        const polarvol = diffs.map(diff => diff / max)
        boxes.polarvol.setContent(asciichart.plot(polarvol, { colors: [asciichart.white], format: polarvol => chalk[dark ? 'red' : 'black'](polarvol.toFixed(2).padStart(9)), height: 4 }))
      }
    } else {
      boxes.polarvol.setContent('')
    }
  }
  screen.render()
}

const log = message => {
  updateStore({ message: `${chalk.magenta(figures.bullet)} ${chalk.white(format(new Date(), 'EEE dd/MM HH:mm:ss'))} ${message}` })
}

const moveThreshold = direction => {
  const { buffer, candles, threshold } = store
  let newThreshold = threshold + 0.1 * (direction === 'up' ? 1 : -1)
  if (newThreshold > 1) {
    newThreshold = 1
  } else if (newThreshold < 0.5) {
    newThreshold = 0.5
  }
  updateStore({ threshold: Math.round(newThreshold * 10) / 10 })
  addBoxes()
  if (Object.keys(candles).length < buffer) {
    addBox('unready')
  }
}

const play = sound => {
  PLAY[process.platform] && exec(PLAY[process.platform].replace('<SOUND>', `mp3/${sound}.mp3`))
}

const resetWatchdog = () => {
  const { timers } = store
  timers.reconnect && clearTimeout(timers.reconnect)
  timers.reconnect = setTimeout(async () => {
    addBox('disconnected')
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
  const { boxes, dark, header } = store
  const left = stripAnsi(header).length + 2
  const $ = blessed.box({ content: '$', height: 1, left, parent: boxes.info, style: { bg: dark ? 'black' : 'blue' }, width: 1 })
  const input = blessed.textbox({ height: 1, inputOnFocus: true, left: left + 1, parent: boxes.info, style: { bg: dark ? 'black' : 'blue' }, width: 11 })
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
  addBoxes()
  screen.key('a', setAlert)
  screen.key('c', clear)
  screen.key('d', toggleDark)
  screen.key('down', () => moveThreshold('down'))
  screen.key('q', process.exit)
  screen.key('up', () => moveThreshold('up'))
  screen.on('resize', _.debounce(addBoxes, 500))
  screen.title = title
  updateStore({ initialized: true })
  connect()
  setInterval(draw, 50)
  setInterval(rotateVolume, 2000)
}

const toggleDark = () => {
  const { dark } = store
  updateStore({ dark: !dark })
  addBoxes()
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
          const { alert, boxes, buffer, candles, currency, directionColor, lastTrade, screen, size } = store
          const { m: marketMaker, p: price, q: quantity, T: tradeTime } = updates[key]
          const trade = { marketMaker, price: parseFloat(price), quantity: parseFloat(quantity), tradeTime }
          if (boxes.disconnected) {
            screen.remove(boxes.disconnected)
            delete boxes.disconnected
          }
          if (alert && lastTrade) {
            if (lastTrade.price < alert && trade.price >= alert) {
              log(chalk.green(currency.format(alert)))
              play('up')
              updateStore({ alert: 0 })
            } else if (lastTrade.price > alert && trade.price <= alert) {
              log(chalk.red(currency.format(alert)))
              play('down')
              updateStore({ alert: 0 })
            }
          }
          const id = Math.floor(trade.tradeTime / size)
          if (!candles[id]) {
            candles[id] = { tickBuy: 0, tickSell: 0, time: id * size, volumeBuy: 0, volumeSell: 0 }
            const ids = Object.keys(candles).sort()
            if (ids.length > buffer) {
              analyze()
              do {
                delete candles[ids[0]]
                ids.shift()
              } while (ids.length > buffer)
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
      const header = chalk.white(`${chalk.green(description.replace('.', ''))} v${version} - ${chalk.cyan('a')}lert ${chalk.cyan('c')}lear ${chalk.cyan('d')}ark ${chalk.cyan(figures.arrowUp)}${chalk.gray('/')}${chalk.cyan(figures.arrowDown)}(signal threshold) ${chalk.cyan('q')}uit ${chalk.yellow(`${size}s`)}`)
      const webSocket = await createWebSocket()
      updateStore({ boxes: {}, buffer: Math.ceil(86400 / size), candles: {}, currency, dark: false, header, messages: [header], rotation: [0, 1, 2], screen, size: size * 1000, symbol, threshold: 1, timers: {}, webSocket })
      start(`${name.charAt(0).toUpperCase()}${name.slice(1)} v${version}`)
    } catch (error) {
      console.log(error.toString())
      process.exit()
    }
  })
  .parse(process.argv)
