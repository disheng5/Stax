// pages/profile/profile.js — 我的
const app = getApp()

Page({
  data: {
    userInfo: null,
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 },
    settings: { defaultBuyIn: 100, defaultSb: 10, defaultBb: 20 }
  },

  async onShow() {
    const cached = wx.getStorageSync('user_profile')
    if (cached) this.setData({ userInfo: cached })
    await this._refresh()
  },

  async _refresh() {
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
    }
  },

  onAuth() {
    wx.getUserProfile({
      desc: '用于在牌局中显示昵称头像',
      success: async res => {
        this.setData({ userInfo: res.userInfo })
        wx.setStorageSync('user_profile', res.userInfo)
        app.globalData.userInfo = res.userInfo
        // 同步昵称头像到 users
        try {
          await wx.cloud.callFunction({
            name: 'whoami',
            data: { upsertNickname: res.userInfo.nickName, upsertAvatar: res.userInfo.avatarUrl }
          })
          this._refresh()
        } catch (_) {}
      }
    })
  },

  onStats()    { wx.navigateTo({ url: '/pages/stats/stats' }) },
  onHistory()  { wx.navigateTo({ url: '/pages/history/history' }) },
  onAbout()    { wx.navigateTo({ url: '/pages/about/about' }) },
  onClearCache() {
    wx.clearStorageSync()
    wx.showToast({ title: '已清除', icon: 'success' })
    this.setData({ userInfo: null })
  }
})
