// pages/game-review/game-review.js — 数据小结（基于本局数据的规则整理）
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
    wx.showLoading({ title: '整理中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'aiReview',
        data: { gameId: this.data.gameId }
      })
      wx.hideLoading()
      const r = res.result || {}
      if (!r.ok) {
        wx.showToast({ title: '暂时无法获取，请稍后重试', icon: 'none' })
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
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  onCopy() {
    wx.setClipboardData({
      data: this.data.review,
      success: () => wx.showToast({ title: '已复制' })
    })
  },

  async onRetry() {
    await this._fetch()
  },

  onShareAppMessage() {
    const f = this.data.facts || {}
    let title = 'StaxKit 数据小结，看看这一晚的节奏'
    if (f.bigWinner) {
      title = `今晚状态最好的是 ${f.bigWinner.nickname} —— StaxKit 数据小结`
    } else if (f.me && f.me.profit !== undefined) {
      const v = f.me.profit
      title = v >= 0 ? `我今晚 +${v}，来看数据小结` : '看看我今晚的数据小结'
    }
    return { title, path: '/pages/index/index' }
  }
})
