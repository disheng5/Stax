// pages/learn-terms/learn-terms.js — 术语词典（P1）
const { TERM_CATEGORIES } = require('../../utils/constants.js')
Page({
  data: { keyword: '', category: '', categories: TERM_CATEGORIES, terms: [], loading: true },
  onShow()       { /* TODO: 拉取 terms */ this.setData({ loading: false }) },
  onSearch(e)    { this.setData({ keyword: e.detail.value }) },
  onCategory(e)  { this.setData({ category: e.currentTarget.dataset.k }) },
  onOpen(e)      { wx.navigateTo({ url: '/pages/learn-term-detail/learn-term-detail?id=' + e.currentTarget.dataset.id }) }
})
