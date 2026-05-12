// pages/stats/stats.js — 数据看板（趋势图 + 4 维度分析）
const app = getApp()
const { formatDate, formatProfit } = require('../../utils/format.js')

Page({
  data: {
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 },
    points: [],          // 累计盈亏曲线
    dim: 'players',      // players | rebuys | weekday | opponents
    dimData: [],         // [{ key, label, games, profit, avg, winRate }]
    loading: true,
    rawGames: []
  },

  async onShow() {
    await this._fetchAll()
  },

  async _fetchAll() {
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      const openid = res.result.openid
      const user = res.result.user
      app.globalData.openid = openid
      if (user?.stats) {
        const s = user.stats
        const winRate = s.totalGames > 0 ? Math.round(((s.wins || 0) * 1000) / s.totalGames) / 10 : 0
        this.setData({ stats: { ...s, winRate } })
      }

      const db = wx.cloud.database()
      const _ = db.command
      const all = []
      for (let skip = 0; skip < 200; skip += 20) {
        const r = await db.collection('games')
          .where({ status: 'ended', players: _.elemMatch({ openid }) })
          .orderBy('endedAt', 'asc')
          .skip(skip).limit(20).get()
        all.push(...r.data)
        if (r.data.length < 20) break
      }
      this.setData({ rawGames: all })
      this._computeChart(openid)
      this._computeDim(openid)
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  _computeChart(openid) {
    let cum = 0
    const points = this.data.rawGames.slice(-30).map(g => {
      const me = (g.players || []).find(p => p.openid === openid)
      const v = me?.finalProfit ?? me?.profit ?? 0
      cum += v
      return { x: formatDate(g.endedAt || g.startedAt).slice(5), y: cum }
    })
    this.setData({ points })
  },

  _computeDim(openid) {
    const games = this.data.rawGames
    const groups = {}
    games.forEach(g => {
      const me = (g.players || []).find(p => p.openid === openid)
      if (!me) return
      const profit = me.finalProfit ?? me.profit ?? 0
      let keys = []
      if (this.data.dim === 'players') {
        keys = [String(g.players.length) + ' 人']
      } else if (this.data.dim === 'rebuys') {
        keys = [me.buyInCount === 1 ? '1 次买入' : me.buyInCount === 2 ? '2 次买入' : '3+ 次买入']
      } else if (this.data.dim === 'weekday') {
        const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        keys = [wd[new Date(g.endedAt || g.startedAt).getDay()]]
      } else if (this.data.dim === 'opponents') {
        // 每个对手都计一次
        keys = (g.players || []).filter(p => p.openid !== openid).map(p => p.nickname || '未知')
      }
      keys.forEach(k => {
        if (!groups[k]) groups[k] = { key: k, games: 0, profit: 0, wins: 0 }
        groups[k].games++
        groups[k].profit += profit
        if (profit > 0) groups[k].wins++
      })
    })
    const dimData = Object.values(groups).map(g => ({
      ...g,
      avg: g.games ? Math.round(g.profit / g.games) : 0,
      winRate: g.games ? Math.round((g.wins * 1000) / g.games) / 10 : 0,
      profitFormatted: formatProfit(g.profit)
    })).sort((a, b) => b.games - a.games)
    this.setData({ dimData })
  },

  onDimChange(e) {
    this.setData({ dim: e.currentTarget.dataset.k })
    this._computeDim(app.globalData.openid)
  }
})
