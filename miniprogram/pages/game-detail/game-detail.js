// pages/game-detail/game-detail.js — 牌局详情（核心页）
const app = getApp()

const TX_TYPE_LABEL = {
  buyIn: '初次买入',
  rebuy: 'Rebuy',
  addOn: 'Add-on',
  eliminate: '淘汰',
  settle: '结算',
  settlePartial: '下桌'
}

Page({
  data: {
    gameId: '',
    inviteCode: '',
    game: null,
    isHost: false,
    myOpenid: '',
    loading: true,
    recentTx: [],
    txTypeLabel: TX_TYPE_LABEL,
    viewerMode: false,
    isPlayer: false,
    showTimer: false,
    joining: false,
    handsPicker: { show: false, title: '', openid: '', type: '', hands: 1 }
  },

  async onLoad(options) {
    this.setData({
      gameId: options.id || '',
      inviteCode: (options.code || '').toUpperCase(),
      viewerMode: options.mode === 'viewer'
    })
    await this._ensureOpenid()
    this._startWatch()
  },

  onShow() {
    if (!this.watcher && this.data.gameId) this._startWatch()
    if (this.data.gameId) this._fetchRecentTx()
    if (this.data.game && this.data.myOpenid) {
      const isPlayer = (this.data.game.players || []).some(p => p.openid === this.data.myOpenid)
      if (isPlayer && this.data.viewerMode) {
        this.setData({ viewerMode: false, isPlayer: true })
      }
    }
  },

  onUnload() {
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch (_) {}
      this.watcher = null
    }
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
    } catch (err) {
      console.error('[whoami]', err)
    }
  },

  _startWatch() {
    const db = wx.cloud.database()
    if (!this.data.gameId) {
      this.setData({ loading: false })
      return
    }
    this.watcher = db
      .collection('games')
      .doc(this.data.gameId)
      .watch({
        onChange: snapshot => {
          if (snapshot.docs && snapshot.docs.length) {
            const game = snapshot.docs[0]
            const myOpenid = this.data.myOpenid
            const isHost = !!myOpenid && game.hostOpenid === myOpenid
            const isPlayer = !!myOpenid && (game.players || []).some(p => p.openid === myOpenid)
            this.setData({
              game,
              isHost,
              isPlayer,
              viewerMode: !isPlayer,
              loading: false
            })
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
      const res = await db
        .collection('transactions')
        .where({ gameId: this.data.gameId })
        .orderBy('timestamp', 'desc')
        .limit(30)
        .get()
      const nameMap = {}
      ;(this.data.game?.players || []).forEach(p => {
        nameMap[p.openid] = p.nickname
      })
      const buyIn = Number(this.data.game?.buyIn || 0)
      // 按时间正序累计每位玩家到此为止的总手数与总码量
      const asc = res.data.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      const totalHands = {}
      const totalAmount = {}
      const handsMap = {}
      const accHandsMap = {}
      const accAmountMap = {}
      asc.forEach(t => {
        const isBuy =
          t.type === 'buyIn' || ((t.type === 'rebuy' || t.type === 'addOn') && !t.revoked)
        const isRevoke =
          t.type === 'revoke' || ((t.type === 'rebuy' || t.type === 'addOn') && t.revoked)
        let h = 0
        if (t.type === 'buyIn') h = 1
        else if (t.type === 'rebuy' || t.type === 'addOn') {
          h =
            Number(t.meta?.hands) ||
            (buyIn > 0 ? Math.max(1, Math.round((t.amount || 0) / buyIn)) : 1)
        }
        handsMap[t._id] = h
        if (isBuy) {
          totalHands[t.playerOpenid] = (totalHands[t.playerOpenid] || 0) + h
          totalAmount[t.playerOpenid] = (totalAmount[t.playerOpenid] || 0) + (Number(t.amount) || 0)
        }
        accHandsMap[t._id] = totalHands[t.playerOpenid] || 0
        accAmountMap[t._id] = totalAmount[t.playerOpenid] || 0
      })
      const recentTx = res.data.slice(0, 10).map(t => {
        const d = t.timestamp ? new Date(t.timestamp) : null
        const timeStr = d
          ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : ''
        return {
          ...t,
          nickname: nameMap[t.playerOpenid] || '某玩家',
          hands: handsMap[t._id] || 0,
          accHands: accHandsMap[t._id] || 0,
          accAmount: accAmountMap[t._id] || 0,
          timeStr
        }
      })
      this.setData({ recentTx })
    } catch (err) {
      console.error(err)
    }
  },

  // ===== 操作 =====
  async _record(type, playerOpenid, amount = 0, extra = {}) {
    wx.showLoading({ title: '处理中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'recordTransaction',
        data: { gameId: this.data.gameId, type, playerOpenid, amount, ...extra }
      })
      wx.hideLoading()
      if (!res.result || !res.result.ok) {
        const err = res.result && res.result.error
        const msg =
          {
            NOT_HOST: '仅庄家可操作',
            CAN_ONLY_BUY_FOR_SELF: '只能给自己补码',
            GAME_ENDED: '牌局已结束'
          }[err] ||
          err ||
          '操作失败'
        wx.showToast({ title: msg, icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  onRebuy(e) {
    this._promptAmount('帮他补码', e.detail.openid, 'rebuy')
  },
  onAddOn(e) {
    this._promptAmount('代补 (Add-on)', e.detail.openid, 'addOn')
  },
  onSelfRebuy(e) {
    this._promptAmount('补码', e.detail.openid, 'rebuy')
  },
  onEliminate(e) {
    const openid = e.detail.openid
    wx.showModal({
      title: '踢出该玩家',
      content: '该玩家将不再参与本局结算，确认踢人？',
      confirmText: '踢人',
      confirmColor: '#C8102E',
      success: r => {
        if (r.confirm) this._record('eliminate', openid)
      }
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
          if (!res.result?.ok)
            wx.showToast({ title: res.result?.error || '撤销失败', icon: 'none' })
          else {
            wx.showToast({ title: '已撤销', icon: 'success' })
            this._fetchRecentTx()
          }
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  _promptAmount(title, openid, type) {
    this.setData({
      handsPicker: { show: true, title, openid, type, hands: 1 }
    })
  },

  onHandsClose() {
    this.setData({ 'handsPicker.show': false })
  },

  onHandsStop() {
    /* 阻止冒泡 */
  },

  onHandsMinus() {
    const cur = this.data.handsPicker.hands || 1
    if (cur <= 1) return
    this.setData({ 'handsPicker.hands': cur - 1 })
  },

  onHandsPlus() {
    const cur = this.data.handsPicker.hands || 1
    if (cur >= 99) return
    this.setData({ 'handsPicker.hands': cur + 1 })
  },

  onHandsInput(e) {
    const v = Math.max(1, Math.min(99, Math.floor(Number(e.detail.value) || 1)))
    this.setData({ 'handsPicker.hands': v })
  },

  onHandsConfirm() {
    const { openid, type, hands } = this.data.handsPicker
    const n = Math.max(1, Math.floor(Number(hands) || 1))
    const buyIn = Number(this.data.game.buyIn || 0)
    this.setData({ 'handsPicker.show': false })
    this._record(type, openid, n * buyIn, { hands: n })
  },

  onPause() {
    this._record('pauseToggle', this.data.myOpenid)
  },
  onLevelUp() {
    this._record('levelUp', this.data.myOpenid)
  },

  onToggleTimer() {
    this.setData({ showTimer: !this.data.showTimer })
  },

  onTimeUp() {
    if (!this.data.isHost) return
    const next = this.data.game.blindStructure[this.data.game.currentLevel + 1]
    wx.showModal({
      title: '盲注时间到',
      content: next ? `升至下一级 ${next.sb}/${next.bb}？` : '已到顶级，是否重置计时？',
      success: r => {
        if (r.confirm) this.onLevelUp()
      }
    })
  },

  onSettleSelf() {
    if (this.data.game?.playerOpsShared === false && !this.data.isHost) {
      wx.showToast({ title: '本局由房主统一操作', icon: 'none' })
      return
    }
    const me = (this.data.game?.players || []).find(p => p.openid === this.data.myOpenid)
    if (!me) return
    wx.showModal({
      title: '下桌筹码',
      editable: true,
      placeholderText: String(me.currentStack || 0),
      success: async r => {
        if (!r.confirm) return
        const finalStack = Number(r.content || me.currentStack || 0)
        if (finalStack < 0) {
          wx.showToast({ title: '筹码不能小于 0', icon: 'none' })
          return
        }
        wx.showLoading({ title: '记录中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'settleGame',
            data: {
              gameId: this.data.gameId,
              mode: 'checkout',
              finalStacks: { [this.data.myOpenid]: finalStack }
            }
          })
          wx.hideLoading()
          if (!res.result?.ok) {
            wx.showToast({ title: res.result?.error || '下桌失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已下桌，等待结算', icon: 'success' })
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onEndGame() {
    if (!this.data.isPlayer || this.data.viewerMode) {
      wx.showToast({ title: '上桌玩家才能发起结算', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/game-settle/game-settle?id=' + this.data.gameId })
  },

  onCopyCode() {
    wx.setClipboardData({
      data: this.data.game.inviteCode,
      success: () => wx.showToast({ title: '邀请码已复制' })
    })
  },

  async onJoinAsPlayer() {
    if (this.data.joining) return
    if (!this.data.game) return
    const code = this.data.inviteCode || this.data.game.inviteCode
    if (!code) {
      wx.showToast({ title: '缺少邀请码', icon: 'none' })
      return
    }
    this.setData({ joining: true })
    wx.showLoading({ title: '上桌中…' })
    try {
      const { readLocalProfile } = require('../../utils/user.js')
      const profile = readLocalProfile() || {}
      const res = await wx.cloud.callFunction({
        name: 'joinGame',
        data: {
          inviteCode: code,
          nickname: profile.nickname || '玩家',
          avatar: profile.avatar || '',
          mode: 'player'
        }
      })
      wx.hideLoading()
      const { ok, error, alreadyJoined } = res.result || {}
      if (!ok) {
        wx.showToast({
          title: error === 'GAME_NOT_FOUND' ? '牌局已结束' : error || '上桌失败',
          icon: 'none'
        })
        return
      }
      if (alreadyJoined) wx.showToast({ title: '你已经在桌上', icon: 'none' })
      this.setData({ viewerMode: false })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ joining: false })
    }
  },

  onShareAppMessage() {
    const g = this.data.game
    const playerN = g?.players?.length || 0
    const pot = g?.totalPot || 0
    return {
      title: `「${g?.name || 'StaxKit 牌局'}」${playerN} 人在打，总池 ${pot}`,
      path:
        '/pages/game-detail/game-detail?id=' +
        this.data.gameId +
        '&code=' +
        (g?.inviteCode || '') +
        '&mode=viewer',
      imageUrl: '' // 可后续加结算图作为分享图
    }
  }
})
