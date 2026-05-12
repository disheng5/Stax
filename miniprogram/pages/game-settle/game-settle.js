// pages/game-settle/game-settle.js — 结算页
const { settle } = require('../../utils/settle.js')
const { formatDateTime } = require('../../utils/format.js')

Page({
  data: {
    gameId: '',
    game: null,
    finalStacks: {},
    transfers: [],
    diff: 0,
    submitted: false,
    submitting: false,
    canSubmit: false,
    playerProfits: []        // 显示用：附 profit 的玩家列表
  },

  async onLoad(options) {
    this.setData({ gameId: options.id })
    await this._loadGame()
  },

  async _loadGame() {
    wx.showLoading({ title: '加载中…' })
    try {
      const db = wx.cloud.database()
      const got = await db.collection('games').doc(this.data.gameId).get()
      const game = got.data
      // 默认 finalStack 用 currentStack（庄家 review 后输入实际值）
      const finalStacks = {}
      ;(game.players || []).forEach(p => {
        finalStacks[p.openid] = p.eliminatedAt ? 0 : (p.currentStack || 0)
      })
      this.setData({ game, finalStacks })
      this._recompute()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
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
      const finalStack = Number(this.data.finalStacks[p.openid]) || 0
      return { ...p, finalStack, profit: finalStack - p.totalBuyIn }
    })
    const diff = players.reduce((s, p) => s + p.profit, 0)
    const transfers = diff === 0 ? settle(players) : []
    this.setData({
      playerProfits: players,
      transfers,
      diff,
      canSubmit: diff === 0
    })
  },

  async onSubmit() {
    if (!this.data.canSubmit) {
      wx.showToast({ title: `Σ profit = ${this.data.diff}，请检查`, icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '结算中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'settleGame',
        data: { gameId: this.data.gameId, finalStacks: this.data.finalStacks }
      })
      wx.hideLoading()
      const { ok, error } = res.result || {}
      if (!ok) {
        wx.showToast({ title: error || '结算失败', icon: 'none' })
        return
      }
      this.setData({ submitted: true })
      wx.showToast({ title: '结算完成', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  // ===== 生成结算图（Canvas 2d） =====
  async onSaveImage() {
    if (!this.data.canSubmit) {
      wx.showToast({ title: '需 Σ profit = 0 才能出图', icon: 'none' }); return
    }
    wx.showLoading({ title: '生成中…' })
    const query = wx.createSelectorQuery()
    query.select('#settle-canvas')
      .fields({ node: true, size: true })
      .exec(async res => {
        try {
          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          const dpr = wx.getSystemInfoSync().pixelRatio || 2
          const W = 360, H = 540
          canvas.width = W * dpr
          canvas.height = H * dpr
          ctx.scale(dpr, dpr)
          this._draw(ctx, W, H)
          await new Promise(r => setTimeout(r, 50))
          const file = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 })
          await wx.saveImageToPhotosAlbum({ filePath: file.tempFilePath })
          wx.hideLoading()
          wx.showToast({ title: '已保存到相册' })
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '保存失败，检查相册权限', icon: 'none' })
        }
      })
  },

  _draw(ctx, W, H) {
    // 背景
    ctx.fillStyle = '#F5F2EA'
    ctx.fillRect(0, 0, W, H)

    // 顶部牌桌绿条
    ctx.fillStyle = '#0B6E4F'
    ctx.fillRect(0, 0, W, 80)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText('Stax · 长河筹略', 20, 35)
    ctx.font = '14px sans-serif'
    ctx.fillText(this.data.game.name || '牌局结算', 20, 60)

    // 时间
    ctx.fillStyle = '#666'
    ctx.font = '11px sans-serif'
    ctx.fillText(formatDateTime(new Date()), 20, 100)

    // 玩家列表
    let y = 130
    ctx.font = 'bold 14px sans-serif'
    ctx.fillStyle = '#1A1A1A'
    ctx.fillText('玩家盈亏', 20, y)
    y += 16
    ctx.font = '12px sans-serif'
    this.data.playerProfits.forEach(p => {
      ctx.fillStyle = '#1A1A1A'
      ctx.fillText(p.nickname || '玩家', 20, y)
      ctx.fillStyle = '#666'
      ctx.fillText(`买入 ${p.totalBuyIn}`, 130, y)
      ctx.fillStyle = p.profit >= 0 ? '#0B6E4F' : '#C8102E'
      const txt = (p.profit > 0 ? '+' : '') + p.profit
      ctx.fillText(txt, 280, y)
      y += 22
    })

    // 清算建议
    y += 12
    ctx.fillStyle = '#1A1A1A'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText('清算建议', 20, y)
    y += 18
    ctx.font = '12px sans-serif'
    if (!this.data.transfers.length) {
      ctx.fillStyle = '#666'
      ctx.fillText('无需转账', 20, y)
    } else {
      this.data.transfers.forEach(t => {
        ctx.fillStyle = '#1A1A1A'
        ctx.fillText(`${t.from}  →  ${t.to}`, 20, y)
        ctx.fillStyle = '#C9A961'
        ctx.fillText(String(t.amount), 280, y)
        y += 20
      })
    }

    // 页脚
    ctx.fillStyle = '#999'
    ctx.font = '10px sans-serif'
    ctx.fillText("Hold'em, held right.  ·  Stax", 20, H - 20)
  }
})
