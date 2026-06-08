Component({
  properties: {
    player: { type: Object, value: {} },
    isHost: { type: Boolean, value: false },
    isSelf: { type: Boolean, value: false },
    gameStatus: { type: String, value: 'ongoing' },
    canSelfOperate: { type: Boolean, value: true },
    isWinner: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      this.triggerEvent('playertap', {
        openid: this.data.player.openid,
        player: this.data.player,
        isSelf: this.data.isSelf,
        isHost: this.data.isHost
      })
    }
  }
})
