// pages/profile/profile.js — 我的
const app = getApp()

Page({
  data: {
    userInfo: null,
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 },
    settings: { defaultBuyIn: 100, defaultSb: 10, defaultBb: 20 }
  },
  onShow() {
    // TODO: 拉取 stats / settings
  },
  onAuth() {
    wx.getUserProfile({
      desc: '用于在牌局中显示昵称头像',
      success: res => {
        this.setData({ userInfo: res.userInfo })
        app.globalData.userInfo = res.userInfo
      }
    })
  },
  onStats()    { wx.navigateTo({ url: '/pages/stats/stats' }) },
  onHistory()  { wx.navigateTo({ url: '/pages/history/history' }) },
  onAbout()    { wx.navigateTo({ url: '/pages/about/about' }) },
  onClearCache() {
    wx.clearStorage()
    wx.showToast({ title: '已清除', icon: 'success' })
  }
})
