// pages/learn-hand-chart/learn-hand-chart.js — 起手牌表（P1）
Page({
  data: { matrix: [], loading: true },
  onShow() {
    // TODO: 加载 handRanks 集合，构建 13x13 矩阵
    this.setData({ loading: false })
  }
})
