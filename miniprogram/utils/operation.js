// 关键写操作的客户端请求编号：用于审计与云函数重放去重。
let sequence = 0

function createOperationId(scope = 'op') {
  sequence = (sequence + 1) % 1679616
  const prefix =
    String(scope)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 16) || 'op'
  const time = Date.now().toString(36)
  const seq = sequence.toString(36).padStart(4, '0')
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `${prefix}_${time}_${seq}_${random}`
}

module.exports = { createOperationId }
