// pages/index/index.js — 首页
const app = getApp()

Page({
  data: {
    ongoingGames: [],
    loading: true
  },
  onShow() {
    // TODO: 拉取进行中牌局列表
    this.setData({ loading: false })
  },
  onCreate() { wx.navigateTo({ url: '/pages/game-create/game-create' }) },
  onJoin()   { wx.navigateTo({ url: '/pages/game-join/game-join' }) },
  onHistory(){ wx.navigateTo({ url: '/pages/history/history' }) },
  onOpenGame(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + id })
  }
})
