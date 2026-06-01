const { getYesterdayWord } = require('../../utils/dailyWord.js')

Component({
  properties: {
    word: { type: String, value: '' },
    note: { type: String, value: '' },
    date: { type: String, value: '' },
    openid: { type: String, value: '' },
    nickname: { type: String, value: '' }
  },
  data: {
    dateDisplay: '',
    animating: true,
    showYesterday: false,
    yesterdayWord: '',
    yesterdayNote: ''
  },
  observers: {
    date: function (d) {
      if (!d) return
      const parts = d.split('-')
      this.setData({ dateDisplay: parts[0] + '年' + parts[1] + '月' + parts[2] + '日' })
    }
  },
  lifetimes: {
    attached() {
      setTimeout(() => this.setData({ animating: false }), 900)
    }
  },
  methods: {
    onLongPress() {
      const yw = getYesterdayWord(this.data.openid)
      this.setData({ showYesterday: true, yesterdayWord: yw.word, yesterdayNote: yw.note })
      setTimeout(() => this.setData({ showYesterday: false }), 2500)
    }
  }
})
