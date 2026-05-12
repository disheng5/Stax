// pages/game-review/game-review.js — AI 复盘
Page({
  data: {
    gameId: '',
    loading: true,
    review: '',
    facts: null,
    provider: ''
  },

  async onLoad(options) {
    this.setData({ gameId: options.id })
    await this._fetch()
  },

  async _fetch() {
    wx.showLoading({ title: 'AI 思考中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiReview',
        data: { gameId: this.data.gameId }
      })
      wx.hideLoading()
      const r = res.result || {}
      if (!r.ok) {
        wx.showToast({ title: r.error || '生成失败', icon: 'none' })
        this.setData({ loading: false })
        return
      }
      this.setData({
        review: r.review,
        facts: r.facts,
        provider: r.provider,
        loading: false
      })
    } catch (err) {
      wx.hideLoading(); console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  onCopy() {
    wx.setClipboardData({ data: this.data.review, success: () => wx.showToast({ title: '已复制' }) })
  },

  async onRetry() { await this._fetch() },

  onShareAppMessage() {
    return { title: 'Stax AI 给我的牌局点评，看看准不准 😎', path: '/pages/index/index' }
  }
})
