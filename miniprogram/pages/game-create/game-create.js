// pages/game-create/game-create.js — 创建朋友局积分记录
const { isMeaningfulNickname, readLocalProfile } = require('../../utils/user.js')
const {
  MAX_GAME_NAME_LENGTH,
  buildDefaultGameName,
  hasRiskyGameName,
  normalizeGameName
} = require('../../utils/game-name.js')
const { cacheGame, markGamesChanged } = require('../../utils/game-data.js')
const { rememberCompleteGame } = require('../../utils/game-view.js')
const { createOperationId } = require('../../utils/operation.js')
const app = getApp()

const SCORE_PRESETS = [
  { label: '500 · 5/5', buyIn: 500, smallBlind: 5, bigBlind: 5 },
  { label: '1000 · 5/10', buyIn: 1000, smallBlind: 5, bigBlind: 10 },
  { label: '2000 · 10/20', buyIn: 2000, smallBlind: 10, bigBlind: 20 }
]

function findPresetIndex(buyIn, smallBlind, bigBlind) {
  return SCORE_PRESETS.findIndex(
    item => item.buyIn === buyIn && item.smallBlind === smallBlind && item.bigBlind === bigBlind
  )
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
    maxNameLength: MAX_GAME_NAME_LENGTH,
    scorePresets: SCORE_PRESETS,
    presetIndex: -1,
    showAdvanced: false,
    submitting: false
  },

  onLoad() {
    const def = app.globalData.defaultBlind || { sb: 5, bb: 5, blindUpMinutes: 999 }
    const profile = readLocalProfile(app.globalData.openid) || {}
    const nickname = profile.nickname || app.globalData.userDoc?.nickname || ''
    let saved = {}
    const openid = app.globalData.openid || wx.getStorageSync('last_openid')
    try {
      saved = (openid && wx.getStorageSync(`stax_create_defaults_${openid}`)) || {}
    } catch (_) {}
    const positive = (value, fallback) =>
      Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
    const buyIn = positive(saved.buyIn, Number(app.globalData.defaultBuyIn) || 500)
    const smallBlind = positive(saved.smallBlind, Number(def.sb) || 5)
    const bigBlind = positive(saved.bigBlind, Number(def.bb) || 5)
    const scoreRatio = positive(saved.scoreRatio, Number(app.globalData.defaultScoreRatio) || 1)
    const ratioIndex = this.data.ratioOptions.indexOf(scoreRatio)
    this.setData({
      name: buildDefaultGameName(nickname),
      buyIn,
      smallBlind,
      bigBlind,
      blindUpMinutes: 999,
      scoreRatio,
      playerOpsShared: saved.playerOpsShared !== false,
      ratioIndex: ratioIndex >= 0 ? ratioIndex : 0,
      presetIndex: findPresetIndex(buyIn, smallBlind, bigBlind)
    })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },
  onNameBlur(e) {
    const name = normalizeGameName(e.detail.value)
    if (name && !hasRiskyGameName(name)) this.setData({ name })
  },
  onBuyInInput(e) {
    this.setData({ buyIn: Number(e.detail.value) || 0, presetIndex: -1 })
  },
  onSbInput(e) {
    this.setData({ smallBlind: Number(e.detail.value) || 0, presetIndex: -1 })
  },
  onBbInput(e) {
    this.setData({ bigBlind: Number(e.detail.value) || 0, presetIndex: -1 })
  },
  onPresetTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    const preset = SCORE_PRESETS[index]
    if (!preset) return
    this.setData({
      buyIn: preset.buyIn,
      smallBlind: preset.smallBlind,
      bigBlind: preset.bigBlind,
      presetIndex: index
    })
  },
  onAdvancedToggle() {
    this.setData({ showAdvanced: !this.data.showAdvanced })
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
    if (this.data.submitting) return
    const rawName = this.data.name.trim()
    if (!rawName) {
      wx.showToast({ title: '请填写记录名', icon: 'none' })
      return
    }
    if (hasRiskyGameName(rawName)) {
      wx.showToast({ title: '名称仅用于娱乐积分记录，请调整表述', icon: 'none' })
      return
    }
    const normalizedName = normalizeGameName(rawName)
    if (normalizedName !== this.data.name) this.setData({ name: normalizedName })
    if (!Number.isFinite(Number(this.data.buyIn)) || this.data.buyIn <= 0) {
      wx.showToast({ title: '每份积分需大于 0', icon: 'none' })
      return
    }
    if (
      ![this.data.smallBlind, this.data.bigBlind].every(n => Number.isFinite(Number(n)) && n > 0)
    ) {
      wx.showToast({ title: '大小盲需大于 0', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    const settings = {
      buyIn: Number(this.data.buyIn),
      smallBlind: Number(this.data.smallBlind),
      bigBlind: Number(this.data.bigBlind),
      blindUpMinutes: Number(this.data.blindUpMinutes),
      playerOpsShared: this.data.playerOpsShared,
      scoreRatio: Number(this.data.scoreRatio) || 1
    }
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      if (!openid) throw new Error('IDENTITY_UNAVAILABLE')
      let profile = readLocalProfile(openid)
      if (!isMeaningfulNickname(profile.nickname)) {
        await app.refreshCurrentUser().catch(() => null)
        profile = readLocalProfile(openid)
      }
      if (!isMeaningfulNickname(profile.nickname)) {
        const completed = await this.selectComponent('#create-profile').request({
          showHands: false,
          title: '完善资料',
          confirmText: '继续创建'
        })
        if (!completed || this._unloaded) return
        profile = completed.profile
      }
      if (this._unloaded) return
      const payload = { name: normalizedName, ...settings }
      const signature = JSON.stringify([openid, payload])
      if (this._createRequest?.signature !== signature) {
        this._createRequest = { signature, operationId: createOperationId('create') }
      }
      if (this._createRequest.gameId) {
        wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${this._createRequest.gameId}` })
        return
      }
      const create = currentProfile =>
        wx.cloud.callFunction({
          name: 'createGame',
          data: {
            ...payload,
            operationId: this._createRequest.operationId,
            nickname: currentProfile.nickname || '玩家',
            avatar: currentProfile.avatar || ''
          }
        })

      let res = await create(profile)
      if (res.result && res.result.error === 'PROFILE_REQUIRED') {
        // 仅在旧资料异常时多一次请求；正常创建路径没有额外开销。
        await app.refreshCurrentUser({ force: true }).catch(() => null)
        profile = readLocalProfile(app.globalData.openid)
        if (isMeaningfulNickname(profile.nickname)) res = await create(profile)
      }
      const { ok, gameId, game, transactions, error } = res.result || {}
      if (!ok) {
        const errorMessages = {
          PROFILE_REQUIRED: '请先完善真实昵称',
          CONFLICT_RETRY: '创建冲突，请重试'
        }
        wx.showToast({
          title: errorMessages[error] || require('../../utils/errors.js').errorMessage(error),
          icon: 'none'
        })
        return
      }
      this._createRequest.gameId = gameId
      try {
        wx.setStorageSync(`stax_create_defaults_${openid}`, settings)
      } catch (_) {}
      markGamesChanged()
      if (game && Array.isArray(transactions)) rememberCompleteGame(game, transactions)
      else if (game) cacheGame(game)
      if (!this._unloaded) wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${gameId}` })
    } catch (err) {
      console.error(err)
      if (!this._unloaded) wx.showToast({ title: '暂未确认创建结果，请重试', icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ submitting: false })
    }
  },

  onUnload() {
    this._unloaded = true
  }
})
