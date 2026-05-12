// components/player-card/player-card.js
Component({
  properties: {
    player:     { type: Object,  value: {} },
    isHost:     { type: Boolean, value: false },
    isSelf:     { type: Boolean, value: false },     // 当前查看者就是这位玩家
    gameStatus: { type: String,  value: 'ongoing' }
  },
  methods: {
    onRebuy()      { this.triggerEvent('rebuy',     { openid: this.data.player.openid }) },
    onAddOn()      { this.triggerEvent('addon',     { openid: this.data.player.openid }) },
    onEliminate()  { this.triggerEvent('eliminate', { openid: this.data.player.openid }) },
    onSelfRebuy()  { this.triggerEvent('selfrebuy', { openid: this.data.player.openid }) }
  }
})
