module.exports = {
  root: true,
  env: { es2021: true, browser: true, node: true },
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  globals: {
    wx: 'readonly',
    App: 'readonly',
    Page: 'readonly',
    Component: 'readonly',
    Behavior: 'readonly',
    getApp: 'readonly',
    getCurrentPages: 'readonly'
  },
  rules: {
    indent: ['error', 2],
    semi: ['error', 'never'],
    quotes: ['error', 'single'],
    'no-unused-vars': ['warn']
  }
}
