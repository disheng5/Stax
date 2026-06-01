// pages/learn-odds/learn-odds.js — 概率计算器（蒙特卡洛模拟）
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS = ['♠', '♥', '♦', '♣']
const SIM_COUNT = 10000

function buildDeck(exclude) {
  const deck = []
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = r + s
      if (!exclude.includes(c)) deck.push(c)
    }
  return deck
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function rankValue(r) {
  return RANKS.indexOf(r)
}

function evaluate(cards) {
  const rs = cards.map(c => rankValue(c[0]))
  const ss = cards.map(c => c[c.length - 1])
  const freq = new Array(13).fill(0)
  rs.forEach(r => freq[r]++)
  const groups = []
  for (let i = 12; i >= 0; i--) if (freq[i] > 0) groups.push({ rank: i, count: freq[i] })
  groups.sort((a, b) => b.count - a.count || b.rank - a.rank)
  const suitCount = {}
  ss.forEach(s => {
    suitCount[s] = (suitCount[s] || 0) + 1
  })
  const flushSuit = Object.keys(suitCount).find(s => suitCount[s] >= 5)
  let flushCards = null
  if (flushSuit)
    flushCards = cards
      .filter(c => c[c.length - 1] === flushSuit)
      .map(c => rankValue(c[0]))
      .sort((a, b) => b - a)
      .slice(0, 5)
  const uniqueRanks = [...new Set(rs)].sort((a, b) => b - a)
  let straight = -1
  for (let i = 0; i <= uniqueRanks.length - 5; i++)
    if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) {
      straight = uniqueRanks[i]
      break
    }
  if (
    straight === -1 &&
    uniqueRanks.includes(12) &&
    [0, 1, 2, 3].every(v => uniqueRanks.includes(v))
  )
    straight = 3
  let sf = -1
  if (flushSuit) {
    const fr = cards.filter(c => c[c.length - 1] === flushSuit).map(c => rankValue(c[0]))
    const ufr = [...new Set(fr)].sort((a, b) => b - a)
    for (let i = 0; i <= ufr.length - 5; i++)
      if (ufr[i] - ufr[i + 4] === 4) {
        sf = ufr[i]
        break
      }
    if (sf === -1 && ufr.includes(12) && [0, 1, 2, 3].every(v => ufr.includes(v))) sf = 3
  }
  if (sf >= 0) return [8, sf]
  if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank]
  if (groups[0].count === 3 && groups[1].count >= 2) return [6, groups[0].rank, groups[1].rank]
  if (flushCards) return [5, ...flushCards]
  if (straight >= 0) return [4, straight]
  if (groups[0].count === 3) return [3, groups[0].rank, groups[1].rank, groups[2].rank]
  if (groups[0].count === 2 && groups[1].count === 2)
    return [
      2,
      Math.max(groups[0].rank, groups[1].rank),
      Math.min(groups[0].rank, groups[1].rank),
      groups[2].rank
    ]
  if (groups[0].count === 2)
    return [1, groups[0].rank, groups[1].rank, groups[2].rank, groups[3].rank]
  return [0, groups[0].rank, groups[1].rank, groups[2].rank, groups[3].rank, groups[4].rank]
}

function compareHands(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] > b[i]) return 1
    if (a[i] < b[i]) return -1
  }
  return 0
}

// knownOppCards: 第1位对手的已知手牌 [] 或 [c1, c2]
function simulate(myCards, board, opponents, knownOppCards, count) {
  const hasKnown = knownOppCards && knownOppCards.length === 2
  const known = [...myCards, ...board, ...(hasKnown ? knownOppCards : [])]
  let wins = 0,
    ties = 0,
    losses = 0
  for (let i = 0; i < count; i++) {
    const deck = shuffle(buildDeck(known))
    let idx = 0
    const fullBoard = [...board]
    while (fullBoard.length < 5) fullBoard.push(deck[idx++])
    const oppHands = []
    if (hasKnown) oppHands.push(knownOppCards)
    for (let o = hasKnown ? 1 : 0; o < opponents; o++) oppHands.push([deck[idx++], deck[idx++]])
    const myScore = evaluate([...myCards, ...fullBoard])
    let best = -1
    for (const opp of oppHands) {
      const cmp = compareHands(evaluate([...opp, ...fullBoard]), myScore)
      if (cmp > 0) {
        best = 1
        break
      }
      if (cmp === 0 && best < 0) best = 0
    }
    if (best === 1) losses++
    else if (best === 0) ties++
    else wins++
  }
  return {
    winRate: ((wins / count) * 100).toFixed(1),
    tieRate: ((ties / count) * 100).toFixed(1),
    loseRate: ((losses / count) * 100).toFixed(1)
  }
}

Page({
  data: {
    myCards: ['', ''],
    board: ['', '', '', '', ''],
    oppCards: ['', ''],
    opponents: 1,
    result: null,
    simCount: SIM_COUNT,
    showPicker: false,
    pickerSlot: '',
    pickerIdx: 0,
    ranks: RANKS.slice().reverse(),
    suits: SUITS.map(s => ({ s })),
    canCalc: false,
    usedMap: {}
  },

  onPickCard(e) {
    const { slot, idx } = e.currentTarget.dataset
    this._updateUsedMap()
    this.setData({ showPicker: true, pickerSlot: slot, pickerIdx: Number(idx) })
  },

  onClosePicker() {
    this.setData({ showPicker: false })
  },

  _updateUsedMap() {
    const usedMap = {}
    this.data.myCards.forEach(c => {
      if (c) usedMap[c] = true
    })
    this.data.board.forEach(c => {
      if (c) usedMap[c] = true
    })
    this.data.oppCards.forEach(c => {
      if (c) usedMap[c] = true
    })
    this.setData({ usedMap })
  },

  onSelectCard(e) {
    const card = e.currentTarget.dataset.card
    if (this.data.usedMap[card]) return
    const { pickerSlot, pickerIdx } = this.data
    if (pickerSlot === 'my') {
      const myCards = [...this.data.myCards]
      myCards[pickerIdx] = card
      this.setData({ myCards, showPicker: false })
    } else if (pickerSlot === 'opp') {
      const oppCards = [...this.data.oppCards]
      oppCards[pickerIdx] = card
      this.setData({ oppCards, showPicker: false })
    } else {
      const board = [...this.data.board]
      board[pickerIdx] = card
      this.setData({ board, showPicker: false })
    }
    this._checkCanCalc()
  },

  onClearOppCard(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const oppCards = [...this.data.oppCards]
    oppCards[idx] = ''
    this.setData({ oppCards })
    this._updateUsedMap()
  },

  onOppChange(e) {
    this.setData({ opponents: Number(e.currentTarget.dataset.n) })
  },

  _checkCanCalc() {
    const canCalc = !!(this.data.myCards[0] && this.data.myCards[1])
    this.setData({ canCalc })
  },

  onCalc() {
    if (!this.data.canCalc) return
    wx.showLoading({ title: '模拟中…' })
    const board = this.data.board.filter(c => !!c)
    const opp = this.data.oppCards.filter(c => !!c)
    const knownOppCards = opp.length === 2 ? opp : []
    setTimeout(() => {
      const result = simulate(
        this.data.myCards,
        board,
        this.data.opponents,
        knownOppCards,
        SIM_COUNT
      )
      this.setData({ result })
      wx.hideLoading()
    }, 50)
  },

  onReset() {
    this.setData({
      myCards: ['', ''],
      board: ['', '', '', '', ''],
      oppCards: ['', ''],
      result: null,
      canCalc: false,
      usedMap: {}
    })
  }
})
