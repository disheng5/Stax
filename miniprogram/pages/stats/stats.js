// pages/stats/stats.js — 个人数据看板
const app = getApp()

Page({
  data: {
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 },
    loading: true
  },

  async onShow() {
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.user?.stats) {
        const s = res.result.user.stats
        const winRate = s.totalGames > 0 ? Math.round(((s.wins || 0) * 1000) / s.totalGames) / 10 : 0
        this.setData({ stats: { ...s, winRate } })
      }
      app.globalData.openid = res.result.openid
      app.globalData.userDoc = res.result.user
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  }
})
