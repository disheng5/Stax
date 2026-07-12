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
    let title = 'StaxKit AI 复盘，看看这一晚的节奏'
    if (f.bigWinner) {
      title = `今晚状态最好的是 ${f.bigWinner.nickname} —— StaxKit AI 复盘`
    } else if (f.me && f.me.profit !== undefined) {
      const v = f.me.profit
      title = v >= 0 ? `我今晚 +${v}，来看 AI 的复盘` : '我今晚的复盘，AI 怎么说'
    }
    return { title, path: '/pages/index/index' }
  }
})
