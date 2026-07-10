// pages/learn-terms/learn-terms.js — 术语词典
const { TERM_CATEGORIES } = require('../../../utils/constants.js')

const CATEGORY_LABEL = {
  rule: '规则', action: '动作', position: '位置', hand: '牌型', concept: '概念'
}

Page({
  data: {
    keyword: '',
    category: '',
    categories: TERM_CATEGORIES,
    categoryLabel: CATEGORY_LABEL,
    terms: [],
    filtered: [],
    loading: true
  },

  onLoad() {
    try {
      const cached = wx.getStorageSync('stax_terms_v1')
      if (cached && Array.isArray(cached.data)) {
        this._cacheAt = cached.ts || 0
        this.setData({ terms: cached.data, loading: false })
        this._filter()
      }
    } catch (_) {}
  },

  async onShow() {
    if (this._cacheAt && Date.now() - this._cacheAt < 24 * 60 * 60 * 1000) return
    await this._fetch()
  },

  async _fetch() {
    try {
      const db = wx.cloud.database()
      // 集合最多 20 条/请求，分页拉取
      const all = []
      for (let skip = 0; ; skip += 20) {
        const res = await db.collection('terms').skip(skip).limit(20).get()
        all.push(...res.data)
        if (res.data.length < 20) break
      }
      this.setData({ terms: all })
      this._cacheAt = Date.now()
      try {
        wx.setStorageSync('stax_terms_v1', { ts: this._cacheAt, data: all })
      } catch (_) {}
      this._filter()
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  _filter() {
    const kw = (this.data.keyword || '').trim().toLowerCase()
    const cat = this.data.category
    const filtered = this.data.terms.filter(t => {
      if (cat && t.category !== cat) return false
      if (!kw) return true
      return (
        (t.termEn || '').toLowerCase().includes(kw) ||
        (t.termCn || '').toLowerCase().includes(kw)
      )
    })
    this.setData({ filtered })
  },

  onSearch(e)    { this.setData({ keyword: e.detail.value }); this._filter() },
  onCategory(e)  { this.setData({ category: e.currentTarget.dataset.k }); this._filter() },
  onOpen(e) {
    const term = this.data.filtered.find(t => t._id === e.currentTarget.dataset.id)
    if (term) wx.setStorageSync('term_cache_' + term._id, term)
    wx.navigateTo({ url: '/packageLearn/pages/learn-term-detail/learn-term-detail?id=' + e.currentTarget.dataset.id })
  }
})
