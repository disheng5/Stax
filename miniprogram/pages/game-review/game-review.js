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
    let title = 'StaxKit AI 点评我的战绩，看看准不准'
    if (f.bigWinner) {
      title = `今晚 MVP 是 ${f.bigWinner.nickname}，独吞 ${f.bigWinner.profit} —— StaxKit AI 复盘`
    } else if (f.me && f.me.profit !== undefined) {
      const v = f.me.profit
      title = v > 0 ? `我今晚 +${v}，AI 怎么夸我的？` : `我今晚 ${v}，AI 都看不下去了`
    }
    return { title, path: '/pages/index/index' }
  }
})
