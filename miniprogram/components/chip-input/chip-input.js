// components/chip-input/chip-input.js — 数字步进/输入框
Component({
  properties: {
    value: { type: Number, value: 0 },
    step: { type: Number, value: 100 },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 999999 },
    label: { type: String, value: '' }
  },
  methods: {
    onMinus() {
      const v = Math.max(this.data.min, Number(this.data.value) - this.data.step)
      this.triggerEvent('change', { value: v })
    },
    onPlus() {
      const v = Math.min(this.data.max, Number(this.data.value) + this.data.step)
      this.triggerEvent('change', { value: v })
    },
    onInput(e) {
      const v = Math.max(this.data.min, Math.min(this.data.max, Number(e.detail.value) || 0))
      this.triggerEvent('change', { value: v })
    }
  }
})
