// pages/game-settle/game-settle.js — 下桌结算页
const { settle } = require('../../utils/settle.js')
const { computeShares } = require('../../utils/aa.js')
const { invalidateGamesCache } = require('../../utils/game-data.js')
const { createOperationId } = require('../../utils/operation.js')
const SUNZI = require('../../utils/sunzi.js')
const app = getApp()

function normalizeExpenseMode(value) {
  if (['winner', 'winnerRatio', 'winnerByRatio'].includes(value)) return 'winner'
  if (['winnerEven', 'winnersEven'].includes(value)) return 'winnerEven'
  if (value === 'mvp') return 'mvp'
  return 'all'
}

Page({
  data: {
    gameId: '',
    game: null,
    myOpenid: '',
    isHost: false,
    finalStacks: {},
    playerProfits: [],
    transfers: [],
    shares: [],
    diff: 0,
    allSettled: false,
    settledCount: 0,
    canSubmit: false,
    submitting: false,
    submitted: false,
    settleImagePath: '',
    shareImageUrl: '',

    extraCost: 0,
    expenseMode: 'all' // 'all' | 'winner'
  },

  async onLoad(options) {
    this.setData({ gameId: options.id || '' })
    await this._ensureOpenid()
    await this._loadGame()
  },

  async _ensureOpenid() {
    if (app.globalData.openid) {
      this.setData({ myOpenid: app.globalData.openid })
      return
    }
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.openid) {
        app.globalData.openid = res.result.openid
        this.setData({ myOpenid: res.result.openid })
      }
    } catch (err) {
      console.error('[whoami]', err)
    }
  },

  async _loadGame() {
    wx.showLoading({ title: '加载中…' })
    try {
      const db = wx.cloud.database()
      const got = await db.collection('games').doc(this.data.gameId).get()
      const game = got.data
      // 被淘汰/踢出的玩家不参与结算（新踢人已移除，此处兜底旧数据）
      game.players = (game.players || []).filter(p => !p.eliminatedAt)
      const finalStacks = {}
      ;(game.players || []).forEach(p => {
        if (p.finalStack !== null && p.finalStack !== undefined)
          finalStacks[p.openid] = p.finalStack
        else if (p.openid === this.data.myOpenid || game.hostOpenid === this.data.myOpenid)
          finalStacks[p.openid] = p.currentStack || 0
        else finalStacks[p.openid] = ''
      })
      this.setData({
        game,
        finalStacks,
        isHost: game.hostOpenid === this.data.myOpenid,
        extraCost: game.extraCost || 0,
        expenseMode: normalizeExpenseMode(game.expenseMode || game.aaMode)
      })
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
    this.setData({ [`finalStacks.${openid}`]: e.detail.value })
    this._recompute()
  },

  onExtraCostInput(e) {
    this.setData({ extraCost: Number(e.detail.value) || 0 })
    this._recompute()
  },

  onExpenseModeChange(e) {
    this.setData({ expenseMode: e.currentTarget.dataset.k })
    this._recompute()
  },

  _buildPlayers() {
    const gamePlayers = this.data.game?.players || []
    return gamePlayers.map(p => {
      const raw = this.data.finalStacks[p.openid]
      const hasFinal = raw !== '' && raw !== null && raw !== undefined
      const finalStack = hasFinal ? Number(raw) || 0 : null
      const profit = hasFinal ? finalStack - p.totalBuyIn : null
      return { ...p, finalStack, profit, hasFinal }
    })
  },

  _buildShares(players) {
    return computeShares(players, this.data.extraCost, this.data.expenseMode)
  },

  _recompute() {
    if (!this.data.game) return
    const players = this._buildPlayers()
    const settledCount = players.filter(p => p.hasFinal).length
    const allSettled = players.length > 0 && settledCount === players.length
    const baseDiff = allSettled ? players.reduce((s, p) => s + p.profit, 0) : 0
    const shares = this._buildShares(players.map(p => ({ ...p, profit: p.profit || 0 })))
    const shareMap = {}
    shares.forEach(s => {
      shareMap[s.openid] = Number(s.share) || 0
    })
    const playerProfits = players.map(p => {
      const share = shareMap[p.openid] || 0
      const finalProfit = p.hasFinal ? p.profit : null
      return { ...p, share, finalProfit }
    })
    const transfers =
      allSettled && baseDiff === 0
        ? settle(playerProfits.map(p => ({ nickname: p.nickname, profit: p.finalProfit })))
        : []
    const myPlayer = players.find(p => p.openid === this.data.myOpenid)
    const myStackFilled = !!myPlayer && this.data.finalStacks[this.data.myOpenid] !== ''
    const canSubmit = myStackFilled
    this.setData({
      playerProfits,
      shares,
      transfers,
      diff: baseDiff,
      allSettled,
      settledCount,
      canSubmit
    })
  },

  // 朋友局：参赛成员可代提任意玩家的结算积分（服务端二次校验）
  _submittedStacks() {
    const out = {}
    Object.keys(this.data.finalStacks).forEach(openid => {
      const value = this.data.finalStacks[openid]
      if (value !== '' && value !== null && value !== undefined) out[openid] = Number(value) || 0
    })
    return out
  },

  async onSubmit() {
    if (!this.data.canSubmit) {
      wx.showToast({ title: '请先填写下桌筹码', icon: 'none' })
      return
    }
    // 服务端在全员结算后自动收局，前端不再显式 finalize；
    // 不回传费用参数，避免覆盖房间面板里已保存的费用设置
    this.setData({ submitting: true })
    wx.showLoading({ title: '记录结算积分…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'settleGame',
        data: {
          gameId: this.data.gameId,
          mode: 'checkout',
          operationId: createOperationId('checkout'),
          finalStacks: this._submittedStacks()
        }
      })
      wx.hideLoading()
      const { ok, error, ended, game } = res.result || {}
      if (!ok) {
        const msg =
          {
            NOT_PLAYER: '上桌玩家才能结算',
            PROFIT_NOT_ZERO: '筹码总和不平，请检查',
            NOT_ALL_CHECKED_OUT: '还有玩家未下桌',
            NOT_HOST: '仅房主可最终结算',
            PLAYER_OPS_DISABLED: '本局仅房主可操作',
            PLAYER_NOT_FOUND: '玩家已不在本局，请刷新后重试',
            NO_STACKS_SUBMITTED: '请先填写下桌筹码',
            ALREADY_ENDED: '牌局已结束',
            INVALID_STACK: '请输入有效的非负积分',
            INVALID_EXTRA_COST: '请输入有效的费用金额',
            CONFLICT_RETRY: '操作冲突，请重试'
          }[error] ||
          error ||
          '操作失败'
        wx.showToast({ title: msg, icon: 'none' })
        this.setData({ submitting: false })
        return
      }
      if (game) {
        const finalStacks = {}
        ;(game.players || []).forEach(p => {
          if (p.finalStack !== null && p.finalStack !== undefined)
            finalStacks[p.openid] = p.finalStack
          else if (this.data.isHost || p.openid === this.data.myOpenid)
            finalStacks[p.openid] = p.currentStack || 0
          else finalStacks[p.openid] = ''
        })
        this.setData({ game, finalStacks })
        this._recompute()
      }
      if (ended) {
        invalidateGamesCache() // 首页/历史/我的 战绩立即反映本局
        this.setData({ submitted: true })
        wx.showToast({ title: '牌局已结束', icon: 'success' })
        setTimeout(() => this.onGenerateImage(false), 500)
      } else {
        wx.showToast({ title: '已记录，等待其他玩家下桌', icon: 'success' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async _createSettleImage() {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery()
      query
        .select('#settle-canvas')
        .fields({ node: true, size: true })
        .exec(async res => {
          try {
            const canvas = res[0].node
            const ctx = canvas.getContext('2d')
            const dpr =
              (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2
            const W = 360
            const rowH = 44
            const headH = 150
            const summaryH = 90
            const aaH = this.data.extraCost > 0 ? 38 : 0
            const quoteH = 96
            const H =
              headH + summaryH + 24 + this.data.playerProfits.length * rowH + 20 + aaH + quoteH + 30
            canvas.width = W * dpr
            canvas.height = H * dpr
            ctx.scale(dpr, dpr)
            await this._drawPretty(ctx, canvas, W, H)
            await new Promise(r => setTimeout(r, 80))
            const file = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 })
            resolve(file.tempFilePath)
          } catch (err) {
            reject(err)
          }
        })
    })
  },

  async onGenerateImage(showToast = true) {
    if (!this.data.allSettled || this.data.diff !== 0) return
    if (showToast) wx.showLoading({ title: '生成中…' })
    try {
      const settleImagePath = await this._createSettleImage()
      this.setData({ settleImagePath })
      this._uploadShareImage(settleImagePath)
      if (showToast) {
        wx.hideLoading()
        wx.showToast({ title: '结算图已生成' })
      }
    } catch (err) {
      if (showToast) wx.hideLoading()
      console.error(err)
      if (showToast) wx.showToast({ title: '生成失败', icon: 'none' })
    }
  },

  async _uploadShareImage(filePath) {
    try {
      const cloudPath = `settle-images/${this.data.gameId}_${Date.now()}.png`
      const res = await wx.cloud.uploadFile({ cloudPath, filePath })
      if (res.fileID) {
        const urlRes = await wx.cloud.getTempFileURL({ fileList: [res.fileID] })
        const url = urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL
        if (url) this.setData({ shareImageUrl: url })
      }
    } catch (err) {
      console.error('[uploadShareImage]', err)
    }
  },

  async onSaveImage() {
    try {
      const filePath = this.data.settleImagePath || (await this._createSettleImage())
      await wx.saveImageToPhotosAlbum({ filePath })
      this.setData({ settleImagePath: filePath })
      wx.showToast({ title: '已保存到相册' })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '保存失败，检查相册权限', icon: 'none' })
    }
  },

  onShareAppMessage() {
    return {
      title: `「${this.data.game?.name || 'StaxKit 牌局'}」结算结果`,
      path: `/pages/game-detail/game-detail?id=${this.data.gameId}`,
      imageUrl: this.data.shareImageUrl || this.data.settleImagePath || ''
    }
  },

  _expenseLabel() {
    return (
      {
        all: '全员AA',
        winner: '水上AA'
      }[this.data.expenseMode] || '全员AA'
    )
  },

  async _drawPretty(ctx, canvas, W, H) {
    const bg = ctx.createLinearGradient(0, 0, W * 0.3, H)
    bg.addColorStop(0, '#1A1B2E')
    bg.addColorStop(0.5, '#16213E')
    bg.addColorStop(1, '#0F3460')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.globalAlpha = 0.04
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 0.5
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      ctx.arc(W * 0.7, H * 0.15, 40 + i * 30, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('StaxKit', 20, 46)
    ctx.font = '13px sans-serif'
    ctx.fillStyle = '#C9A961'
    ctx.fillText('Hold\u2019em, held right.', 20, 66)

    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = 'bold 16px sans-serif'
    const titleText = this.data.game.name || '今晚战报'
    ctx.fillText(titleText.length > 18 ? titleText.slice(0, 17) + '…' : titleText, 20, 96)

    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '11px sans-serif'
    const dt = new Date()
    const dtStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
    ctx.fillText(dtStr, 20, 116)

    const players = (this.data.playerProfits || []).slice()
    const ranked = players.slice().sort((a, b) => (b.finalProfit || 0) - (a.finalProfit || 0))
    const winner = ranked[0]
    const loser = ranked[ranked.length - 1]
    const totalPot = players.reduce((s, p) => s + (p.totalBuyIn || 0), 0)

    let y = 150
    const cardX = 16
    const cardW = W - 32

    this._roundRect(ctx, cardX, y, cardW, 78, 14)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fill()

    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = '11px sans-serif'
    ctx.fillText('今晚 MVP', cardX + 18, y + 22)
    ctx.fillText('总池 / 人数', cardX + cardW / 2 + 8, y + 22)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(winner ? winner.nickname : '-', cardX + 18, y + 46)
    ctx.fillStyle = '#C9A961'
    ctx.font = 'bold 22px sans-serif'
    const mvpProfit = winner ? (winner.finalProfit > 0 ? '+' : '') + winner.finalProfit : '0'
    ctx.fillText(mvpProfit, cardX + 18, y + 70)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(String(totalPot), cardX + cardW / 2 + 8, y + 46)
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '12px sans-serif'
    ctx.fillText(
      `${players.length} 人 · 慰问 ${loser ? loser.nickname : '-'}`,
      cardX + cardW / 2 + 8,
      y + 68
    )

    y += 90

    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '11px sans-serif'
    ctx.fillText('盈亏', cardX + 4, y + 14)
    ctx.textAlign = 'right'
    ctx.fillText('手数 · 总码', cardX + cardW - 4, y + 14)
    ctx.textAlign = 'start'
    y += 24

    const rowH = 44
    for (const p of ranked) {
      const profit = p.finalProfit || 0
      const isWin = profit > 0
      const isLoss = profit < 0

      ctx.fillStyle = isWin
        ? 'rgba(201,169,97,0.16)'
        : isLoss
          ? 'rgba(200,16,46,0.10)'
          : 'rgba(255,255,255,0.06)'
      this._roundRect(ctx, cardX, y, cardW, rowH - 6, 10)
      ctx.fill()

      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 14px sans-serif'
      const nick = p.nickname || '玩家'
      ctx.fillText(nick.length > 8 ? nick.slice(0, 7) + '…' : nick, cardX + 14, y + 22)

      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '11px sans-serif'
      ctx.fillText(`${p.buyInCount} 手 · ${p.totalBuyIn}`, cardX + 14, y + 34)

      ctx.fillStyle = isWin ? '#FFD27A' : isLoss ? '#FF8A95' : 'rgba(255,255,255,0.6)'
      ctx.font = 'bold 18px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText((isWin ? '+' : '') + profit, cardX + cardW - 14, y + 26)
      ctx.textAlign = 'start'

      y += rowH
    }

    y += 6
    if (this.data.extraCost > 0) {
      ctx.fillStyle = '#C9A961'
      ctx.font = '11px sans-serif'
      ctx.fillText(
        `其他费用 ${this.data.extraCost} · ${this._expenseLabel()}（不计入盈亏）`,
        cardX + 4,
        y + 14
      )
      y += 28
    }

    const quote =
      typeof SUNZI !== 'undefined' && SUNZI.length
        ? SUNZI[Math.floor(Math.random() * SUNZI.length)]
        : { text: '', from: '' }
    y += 8
    this._roundRect(ctx, cardX, y, cardW, 78, 12)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(201,169,97,0.45)'
    ctx.lineWidth = 1
    this._roundRect(ctx, cardX, y, cardW, 78, 12)
    ctx.stroke()

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'italic 14px serif'
    ctx.fillText(`「${quote.text}」`, cardX + 16, y + 30)
    ctx.fillStyle = '#C9A961'
    ctx.font = '11px sans-serif'
    ctx.fillText(`— ${quote.from}`, cardX + 16, y + 54)
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('StaxKit', cardX + cardW - 16, y + 70)
    ctx.textAlign = 'start'
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
})
