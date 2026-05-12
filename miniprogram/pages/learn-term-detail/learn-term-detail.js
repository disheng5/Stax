// pages/learn-term-detail/learn-term-detail.js — 术语详情
const CATEGORY_LABEL = { rule: '规则', action: '动作', position: '位置', hand: '牌型', concept: '概念' }

Page({
  data: { term: null, loading: true, categoryLabel: CATEGORY_LABEL },

  async onLoad(options) {
    const id = options.id
    if (!id) { this.setData({ loading: false }); return }
    // 先用缓存秒开
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
  }
})
