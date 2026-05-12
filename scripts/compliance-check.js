#!/usr/bin/env node
// scripts/compliance-check.js — 合规扫描（仅报赌博/赢钱/赌资/虚拟筹码买卖；术语词典里的 bet/blind 不计）
const fs = require('fs')
const path = require('path')

const BLACKLIST = ['赌博', '赢钱', '赌资', '虚拟筹码买卖']
// 出现在反向声明的允许位置（白名单）
// 命中规则：文件路径完全匹配 + 当前行包含 context 之一
const ALLOW = [
  { file: 'README.md',                  contexts: ['严禁用于任何形式的赌博活动'] },
  { file: 'docs/PRIVACY.md',            contexts: ['严禁用于任何形式的赌博活动'] },
  { file: 'docs/DEPLOY.md',             contexts: ['全代码搜索', 'grep -RIn'] },
  { file: 'miniprogram/app.js',         contexts: ['严禁用于任何形式的赌博活动'] },
  { file: 'miniprogram/pages/about/about.wxml', contexts: ['严禁用于任何形式的赌博活动'] }
]

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, acc)
    else if (/\.(js|wxml|wxss|json|md)$/.test(ent.name)) acc.push(full)
  }
  return acc
}

const root = path.resolve(__dirname, '..')
const files = walk(root)
const hits = []
for (const f of files) {
  const rel = path.relative(root, f)
  if (rel.startsWith('scripts/compliance-check.js')) continue   // 跳过自身
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const word of BLACKLIST) {
      if (!line.includes(word)) continue
      const allowed = ALLOW.some(a => rel === a.file && a.contexts.some(ctx => line.includes(ctx)))
      if (!allowed) hits.push({ file: rel, line: i + 1, word, text: line.trim().slice(0, 120) })
    }
  })
}

if (hits.length === 0) {
  console.log('✓ 合规扫描通过：无可疑敏感词')
  process.exit(0)
}
console.error('✗ 合规扫描失败，发现以下命中：')
hits.forEach(h => console.error(`  ${h.file}:${h.line}  [${h.word}]  ${h.text}`))
process.exit(1)
