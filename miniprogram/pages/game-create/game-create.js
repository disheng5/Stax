// pages/game-create/game-create.js — 创建牌局
const { formatDate } = require('../../utils/format.js')
const { isMeaningfulNickname, readLocalProfile } = require('../../utils/user.js')
const app = getApp()

const NAME_ADJECTIVES = [
  '深夜',
  '周末',
  '欢乐',
  '激烈',
  '经典',
  '传奇',
  '硬核',
  '友谊',
  '神秘',
  '必胜'
]
const NAME_NOUNS = ['局', '约局', '夜局', '桌局', '鏖战', '对局', '切磋', '江湖局']

function genGameName(nickname) {
  const adj = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)]
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)]
  const dateStr = formatDate(new Date()).slice(5)
  const host = nickname ? nickname + '的' : ''
  return `${host}${adj}${noun}（${dateStr}）`
}

Page({
  data: {
    name: '',
    buyIn: 500,
    smallBlind: 5,
    bigBlind: 5,
    blindUpMinutes: 999,
    playerOpsShared: true,
    scoreRatio: 1,
    ratioOptions: [1, 5, 10, 20, 50, 100],
    ratioIndex: 0,
    submitting: false
  },

  onLoad() {
    const def = app.globalData.defaultBlind || { sb: 5, bb: 5, blindUpMinutes: 999 }
    const profile = readLocalProfile(app.globalData.openid) || {}
    const nickname = profile.nickname || app.globalData.userDoc?.nickname || ''
    this.setData({
      name: genGameName(nickname),
      buyIn: app.globalData.defaultBuyIn || 500,
      smallBlind: def.sb || 5,
      bigBlind: def.bb || 5,
      blindUpMinutes: 999,
      scoreRatio: app.globalData.defaultScoreRatio || 1,
      ratioIndex: 0
    })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },
  onBuyInInput(e) {
    this.setData({ buyIn: Number(e.detail.value) || 0 })
  },
  onSbInput(e) {
    this.setData({ smallBlind: Number(e.detail.value) || 0 })
  },
  onBbInput(e) {
    this.setData({ bigBlind: Number(e.detail.value) || 0 })
  },
  onPlayerOpsSharedChange(e) {
    this.setData({ playerOpsShared: !!e.detail.value })
  },
  onRatioChange(e) {
    const idx = Number(e.detail.value)
    const ratio = this.data.ratioOptions[idx] || 1
    this.setData({ ratioIndex: idx, scoreRatio: ratio })
  },

  async onSubmit() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写局名', icon: 'none' })
      return
    }
    if (this.data.buyIn <= 0) {
      wx.showToast({ title: '买入额需大于 0', icon: 'none' })
      return
    }
    if (this.data.smallBlind <= 0 || this.data.bigBlind <= 0) {
      wx.showToast({ title: '大小盲需大于 0', icon: 'none' })
      return
    }

    await app.globalData.openidReady
    await app.refreshCurrentUser()
    const profile = readLocalProfile(app.globalData.openid)
    if (!isMeaningfulNickname(profile.nickname)) {
      wx.showModal({
        title: '先完善资料',
        content: '设置昵称和头像后，牌友才能认出你',
        confirmText: '去设置',
        success: r => {
          if (r.confirm) wx.navigateTo({ url: '/pages/profile/profile?firstTime=1' })
        }
      })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '创建中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'createGame',
        data: {
          name: this.data.name.trim(),
          buyIn: Number(this.data.buyIn),
          smallBlind: Number(this.data.smallBlind),
          bigBlind: Number(this.data.bigBlind),
          blindUpMinutes: Number(this.data.blindUpMinutes),
          playerOpsShared: this.data.playerOpsShared,
          scoreRatio: Number(this.data.scoreRatio) || 1,
          nickname: profile.nickname || '玩家',
          avatar: profile.avatar || ''
        }
      })
      wx.hideLoading()
      const { ok, gameId, error } = res.result || {}
      if (!ok) {
        wx.showToast({
          title: error === 'PROFILE_REQUIRED' ? '请先完善真实昵称' : error || '创建失败',
          icon: 'none'
        })
        return
      }
      wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${gameId}` })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
