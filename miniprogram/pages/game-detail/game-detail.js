// pages/game-detail/game-detail.js — 牌局详情（核心页）
const app = getApp()

const TX_TYPE_LABEL = {
  buyIn: '初次买入', rebuy: 'Rebuy', addOn: 'Add-on',
  eliminate: '淘汰', settle: '结算'
}

Page({
  data: {
    gameId: '',
    game: null,
    isHost: false,
    myOpenid: '',
    loading: true,
    recentTx: [],
    txTypeLabel: TX_TYPE_LABEL
  },

  async onLoad(options) {
    this.setData({ gameId: options.id || '' })
    await this._ensureOpenid()
    this._startWatch()
  },

  onShow() {
    if (!this.watcher && this.data.gameId) this._startWatch()
    if (this.data.gameId) this._fetchRecentTx()
  },

  onUnload() {
    if (this.watcher) { try { this.watcher.close() } catch (_) {} this.watcher = null }
  },

  async _ensureOpenid() {
    if (app.globalData.openid) {
      this.setData({ myOpenid: app.globalData.openid })
      return
    }
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.openid) {
        app.globalData.openid = res.result.openid
        this.setData({ myOpenid: res.result.openid })
      }
    } catch (err) { console.error('[whoami]', err) }
  },

  _startWatch() {
    const db = wx.cloud.database()
    if (!this.data.gameId) { this.setData({ loading: false }); return }
    this.watcher = db.collection('games').doc(this.data.gameId).watch({
      onChange: snapshot => {
        if (snapshot.docs && snapshot.docs.length) {
          const game = snapshot.docs[0]
          const myOpenid = this.data.myOpenid
          const isHost = !!myOpenid && game.hostOpenid === myOpenid
          this.setData({ game, isHost, loading: false })
          this._fetchRecentTx()
        } else {
          this.setData({ game: null, loading: false })
        }
      },
      onError: err => {
        console.error('[watch] error', err)
        this.setData({ loading: false })
        wx.showToast({ title: '实时同步失败，请重试', icon: 'none' })
      }
    })
  },

  async _fetchRecentTx() {
    if (!this.data.gameId) return
    try {
      const db = wx.cloud.database()
      const res = await db.collection('transactions')
        .where({ gameId: this.data.gameId })
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get()
      const nameMap = {}
      ;(this.data.game?.players || []).forEach(p => { nameMap[p.openid] = p.nickname })
      const recentTx = res.data.map(t => ({ ...t, nickname: nameMap[t.playerOpenid] || '某玩家' }))
      this.setData({ recentTx })
    } catch (err) { console.error(err) }
  },

  // ===== 操作 =====
  async _record(type, playerOpenid, amount = 0) {
    wx.showLoading({ title: '处理中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'recordTransaction',
        data: { gameId: this.data.gameId, type, playerOpenid, amount }
      })
      wx.hideLoading()
      if (!res.result || !res.result.ok) {
        const err = res.result && res.result.error
        const msg = {
          NOT_HOST: '仅庄家可操作',
          CAN_ONLY_BUY_FOR_SELF: '只能给自己补码',
          GAME_ENDED: '牌局已结束'
        }[err] || err || '操作失败'
        wx.showToast({ title: msg, icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading(); console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // 庄家：代任意玩家补码
  onRebuy(e)     { this._promptAmount('代补 (Rebuy)', e.detail.openid, 'rebuy') },
  onAddOn(e)     { this._promptAmount('代补 (Add-on)', e.detail.openid, 'addOn') },
  // 参与人：自助补码
  onSelfRebuy(e) { this._promptAmount('我要补码', e.detail.openid, 'rebuy') },
  // 庄家：淘汰
  onEliminate(e) {
    const openid = e.detail.openid
    wx.showModal({
      title: '确认淘汰',
      content: '确认将该玩家标记为淘汰？',
      success: r => { if (r.confirm) this._record('eliminate', openid) }
    })
  },

  // 庄家：撤销最近一条 rebuy/addOn
  onRevokeTx(e) {
    const txId = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤销该笔补码',
      content: '将回退该玩家的买入额与次数，且操作不可再次撤销',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '撤销中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'recordTransaction',
            data: { gameId: this.data.gameId, type: 'revoke', txId }
          })
          wx.hideLoading()
          if (!res.result?.ok) wx.showToast({ title: res.result?.error || '撤销失败', icon: 'none' })
          else { wx.showToast({ title: '已撤销', icon: 'success' }); this._fetchRecentTx() }
        } catch (err) {
          wx.hideLoading(); console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  _promptAmount(title, openid, type) {
    const def = String(this.data.game.buyIn)
    wx.showModal({
      title: `${title} 金额`,
      editable: true,
      placeholderText: def,
      success: r => {
        if (!r.confirm) return
        const amount = Number(r.content || def) || 0
        if (amount <= 0) { wx.showToast({ title: '金额需 > 0', icon: 'none' }); return }
        this._record(type, openid, amount)
      }
    })
  },

  onPause()  { this._record('pauseToggle', this.data.myOpenid) },
  onLevelUp(){ this._record('levelUp', this.data.myOpenid) },

  onTimeUp() {
    if (!this.data.isHost) return
    const next = this.data.game.blindStructure[this.data.game.currentLevel + 1]
    wx.showModal({
      title: '盲注时间到',
      content: next ? `升至下一级 ${next.sb}/${next.bb}？` : '已到顶级，是否重置计时？',
      success: r => { if (r.confirm) this.onLevelUp() }
    })
  },

  onEndGame() {
    if (!this.data.isHost) {
      wx.showToast({ title: '仅庄家可结算', icon: 'none' }); return
    }
    wx.navigateTo({ url: '/pages/game-settle/game-settle?id=' + this.data.gameId })
  },

  onCopyCode() {
    wx.setClipboardData({ data: this.data.game.inviteCode, success: () => wx.showToast({ title: '邀请码已复制' }) })
  },

  onShareAppMessage() {
    return {
      title: `邀你加入「${this.data.game?.name || 'Stax 牌局'}」`,
      path: '/pages/game-join/game-join?code=' + (this.data.game?.inviteCode || '')
    }
  }
})
