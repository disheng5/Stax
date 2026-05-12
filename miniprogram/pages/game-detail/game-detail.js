// pages/game-detail/game-detail.js — 牌局详情（核心页）
Page({
  data: {
    gameId: '',
    game: null,
    isHost: false,
    loading: true
  },
  onLoad(options) {
    this.setData({ gameId: options.id || options.code || '' })
    // TODO: 监听云数据库 watch（Spec §5.1）
  },
  onUnload() {
    if (this.watcher) { try { this.watcher.close() } catch (_) {} }
  },
  onRebuy(e)     { /* TODO recordTransaction rebuy */ },
  onAddOn(e)     { /* TODO recordTransaction addOn */ },
  onEliminate(e) { /* TODO recordTransaction eliminate */ },
  onPause()      { /* TODO 暂停/恢复盲注 */ },
  onEndGame()    { wx.navigateTo({ url: '/pages/game-settle/game-settle?id=' + this.data.gameId }) },
  onShare() {
    return {
      title: `邀你加入「${this.data.game?.name || 'Stax 牌局'}」`,
      path: '/pages/game-join/game-join?code=' + (this.data.game?.inviteCode || '')
    }
  },
  onShareAppMessage() { return this.onShare() }
})
