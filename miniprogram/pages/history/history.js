// pages/history/history.js — 个人战绩历史
const { formatDate, formatDuration, formatProfit } = require('../../utils/format.js')
const app = getApp()

Page({
  data: { games: [], loading: true, deleting: false },

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
    if (!openid) {
      this.setData({ loading: false })
      return
    }
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db
        .collection('games')
        .where({ status: 'ended', players: _.elemMatch({ openid }) })
        .orderBy('endedAt', 'desc')
        .limit(50)
        .get()
      const games = res.data
        .filter(g => !(Array.isArray(g.hiddenForOpenids) && g.hiddenForOpenids.includes(openid)))
        .map(g => {
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
          await this._fetch()
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        } finally {
          this.setData({ deleting: false })
        }
      }
    })
  },

  onShareAppMessage() {
    const games = this.data.games
    if (!games.length) return { title: 'Stax · 长河筹略', path: '/pages/index/index' }
    const total = games.reduce((s, g) => s + (g.myProfit || 0), 0)
    const wins = games.filter(g => (g.myProfit || 0) > 0).length
    const winRate = Math.round((wins * 100) / games.length)
    return {
      title: `我打了 ${games.length} 局 ${total >= 0 ? '盈利' : '亏损'} ${Math.abs(total)}（胜率 ${winRate}%）— Stax 战绩`,
      path: '/pages/index/index'
    }
  }
})
