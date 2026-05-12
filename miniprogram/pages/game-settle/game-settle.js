// pages/game-settle/game-settle.js — 结算页（含 AA 分摊）
const { settle } = require('../../utils/settle.js')
const { aaEven, aaWinnerByRatio, applyShares } = require('../../utils/aa.js')
const { formatDateTime } = require('../../utils/format.js')

Page({
  data: {
    gameId: '',
    game: null,
    finalStacks: {},
    transfers: [],
    diff: 0,
    canSubmit: false,
    submitting: false,
    submitted: false,
    playerProfits: [],         // [{ ...player, profit, share, finalProfit }]

    // AA 分摊
    extraCost: 0,
    aaMode: 'none',            // 'none' | 'even' | 'winnerByRatio'
    shares: []
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
      const finalStacks = {}
      ;(game.players || []).forEach(p => {
        finalStacks[p.openid] = p.eliminatedAt ? 0 : (p.currentStack || 0)
      })
      this.setData({ game, finalStacks })
      this._recompute()
    } catch (err) {
      console.error(err); wx.showToast({ title: '加载失败', icon: 'none' })
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

  onExtraCostInput(e) {
    this.setData({ extraCost: Number(e.detail.value) || 0 })
    this._recompute()
  },

  onAaModeChange(e) {
    this.setData({ aaMode: e.currentTarget.dataset.k })
    this._recompute()
  },

  _recompute() {
    if (!this.data.game) return
    let players = this.data.game.players.map(p => {
      const finalStack = Number(this.data.finalStacks[p.openid]) || 0
      return { ...p, finalStack, profit: finalStack - p.totalBuyIn }
    })
    const diff = players.reduce((s, p) => s + p.profit, 0)
    let shares = []
    if (this.data.aaMode === 'even' && this.data.extraCost > 0) {
      shares = aaEven(players, this.data.extraCost)
    } else if (this.data.aaMode === 'winnerByRatio' && this.data.extraCost > 0) {
      shares = aaWinnerByRatio(players, this.data.extraCost)
    } else {
      shares = players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
    }
    const merged = applyShares(players, shares)
    // 用 finalProfit 跑清算（合并了 AA 分摊）
    const transfers = diff === 0
      ? settle(merged.map(p => ({ nickname: p.nickname, profit: p.finalProfit })))
      : []
    this.setData({
      playerProfits: merged,
      shares,
      transfers,
      diff,
      canSubmit: diff === 0
    })
  },

  async onSubmit() {
    if (!this.data.canSubmit) {
      wx.showToast({ title: `Σ profit = ${this.data.diff}，请检查`, icon: 'none' }); return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '结算中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'settleGame',
        data: {
          gameId: this.data.gameId,
          finalStacks: this.data.finalStacks,
          extraCost: this.data.extraCost,
          aaMode: this.data.aaMode,
          shares: this.data.shares
        }
      })
      wx.hideLoading()
      const { ok, error } = res.result || {}
      if (!ok) { wx.showToast({ title: error || '结算失败', icon: 'none' }); return }
      this.setData({ submitted: true })
      wx.showToast({ title: '结算完成', icon: 'success' })
    } catch (err) {
      wx.hideLoading(); console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onAIReview() {
    if (!this.data.submitted) { wx.showToast({ title: '请先提交结算', icon: 'none' }); return }
    wx.navigateTo({ url: '/pages/game-review/game-review?id=' + this.data.gameId })
  },

  // ===== 生成结算图（Canvas 2d，美化版） =====
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
          const W = 360
          const rowH = 48
          const headH = 110
          const aaH = this.data.extraCost > 0 ? 36 : 0
          const txH = (this.data.transfers.length || 1) * 24 + 30
          const H = headH + 26 + this.data.playerProfits.length * rowH + aaH + 30 + txH + 50
          canvas.width = W * dpr
          canvas.height = H * dpr
          ctx.scale(dpr, dpr)
          await this._drawPretty(ctx, canvas, W, H)
          await new Promise(r => setTimeout(r, 80))
          const file = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 })
          await wx.saveImageToPhotosAlbum({ filePath: file.tempFilePath })
          wx.hideLoading(); wx.showToast({ title: '已保存到相册' })
        } catch (err) {
          wx.hideLoading(); console.error(err)
          wx.showToast({ title: '保存失败，检查相册权限', icon: 'none' })
        }
      })
  },

  async _drawPretty(ctx, canvas, W, H) {
    // ===== 背景渐变（牌桌绿 → 深绿） =====
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0B6E4F')
    bg.addColorStop(1, '#063A28')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ===== 顶部装饰：扑克花色水印 =====
    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '120px sans-serif'
    ctx.fillText('♠', -10, 100)
    ctx.fillText('♥', W - 100, 100)
    ctx.restore()

    // ===== 标题区 =====
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 26px sans-serif'
    ctx.fillText('Stax · 长河筹略', 20, 40)
    ctx.font = '14px sans-serif'
    ctx.fillStyle = '#C9A961'
    ctx.fillText("Hold'em, held right.", 20, 60)

    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(this.data.game.name || '牌局结算', 20, 88)

    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '11px sans-serif'
    const dt = new Date()
    const dtStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
    ctx.fillText(dtStr, 20, 104)

    // ===== 玩家盈亏列表（白色卡） =====
    let y = 130
    const cardX = 14
    const cardW = W - 28
    const cardH = 26 + this.data.playerProfits.length * 48 + 14
    this._roundRect(ctx, cardX, y, cardW, cardH, 12)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.fill()

    ctx.fillStyle = '#0B6E4F'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText('玩家盈亏', cardX + 16, y + 22)

    let py = y + 42
    for (const p of this.data.playerProfits) {
      // 头像占位圆
      ctx.fillStyle = '#0B6E4F'
      ctx.beginPath()
      ctx.arc(cardX + 28, py + 14, 14, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 12px sans-serif'
      const initial = (p.nickname || '?').charAt(0).toUpperCase()
      ctx.textAlign = 'center'
      ctx.fillText(initial, cardX + 28, py + 19)
      ctx.textAlign = 'start'

      // 昵称 + 买入
      ctx.fillStyle = '#1A1A1A'
      ctx.font = 'bold 13px sans-serif'
      ctx.fillText(p.nickname || '玩家', cardX + 52, py + 14)
      ctx.fillStyle = '#888888'
      ctx.font = '11px sans-serif'
      let extra = `买入 ${p.totalBuyIn} · ${p.buyInCount} 次`
      if (p.share > 0) extra += ` · AA -${p.share}`
      ctx.fillText(extra, cardX + 52, py + 28)

      // 盈亏
      const profit = p.finalProfit
      ctx.fillStyle = profit > 0 ? '#0B6E4F' : profit < 0 ? '#C8102E' : '#888888'
      ctx.font = 'bold 18px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText((profit > 0 ? '+' : '') + profit, cardX + cardW - 16, py + 22)
      ctx.textAlign = 'start'

      py += 48
    }

    y += cardH + 16

    // ===== AA 标识（如有） =====
    if (this.data.extraCost > 0) {
      const modeLabel = this.data.aaMode === 'winnerByRatio' ? '赢家按比例' : '人均 AA'
      ctx.fillStyle = '#C9A961'
      ctx.font = 'bold 12px sans-serif'
      ctx.fillText(`💰 额外费用 ${this.data.extraCost}（${modeLabel}）`, cardX + 4, y + 12)
      y += 24
    }

    // ===== 清算建议卡 =====
    const txCardH = (this.data.transfers.length || 1) * 24 + 36
    this._roundRect(ctx, cardX, y, cardW, txCardH, 12)
    ctx.fillStyle = 'rgba(201, 169, 97, 0.18)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(201, 169, 97, 0.5)'
    ctx.lineWidth = 1
    this._roundRect(ctx, cardX, y, cardW, txCardH, 12)
    ctx.stroke()

    ctx.fillStyle = '#C9A961'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText('清算建议', cardX + 16, y + 22)

    let ty = y + 44
    if (!this.data.transfers.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '12px sans-serif'
      ctx.fillText('🎉 无需转账，账已平', cardX + 16, ty)
    } else {
      ctx.font = '12px sans-serif'
      this.data.transfers.forEach(t => {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillText(`${t.from}  →  ${t.to}`, cardX + 16, ty)
        ctx.fillStyle = '#C9A961'
        ctx.textAlign = 'right'
        ctx.font = 'bold 13px sans-serif'
        ctx.fillText(String(t.amount), cardX + cardW - 16, ty)
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'start'
        ty += 24
      })
    }

    // ===== 页脚 =====
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('— Stax · Hold\'em, held right. —', W / 2, H - 18)
    ctx.textAlign = 'start'
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y,     x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x,     y + h, r)
    ctx.arcTo(x,     y + h, x,     y,     r)
    ctx.arcTo(x,     y,     x + w, y,     r)
    ctx.closePath()
  },

  // ===== 旧的简化绘图保留作 fallback（虽然已不使用） =====
  _draw(ctx, W, H) {
    ctx.fillStyle = '#F5F2EA'; ctx.fillRect(0, 0, W, H)
  }
})
