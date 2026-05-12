// pages/learn-index/learn-index.js — 学习首页（P1）
Page({
  onTerms()  { wx.navigateTo({ url: '/pages/learn-terms/learn-terms' }) },
  onChart()  { wx.navigateTo({ url: '/pages/learn-hand-chart/learn-hand-chart' }) },
  onRules()  { wx.showToast({ title: '规则速览 P1 待补全', icon: 'none' }) }
})
