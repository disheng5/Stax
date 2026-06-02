const app = getApp()
const { formatProfit } = require('../../utils/format.js')
const { fetchAllGames } = require('../../utils/game-data.js')

Page({
  data: {
    dim: 'players',
    dimData: [],
    loading: true,
    rawGames: []
  },

  async onShow() {
    if (this._lastFetch && Date.now() - this._lastFetch < 30000) return
    await this._fetchAll()
  },

  async _fetchAll() {
    this.setData({ loading: true })
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (!openid) return
      const filtered = await fetchAllGames(openid)
      this.setData({ rawGames: filtered })
      this._computeDim(openid)
      this._lastFetch = Date.now()
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  _computeDim(openid) {
    const games = this.data.rawGames
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
    const dimData = Object.values(groups)
      .map(g => ({
        ...g,
        avg: g.games ? Math.round(g.profit / g.games) : 0,
        winRate: g.games ? Math.round((g.wins * 1000) / g.games) / 10 : 0,
        profitFormatted: formatProfit(g.profit)
      }))
      .sort((a, b) => b.games - a.games)
    this.setData({ dimData })
  },

  onDimChange(e) {
    this.setData({ dim: e.currentTarget.dataset.k })
    this._computeDim(app.globalData.openid)
  }
})
