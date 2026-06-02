const { formatDate, formatDuration, formatProfit } = require('../../utils/format.js')
const { fetchAllGames, invalidateGamesCache } = require('../../utils/game-data.js')
const app = getApp()

Page({
  data: {
    games: [],
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 },
    points: [],
    loading: true,
    deleting: false,
    showChart: false,
    chartRange: 'r30',
    dim: 'players',
    dimData: []
  },

  async onShow() {
    if (this._lastFetch && Date.now() - this._lastFetch < 30000) return
    await this._fetch()
  },

  async _fetch(force = false) {
    this.setData({ loading: true })
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (!openid) return
      const filtered = await fetchAllGames(openid, { force })
      const games = filtered.map(g => {
        const me = (g.players || []).find(p => p.openid === openid) || {}
        const dur = g.endedAt && g.startedAt ? new Date(g.endedAt) - new Date(g.startedAt) : 0
        const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
        const raw = me.finalProfit ?? me.profit ?? 0
        const score = Math.round(raw / ratio)
        return {
          ...g,
          myProfit: score,
          myProfitFormatted: formatProfit(score),
          scoreRatio: ratio,
          dateStr: formatDate(g.endedAt || g.startedAt),
          durationStr: formatDuration(dur)
        }
      })
      this.setData({ games, loading: false })
      this._lastFetch = Date.now()
      this._computeStats(openid, filtered)
      this._computeChart(openid, filtered)
      this._computeDim(openid, filtered)
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  _computeStats(openid, games) {
    let totalProfit = 0,
      biggestWin = 0,
      biggestLoss = 0,
      wins = 0
    games.forEach(g => {
      const me = (g.players || []).find(p => p.openid === openid)
      if (!me) return
      const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
      const score = Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)
      totalProfit += score
      if (score > biggestWin) biggestWin = score
      if (score < biggestLoss) biggestLoss = score
      if (score > 0) wins++
    })
    const totalGames = games.length
    const winRate = totalGames > 0 ? Math.round((wins * 1000) / totalGames) / 10 : 0
    this.setData({ stats: { totalGames, totalProfit, biggestWin, biggestLoss, wins, winRate } })
  },

  _computeChart(openid, games) {
    const sorted = games
      .slice()
      .sort((a, b) => new Date(a.endedAt || a.startedAt) - new Date(b.endedAt || b.startedAt))
    this._allSorted = sorted
    this._chartOpenid = openid
    this._applyChartRange(sorted, openid)
  },

  _applyChartRange(sorted, openid) {
    const range = this.data.chartRange
    let filtered = sorted
    if (range === 'r10') {
      filtered = sorted.slice(-10)
    } else if (range === 'r30') {
      filtered = sorted.slice(-30)
    } else if (range === 'm3') {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - 3)
      filtered = sorted.filter(g => new Date(g.endedAt || g.startedAt) >= cutoff)
    }
    let cum = 0
    const points = filtered.map(g => {
      const me = (g.players || []).find(p => p.openid === openid)
      const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
      const score = Math.round((me?.finalProfit ?? me?.profit ?? 0) / ratio)
      cum += score
      return { x: formatDate(g.endedAt || g.startedAt).slice(5), y: cum }
    })
    this.setData({ points })
    if (points.length > 0) this.setData({ showChart: true })
  },

  onChartRangeChange(e) {
    this.setData({ chartRange: e.currentTarget.dataset.k }, () => {
      if (this._allSorted && this._chartOpenid) {
        this._applyChartRange(this._allSorted, this._chartOpenid)
      }
    })
  },

  onToggleChart() {
    this.setData({ showChart: !this.data.showChart })
  },

  _computeDim(openid, games) {
    const source = games || this.data.games.map(g => g)
    const groups = {}
    source.forEach(g => {
      const me = (g.players || []).find(p => p.openid === openid)
      if (!me) return
      const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
      const profit = Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)
      let keys = []
      const dim = this.data.dim
      if (dim === 'players') {
        keys = [String(g.players.length) + ' 人']
      } else if (dim === 'rebuys') {
        keys = [me.buyInCount === 1 ? '1 次' : me.buyInCount === 2 ? '2 次' : '3+ 次']
      } else if (dim === 'weekday') {
        const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        keys = [wd[new Date(g.endedAt || g.startedAt).getDay()]]
      } else if (dim === 'opponents') {
        keys = (g.players || []).filter(p => p.openid !== openid).map(p => p.nickname || '未知')
      }
      keys.forEach(k => {
        if (!groups[k]) groups[k] = { key: k, games: 0, profit: 0, wins: 0 }
        groups[k].games++
        groups[k].profit += profit
        if (profit > 0) groups[k].wins++
      })
    })
    const dimData = Object.values(groups)
      .map(g => ({
        ...g,
        avg: g.games ? Math.round(g.profit / g.games) : 0,
        winRate: g.games ? Math.round((g.wins * 1000) / g.games) / 10 : 0,
        profitStr: formatProfit(g.profit)
      }))
      .sort((a, b) => b.games - a.games)
    this.setData({ dimData })
  },

  onDimChange(e) {
    this.setData({ dim: e.currentTarget.dataset.k }, () => {
      this._computeDim(app.globalData.openid)
    })
  },

  onOpenGame(e) {
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + e.currentTarget.dataset.id })
  },

  onDeleteRecord(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '这场记录'
    wx.showModal({
      title: '删除战绩',
      content: `从你的战绩中移除「${name}」？该操作仅对你可见，不影响其他玩家。`,
      confirmText: '删除',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        this.setData({ deleting: true })
        wx.showLoading({ title: '删除中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'deleteGameRecord',
            data: { gameId: id }
          })
          wx.hideLoading()
          if (!res.result?.ok) {
            wx.showToast({ title: res.result?.error || '删除失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已删除' })
          invalidateGamesCache()
          this._lastFetch = 0
          await this._fetch(true)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常', icon: 'none' })
        } finally {
          this.setData({ deleting: false })
        }
      }
    })
  },

  onShareAppMessage() {
    const games = this.data.games
    if (!games.length) return { title: 'StaxKit', path: '/pages/index/index' }
    const total = games.reduce((s, g) => s + (g.myProfit || 0), 0)
    const wins = games.filter(g => (g.myProfit || 0) > 0).length
    const winRate = Math.round((wins * 100) / games.length)
    return {
      title: `我打了 ${games.length} 局 ${total >= 0 ? '盈利' : '亏损'} ${Math.abs(total)}（胜率 ${winRate}%）`,
      path: '/pages/index/index'
    }
  }
})
