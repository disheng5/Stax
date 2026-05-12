// components/player-card/player-card.js — 玩家卡片
Component({
  properties: {
    player: { type: Object, value: {} },
    isHost: { type: Boolean, value: false },
    gameStatus: { type: String, value: 'ongoing' }
  },
  methods: {
    onRebuy() { this.triggerEvent('rebuy', { openid: this.data.player.openid }) },
    onAddOn() { this.triggerEvent('addon', { openid: this.data.player.openid }) },
    onEliminate() { this.triggerEvent('eliminate', { openid: this.data.player.openid }) }
  }
})
