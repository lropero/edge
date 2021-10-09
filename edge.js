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
import chalk from 'chalk'
import figures from 'figures'
import jsonfile from 'jsonfile'
import stripAnsi from 'strip-ansi'
import { debounceTime } from 'rxjs/operators'
import { format } from 'date-fns'
import { fromEvent } from 'rxjs'
import { program } from 'commander'

const store = {}

const addBox = type => {
  const { colors } = store
  switch (type) {
    case 'header': {
      const header = blessed.box({
        height: 'shrink',
        style: { bg: colors.header.background },
        width: '100%'
      })
      append({ box: header, type })
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

const draw = () => {
  const { boxes, colors, currency, pair, price, screen, title } = store
  const left = ` ${chalk[colors.header.foreground](title)}  ${chalk[colors.header.info](`${pair} ${price ? currency.format(price) : 'Connecting...'}`)}`
  const right = `${chalk[colors.header.key]('q')}${chalk[colors.header.foreground]('uit')}`
  boxes.header.setContent(`${left}${right.padStart(screen.width - stripAnsi(left).length + 19)}`)
  screen.render()
}

const initialize = () => {
  const { screen, title } = store
  addBox('header')
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
      const { p: price } = trade
      updateStore({ price })
    })
  } catch (error) {
    console.log(`${chalk.gray(format(new Date(), 'HH:mm:ss'))} ${chalk.red(figures.cross)} ${error.toString()}`)
    process.exit()
  }
}

const updateStore = updates => {
  const { initialized } = store
  Object.keys(updates).forEach(key => {
    store[key] = updates[key]
    if (initialized) {
      switch (key) {
        case 'price': {
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
        header: {
          background: 'blue',
          foreground: 'white',
          info: 'yellow',
          key: 'green'
        }
      },
      currency: new Intl.NumberFormat('en-US', {
        currency: 'USD',
        minimumFractionDigits: 2,
        style: 'currency'
      }),
      initialized: true,
      pair,
      screen: blessed.screen({
        forceUnicode: true,
        fullUnicode: true,
        smartCSR: true
      }),
      title: `Edge v${version}`
    })
    start()
  })
  .parse(process.argv)
