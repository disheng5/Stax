const { formatDate, formatDuration, formatProfit } = require('../../utils/format.js')
const {
  fetchAllGames,
  getCachedGames,
  invalidateGamesCache,
  getCacheVersion,
  cacheGame
} = require('../../utils/game-data.js')
const { computeGameStats, gameScore, sortDimensionRows } = require('../../utils/stats.js')
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
    dimData: [],
    aiExpanded: false,
    aiSummary: []
  },

  onLoad() {
    try {
      const openid = app.globalData.openid || wx.getStorageSync('last_openid')
      const cached = openid && getCachedGames(openid)
      if (cached && cached.length) this._applyGames(openid, cached)
    } catch (_) {}
  },

  async onShow() {
    const ver = getCacheVersion()
    if (this._lastFetch && Date.now() - this._lastFetch < 30000 && this._cacheVer === ver) return
    this._cacheVer = ver
    await this._fetch()
  },

  async _fetch(force = false) {
    if (!this.data.games.length) this.setData({ loading: true })
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (!openid) {
        this.setData({ loading: false })
        return
      }
      const cached = !force ? getCachedGames(openid) : []
      if (cached.length) this._applyGames(openid, cached)
      const filtered = await fetchAllGames(openid, { force })
      this._applyGames(openid, filtered)
      this._fetchAnalytics()
      this._lastFetch = Date.now()
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  _applyGames(openid, filtered) {
    // 只保留列表渲染需要的字段，避免把完整 players 数组塞进 setData
    const games = filtered.map(g => {
      const dur = g.endedAt && g.startedAt ? new Date(g.endedAt) - new Date(g.startedAt) : 0
      const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
      const score = gameScore(g, openid) || 0
      return {
        _id: g._id,
        name: g.name,
        playerCount: (g.players || []).length,
        myProfit: score,
        myProfitFormatted: formatProfit(score),
        scoreRatio: ratio,
        dateStr: formatDate(g.endedAt || g.startedAt),
        durationStr: formatDuration(dur)
      }
    })
    this._rawGames = filtered
    this.setData({ games, loading: false })
    this._computeChart(openid, filtered)
    // 统计、维度、趋势札记优先由 getMyAnalytics 提供（服务端聚合），仅做本地兜底
    if (!this._analyticsApplied) {
      this._computeStats(openid, filtered)
      this._computeDim(openid)
      this._computeAiSummary(filtered, openid)
    }
  },

  // 服务端聚合：stats/dimensions/trend/note 由 getMyAnalytics 一次性返回
  async _fetchAnalytics() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getMyAnalytics', data: {} })
      const r = res && res.result
      if (!r || !r.ok) return
      this._analyticsApplied = true
      this._analyticsDims = r.dimensions || {}
      this.setData({ stats: r.stats })
      this._applyAnalyticsDim()
      if (r.note && r.note.enough) {
        this.setData({
          aiSummary: [r.note.observation, r.note.perspective, r.note.action].filter(Boolean)
        })
      }
    } catch (_) {}
  },

  _applyAnalyticsDim() {
    const rows = (this._analyticsDims && this._analyticsDims[this.data.dim]) || []
    this.setData({
      dimData: rows.map(g => ({
        ...g,
        avg: g.games ? Math.round((g.profit || 0) / g.games) : 0,
        winRate: g.games ? Math.round(((g.wins || 0) * 1000) / g.games) / 10 : 0,
        profitStr: formatProfit(g.profit || 0)
      }))
    })
  },

  _computeStats(openid, games) {
    this.setData({ stats: computeGameStats(games, openid) })
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
      return { x: formatDate(g.endedAt || g.startedAt).slice(5), y: cum, delta: score }
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

  _computeDim(openid) {
    // 必须用原始数据：列表里的 games 已裁剪掉 players/endedAt 等字段
    const source = this._rawGames || []
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
    const dimData = sortDimensionRows(
      Object.values(groups).map(g => ({
        ...g,
        avg: g.games ? Math.round(g.profit / g.games) : 0,
        winRate: g.games ? Math.round((g.wins * 1000) / g.games) / 10 : 0,
        profitStr: formatProfit(g.profit)
      })),
      this.data.dim
    )
    this.setData({ dimData })
  },

  _computeAiSummary(games, openid) {
    const scores = (games || [])
      .slice()
      .sort((a, b) => new Date(a.endedAt || a.startedAt) - new Date(b.endedAt || b.startedAt))
      .map(g => gameScore(g, openid) || 0)
    if (!scores.length) {
      this.setData({ aiSummary: [] })
      return
    }
    const last5 = scores.slice(-5)
    const prev5 = scores.slice(-10, -5)
    const sum = arr => arr.reduce((s, v) => s + v, 0)
    const recent = sum(last5)
    const prev = sum(prev5)
    const best = Math.max(...scores)
    const worst = Math.min(...scores)
    const trend =
      prev5.length && recent > prev
        ? '近段节奏比前一段更顺，关注决策质量是否可持续。'
        : prev5.length && recent < prev
          ? '近段有所回落，单局波动是正常表现，不足以定义长期水平。'
          : '样本正在累积，先保持稳定记录。'
    this.setData({
      aiSummary: [trend, `单场波动区间 ${formatProfit(worst)} 到 ${formatProfit(best)}。`]
    })
  },

  onDimChange(e) {
    this.setData({ dim: e.currentTarget.dataset.k }, () => {
      if (this._analyticsApplied) {
        this._applyAnalyticsDim()
      } else {
        this._computeDim(app.globalData.openid)
      }
    })
  },

  onToggleAi() {
    this.setData({ aiExpanded: !this.data.aiExpanded })
  },

  onOpenGame(e) {
    const id = e.currentTarget.dataset.id
    const game = (this._rawGames || []).find(item => item._id === id)
    if (game) cacheGame(game)
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + id })
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
