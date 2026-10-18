// Harness test for dsh-recycle-bin host logic: runs the real route handlers against a
// temporary DSH_HOME so nothing in the live profile is touched.
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-recycle-bin-test-'))
process.env.DSH_HOME = home

const apply = (await import('../lib/index.js')).apply

const batch = (value) => 'x'.repeat(value)
const sessionId = '11111111-2222-3333-4444-555555555555'
const second = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const expired = '99999999-8888-7777-6666-555555555555'
const bucket = join(home, 'sessions', '--tmp-scratch--')
const projections = join(home, 'storages', 'session_projcache', 'sessions')

async function seedSession(id) {
  const directory = join(bucket, id)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'session.v4.jsonl.zstd'), batch(64))
  await mkdir(projections, { recursive: true })
  await writeFile(join(projections, id + '.json'), '{}')
  return directory
}

const expiredDir = await seedSession(expired)
await seedSession(sessionId)
await seedSession(second)

// Seed an entry that already outlived its retention, before the plugin ever reads state.
await mkdir(join(home, 'recycle-bin'), { recursive: true })
await writeFile(join(home, 'recycle-bin', 'state.json'), JSON.stringify({
  version: 1,
  items: [{ sessionId: expired, title: '过期会话', workspaceTitle: '', trashedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 }],
}))

let archived = false
let attached = [sessionId]
let route = null
const known = new Set([sessionId, second, expired])
const registry = {
  list: () => [{
    id: 'ws-1',
    title: '测试工作区',
    sessionIds: attached,
    detachSession: async (id) => { attached = attached.filter((item) => item !== id) },
  }],
  archiveSession: async () => { archived = true },
  unarchiveSession: async () => { archived = false },
}
const claimed = new Set()
const persistence = {
  stat: async (id) => (known.has(id) ? {
    header: { id },
    formatStatus: { format: 'jsonl', compression: 'zstd' },
    revision: { seq: 1 },
    eventCount: 1,
    sizeBytes: 64,
  } : null),
  open: async (id) => {
    if (claimed.has(id)) { const error = new Error('session already owned'); error.name = 'SessionAlreadyOwnedError'; throw error }
    return { close: async () => {} }
  },
}

const running = new Set()
const cancelled = []
const controller = {
  list: async () => ({ items: [...known].map((id) => ({ sessionId: id, running: running.has(id) })) }),
  cancel: async (request) => { cancelled.push(typeof request === 'string' ? request : request.sessionId) },
}

const ctx = {
  effect: (factory) => factory(),
  webServer: { register: (spec) => { route = spec; return () => {} } },
  sessionPersistence: persistence,
  workspaceRegistry: registry,
  get: (name) => (name === 'sessionController' ? controller : undefined),
  emit: () => {},
}

apply(ctx)
if (!route || route.kind !== 'prefix') throw new Error('route not registered')

function call(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      url,
      headers: headers === undefined
        ? (body === undefined
          ? { 'x-dsh-recycle-bin': '1' }
          : { 'x-dsh-recycle-bin': '1', 'content-type': 'application/json' })
        : headers,
      async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk },
    }
    const res = {
      statusCode: 0,
      body: '',
      writeHead(code) { this.statusCode = code },
      end(text) { this.body = text; resolve({ status: this.statusCode, json: JSON.parse(text) }) },
    }
    route.handler(req, res)
  })
}

const ok = (condition, message) => { if (!condition) throw new Error('FAIL: ' + message); console.log('ok - ' + message) }
const gone = (path, message) => stat(path).then(
  () => { throw new Error('FAIL: ' + message) },
  () => console.log('ok - ' + message),
)

let result = await call('POST', '/dsh-recycle-bin/sweep', {}, {})
ok(result.status === 403 && !result.json.ok, 'request without the guard header is rejected')
result = await call('POST', '/dsh-recycle-bin/sweep', {}, { 'x-dsh-recycle-bin': '1', 'content-type': 'text/plain' })
ok(result.status === 403, 'POST with a non-JSON content type is rejected')
result = await call('POST', '/dsh-recycle-bin/sweep', {}, { 'x-dsh-recycle-bin': '1', 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
ok(result.status === 403, 'cross-site request is rejected')
result = await call('POST', '/dsh-recycle-bin/sweep', {})
ok(result.json.ok && result.json.removed === 1, 'sweep purges an entry past its retention window')
await gone(expiredDir, 'expired session directory removed')

result = await call('GET', '/dsh-recycle-bin/list')
ok(result.status === 200 && result.json.ok && result.json.items.length === 0, 'empty list after sweep')

result = await call('POST', '/dsh-recycle-bin/trash', { sessionId, title: '我的测试会话' })
ok(result.json.ok && archived, 'trash archives the session')
ok(result.json.item.title === '我的测试会话' && result.json.item.workspaceTitle === '测试工作区', 'trash keeps title and workspace')

result = await call('GET', '/dsh-recycle-bin/list')
ok(result.json.items.length === 1 && result.json.items[0].daysLeft === 14, 'list shows the trashed session with 14 days left')

result = await call('POST', '/dsh-recycle-bin/archive-bogus', { sessionId })
ok(result.status === 404, 'unknown action is 404')

result = await call('POST', '/dsh-recycle-bin/delete', { sessionId: 'not a valid id!' })
ok(result.status === 400, 'invalid id is rejected')

result = await call('POST', '/dsh-recycle-bin/delete', { sessionId })
ok(result.json.ok, 'delete succeeds')
await gone(join(projections, sessionId + '.json'), 'projection cache removed')
await gone(join(bucket, sessionId), 'session directory removed')
ok(attached.length === 0, 'session detached from the workspace')

result = await call('GET', '/dsh-recycle-bin/list')
ok(result.json.items.length === 0, 'recycle bin is empty after delete')

const state = JSON.parse(await readFile(join(home, 'recycle-bin', 'state.json'), 'utf8'))
ok(state.items.length === 0, 'state file rewritten')

result = await call('POST', '/dsh-recycle-bin/trash', { sessionId: second })
ok(result.json.ok, 'second session trashed')
result = await call('POST', '/dsh-recycle-bin/restore', { sessionId: second })
ok(result.json.ok && archived === false, 'restore unarchives and clears the entry')
result = await call('GET', '/dsh-recycle-bin/list')
ok(result.json.items.length === 0, 'restored session left the recycle bin')

// The sidebar drag payload is a row key, not always the stored session id.
result = await call('POST', '/dsh-recycle-bin/trash', { sessionId: 'session:' + second })
ok(result.json.ok && result.json.item.sessionId === second, 'row key `session:<id>` resolves to the stored id')
result = await call('POST', '/dsh-recycle-bin/trash', { sessionId: 'session-' + second })
ok(result.json.ok && result.json.item.sessionId === second, 'row key `session-<id>` resolves to the stored id')
result = await call('POST', '/dsh-recycle-bin/trash', { sessionId: 'session:session-' + second })
ok(result.json.ok && result.json.item.sessionId === second, 'fully prefixed row key resolves to the stored id')

// A session the Host reports as running must never be trashed.
const fourth = 'cccccccc-dddd-eeee-ffff-000000000000'
known.add(fourth)
await seedSession(fourth)
archived = false
running.add(fourth)
result = await call('POST', '/dsh-recycle-bin/trash', { sessionId: fourth })
ok(!result.json.ok && result.json.code === 'active', 'running session is refused by the bin')
ok(!archived, 'a refused trash leaves the archive state untouched')
running.delete(fourth)
result = await call('POST', '/dsh-recycle-bin/trash', { sessionId: fourth })
ok(result.json.ok, 'idle session is trashed')
running.add(fourth)
result = await call('POST', '/dsh-recycle-bin/delete', { sessionId: fourth })
ok(!result.json.ok && result.json.code === 'running', 'deleting a running session is refused, never cancelled')
ok(!cancelled.includes(fourth), 'a refused delete does not cancel the run')

// A session that is merely opened by the app (log still claimed by a live
// Session) must be deletable: the claim only guards concurrent writers.
running.delete(fourth)
claimed.add(fourth)
result = await call('POST', '/dsh-recycle-bin/delete', { sessionId: fourth })
ok(result.json.ok && result.json.forced === true, 'an open but idle session is deleted anyway')
ok(archived, 'a force-deleted open session stays archived so it cannot resurface on reload')

await rm(home, { recursive: true, force: true })
console.log('\nALL CHECKS PASSED')
process.exit(0)
