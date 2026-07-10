// pages/learn-term-detail/learn-term-detail.js — 术语详情
const CATEGORY_LABEL = { rule: '规则', action: '动作', position: '位置', hand: '牌型', concept: '概念' }

Page({
  data: {
    term: null,
    loading: true,
    categoryLabel: CATEGORY_LABEL,
    aiText: '',
    aiLoading: false,
    aiError: ''
  },

  async onLoad(options) {
    const id = options.id
    if (!id) { this.setData({ loading: false }); return }
    const cache = wx.getStorageSync('term_cache_' + id)
    if (cache) this.setData({ term: cache, loading: false })
    try {
      const db = wx.cloud.database()
      const res = await db.collection('terms').doc(id).get()
      if (res.data) this.setData({ term: res.data, loading: false })
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  async onAskAi() {
    if (!this.data.term) return
    if (this.data.aiText) {
      // 已经生成过，再次点击 = 重新生成
      this.setData({ aiText: '' })
    }
    this.setData({ aiLoading: true, aiError: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'termAi',
        data: { termId: this.data.term._id }
      })
      const r = res.result || {}
      if (!r.ok) {
        this.setData({ aiError: r.error || '生成失败', aiLoading: false })
        return
      }
      this.setData({ aiText: r.aiText, aiLoading: false })
    } catch (err) {
      console.error(err)
      this.setData({ aiError: '网络异常', aiLoading: false })
    }
  },

  onCopyAi() {
    wx.setClipboardData({ data: this.data.aiText, success: () => wx.showToast({ title: '已复制' }) })
  }
})
