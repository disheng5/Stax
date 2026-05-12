// pages/history/history.js — 个人战绩历史
Page({
  data: { games: [], loading: true },
  onShow() {
    // TODO: 拉取 games where players.openid == self
    this.setData({ loading: false })
  },
  onOpenGame(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + id })
  }
})
