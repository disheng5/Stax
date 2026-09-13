const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')

module.exports = function loadHandler(name, db, options = {}) {
  const file = path.resolve(__dirname, '../../cloudfunctions', name, 'index.js')
  const exports = {}
  const cloud = {
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: options.openid ?? 'host' }),
    callFunction: options.callFunction || (async () => ({ result: { ok: true } }))
  }
  vm.runInNewContext(
    fs.readFileSync(file, 'utf8'),
    {
      exports,
      require: name => (name === 'wx-server-sdk' ? cloud : createRequire(file)(name)),
      console,
      Date,
      Set,
      Map,
      Math
    },
    { filename: file }
  )
  return exports.main
}
