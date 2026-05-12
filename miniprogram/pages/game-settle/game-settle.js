// pages/game-settle/game-settle.js — 结算页
const { settle } = require('../../utils/settle.js')

Page({
  data: {
    gameId: '',
    game: null,
    finalStacks: {},   // { openid: number }
    transfers: [],
    diff: 0,
    submitted: false
  },
  onLoad(options) {
    this.setData({ gameId: options.id })
    // TODO: 加载 game
  },
  onStackInput(e) {
    const openid = e.currentTarget.dataset.openid
    const v = Number(e.detail.value) || 0
    this.setData({ [`finalStacks.${openid}`]: v })
    this._recompute()
  },
  _recompute() {
    if (!this.data.game) return
    const players = this.data.game.players.map(p => {
      const finalStack = this.data.finalStacks[p.openid] || 0
      return { ...p, finalStack, profit: finalStack - p.totalBuyIn }
    })
    const diff = players.reduce((s, p) => s + p.profit, 0)
    const transfers = diff === 0 ? settle(players) : []
    this.setData({ transfers, diff })
  },
  async onSubmit() {
    if (this.data.diff !== 0) {
      wx.showToast({ title: `Σ profit = ${this.data.diff}，请检查`, icon: 'none' })
      return
    }
    // TODO: 调 cloudfunction settleGame
    wx.showToast({ title: '骨架阶段，待实现', icon: 'none' })
  },
  onSaveImage() {
    // TODO: Canvas 生成结算图保存到相册
  }
})
