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
    joining: false
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
              viewerMode: this.data.viewerMode || !isPlayer,
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
        .limit(10)
        .get()
      const nameMap = {}
      ;(this.data.game?.players || []).forEach(p => {
        nameMap[p.openid] = p.nickname
      })
      const recentTx = res.data.map(t => ({ ...t, nickname: nameMap[t.playerOpenid] || '某玩家' }))
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
    const buyIn = Number(this.data.game.buyIn || 0)
    wx.showModal({
      title: `${title} 几手`,
      editable: true,
      placeholderText: '1',
      success: r => {
        if (!r.confirm) return
        const hands = Math.floor(Number(r.content || 1) || 0)
        if (hands <= 0) {
          wx.showToast({ title: '手数需 > 0', icon: 'none' })
          return
        }
        this._record(type, openid, hands * buyIn, { hands })
      }
    })
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
      title: `「${g?.name || 'Stax 牌局'}」${playerN} 人在打，总池 ${pot}`,
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
