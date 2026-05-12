// pages/stats/stats.js — 个人数据看板
Page({
  data: { stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 }, loading: true },
  onShow() { /* TODO: 聚合 users.stats */ this.setData({ loading: false }) }
})
