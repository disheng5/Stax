// pages/index/index.js — 首页
const app = getApp()
const { formatProfit } = require('../../utils/format.js')

Page({
  data: {
    ongoingGames: [],
    loading: true,
    myStats: null
  },

  async onShow() {
    await this._ensureOpenid()
    await this._fetchOngoing()
    await this._fetchStats()
  },

  async _ensureOpenid() {
    if (app.globalData.openid) return
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.openid) {
        app.globalData.openid = res.result.openid
        app.globalData.userDoc = res.result.user
      }
    } catch (err) { console.error('[whoami]', err) }
  },

  async _fetchOngoing() {
    const openid = app.globalData.openid
    if (!openid) { this.setData({ loading: false }); return }
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db
        .collection('games')
        .where({
          status: 'ongoing',
          players: _.elemMatch({ openid })
        })
        .orderBy('startedAt', 'desc')
        .limit(20)
        .get()
      this.setData({ ongoingGames: res.data, loading: false })
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  async _fetchStats() {
    const u = app.globalData.userDoc
    if (u?.stats?.totalGames > 0) {
      this.setData({ myStats: u.stats })
    }
  },

  onCreate()  { wx.navigateTo({ url: '/pages/game-create/game-create' }) },
  onJoin()    { wx.navigateTo({ url: '/pages/game-join/game-join' }) },
  onHistory() { wx.navigateTo({ url: '/pages/history/history' }) },
  onOpenGame(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + id })
  },

  onShareAppMessage() {
    const s = this.data.myStats
    let title = 'Stax · 长河筹略 — 朋友局德州扑克记账神器'
    if (s && s.totalGames >= 3) {
      const pf = formatProfit(s.totalProfit || 0)
      title = `我用 Stax 记了 ${s.totalGames} 局，累计 ${pf}，来一起打牌？`
    }
    return { title, path: '/pages/index/index' }
  }
})
