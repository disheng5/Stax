const app = getApp()
const { formatProfit } = require('../../utils/format.js')
const { fetchAllGames, getCacheVersion } = require('../../utils/game-data.js')
const { sortDimensionRows } = require('../../utils/stats.js')

Page({
  data: {
    dim: 'players',
    dimData: [],
    loading: true
  },

  async onShow() {
    // 30s 内不重复拉取；但缓存版本变了（刚结算/删除）立即刷新
    const ver = getCacheVersion()
    if (this._lastFetch && Date.now() - this._lastFetch < 30000 && this._cacheVer === ver) return
    this._cacheVer = ver
    await this._fetchAll()
  },

  async _fetchAll() {
    this.setData({ loading: true })
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (!openid) return
      // 优先服务端聚合（不下发无关玩家数组）；失败则本地兜底
      const applied = await this._fetchAnalytics()
      if (!applied) {
        this._rawGames = await fetchAllGames(openid)
        this._computeDim(openid)
      }
      this._lastFetch = Date.now()
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async _fetchAnalytics() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getMyAnalytics', data: {} })
      const r = res && res.result
      if (!r || !r.ok) return false
      this._analyticsDims = r.dimensions || {}
      this._applyAnalyticsDim()
      return true
    } catch (_) {
      return false
    }
  },

  _applyAnalyticsDim() {
    const rows = (this._analyticsDims && this._analyticsDims[this.data.dim]) || []
    this.setData({
      dimData: rows.map(g => ({
        ...g,
        avg: g.games ? Math.round((g.profit || 0) / g.games) : 0,
        winRate: g.games ? Math.round(((g.wins || 0) * 1000) / g.games) / 10 : 0,
        profitFormatted: formatProfit(g.profit || 0)
      }))
    })
  },

  _computeDim(openid) {
    const games = this._rawGames || []
    const groups = {}
    games.forEach(g => {
      const me = (g.players || []).find(p => p.openid === openid)
      if (!me) return
      const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
      const profit = Math.round((me.finalProfit ?? me.profit ?? 0) / ratio)
      let keys = []
      if (this.data.dim === 'players') {
        keys = [String(g.players.length) + ' 人']
      } else if (this.data.dim === 'rebuys') {
        keys = [me.buyInCount === 1 ? '1 次买入' : me.buyInCount === 2 ? '2 次买入' : '3+ 次买入']
      } else if (this.data.dim === 'weekday') {
        const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        keys = [wd[new Date(g.endedAt || g.startedAt).getDay()]]
      } else if (this.data.dim === 'opponents') {
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
        profitFormatted: formatProfit(g.profit)
      })),
      this.data.dim
    )
    this.setData({ dimData })
  },

  onDimChange(e) {
    this.setData({ dim: e.currentTarget.dataset.k }, () => {
      if (this._analyticsDims) {
        this._applyAnalyticsDim()
      } else {
        this._computeDim(app.globalData.openid)
      }
    })
  }
})
