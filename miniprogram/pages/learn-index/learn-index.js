// pages/learn-index/learn-index.js — 学习首页
Page({
  onTerms() { wx.navigateTo({ url: '/pages/learn-terms/learn-terms' }) },
  onChart() { wx.navigateTo({ url: '/pages/learn-hand-chart/learn-hand-chart' }) },
  onRules() { wx.navigateTo({ url: '/pages/learn-rules/learn-rules' }) }
})
