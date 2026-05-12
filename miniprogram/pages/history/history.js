// pages/history/history.js — 个人战绩历史
const { formatDate, formatDuration, formatProfit } = require('../../utils/format.js')
const app = getApp()

Page({
  data: { games: [], loading: true },

  async onShow() {
    if (!app.globalData.openid) {
      try {
        const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
        if (res?.result?.openid) app.globalData.openid = res.result.openid
      } catch (_) {}
    }
    await this._fetch()
  },

  async _fetch() {
    const openid = app.globalData.openid
    if (!openid) { this.setData({ loading: false }); return }
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db
        .collection('games')
        .where({ status: 'ended', players: _.elemMatch({ openid }) })
        .orderBy('endedAt', 'desc')
        .limit(50)
        .get()
      const games = res.data.map(g => {
        const me = (g.players || []).find(p => p.openid === openid) || { profit: 0 }
        const dur = g.endedAt && g.startedAt ? new Date(g.endedAt) - new Date(g.startedAt) : 0
        return {
          ...g,
          myProfit: me.profit || 0,
          myProfitFormatted: formatProfit(me.profit || 0),
          dateStr: formatDate(g.endedAt || g.startedAt),
          durationStr: formatDuration(dur)
        }
      })
      this.setData({ games, loading: false })
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  onOpenGame(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + id })
  }
})
