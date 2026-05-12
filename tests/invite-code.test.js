// tests/invite-code.test.js — 邀请码生成单元测试
const assert = require('assert')
const { generateInviteCode, ALPHABET } = require('../miniprogram/utils/invite-code.js')

function run(name, fn) {
  try { fn(); console.log('  \u2713', name) }
  catch (err) { console.error('  \u2717', name, '\n   ', err.message); process.exitCode = 1 }
}

console.log('generateInviteCode()')

run('默认长度为 6', () => {
  for (let i = 0; i < 100; i++) assert.strictEqual(generateInviteCode().length, 6)
})

run('字符集不含 0/O/1/I', () => {
  assert.strictEqual(ALPHABET.includes('0'), false)
  assert.strictEqual(ALPHABET.includes('O'), false)
  assert.strictEqual(ALPHABET.includes('1'), false)
  assert.strictEqual(ALPHABET.includes('I'), false)
})

run('生成的码全部由字符集字符组成', () => {
  for (let i = 0; i < 1000; i++) {
    const c = generateInviteCode()
    for (const ch of c) assert.ok(ALPHABET.includes(ch), `非法字符 ${ch}`)
  }
})

run('10 万次生成，碰撞率 < 1%', () => {
  const N = 100000
  const seen = new Set()
  for (let i = 0; i < N; i++) seen.add(generateInviteCode())
  const dup = N - seen.size
  console.log(`    10 万次生成，重复 ${dup} 个（${(dup / N * 100).toFixed(3)}%）`)
  assert.ok(dup / N < 0.01, '碰撞率应 < 1%')
})
