// Structural smoke test for the client half: evaluates lib/client.js against a fake
// module loader and React, then asserts the module contract and slot registrations.
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

let factory = null
const listeners = []
const fakeWindow = {
  __ModuleLoader__: {
    load: (spec) => {
      factory = spec.factory
      return spec
    },
  },
  addEventListener: (type) => { listeners.push(type) },
  removeEventListener: () => {},
  dispatchEvent: () => {},
  CustomEvent: class {},
  fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, items: [] }) }),
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
}

const requireStub = (id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
}

const run = new Function('window', 'require', 'console', source)
run(fakeWindow, requireStub, console)

if (!factory) throw new Error('FAIL: module loader was never called')
const mod = factory(requireStub)
const problems = []

if (!Array.isArray(mod.inject) || mod.inject.join(',') !== 'slots,locale') {
  problems.push('inject should be [slots, locale], got ' + JSON.stringify(mod.inject))
}
if (typeof mod.apply !== 'function') problems.push('apply is missing')

const registered = []
const ctx = {
  effect: (fn) => fn(),
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
}
mod.apply(ctx)

const byName = (name) => registered.find((entry) => entry.options.name === name)
if (!byName('sidebar.panellist') || byName('sidebar.panellist').options.id !== 'dsh-recycle-bin') {
  problems.push('sidebar.panellist registration is missing or has the wrong id')
}
if (typeof byName('sidebar.panellist')?.options.label !== 'function') {
  problems.push('panellist label should be a thunk so locale changes are picked up')
}
if (!byName('main') || byName('main').options.key !== 'dsh-recycle-bin') {
  problems.push('main registration is missing or has the wrong key')
}
if (!byName('sidebar.session.row.hover')) problems.push('row hover action is not registered')
if (!byName('shell.overlay')) problems.push('drop banner is not registered')
if (registered.length !== 4) problems.push('expected 4 registrations, got ' + registered.length)
for (const entry of registered) {
  if (typeof entry.component !== 'function') problems.push(entry.options.name + ' component is not a function')
}

if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL: ' + problem)
  process.exit(1)
}
console.log('ok - client module contract')
console.log('ok - 4 slot registrations: ' + registered.map((entry) => entry.options.name).join(', '))
console.log('\nALL CLIENT CHECKS PASSED')
