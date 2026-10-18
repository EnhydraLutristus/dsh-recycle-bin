import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-recycle-bin'
export const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry']

const ROUTE = '/dsh-recycle-bin'
const BUILD = '2026-10-18.4'
const GUARD_HEADER = 'x-dsh-recycle-bin'
const DAY = 24 * 60 * 60 * 1000
const RETENTION_MS = 14 * DAY
const SWEEP_EVERY = 60 * 60 * 1000
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,120}$/

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

function statePath() {
  return join(dshHome(), 'recycle-bin', 'state.json')
}

// A failed drop used to be visible only as a red icon; the same failure lands in
// this file so a report can be traced back to the exact response.
function logLine(text) {
  const dir = join(dshHome(), 'recycle-bin')
  const line = '[' + new Date().toISOString() + '] ' + text + '\n'
  mkdir(dir, { recursive: true })
    .then(() => appendFile(join(dir, 'host.log'), line))
    .catch(() => {})
}

function projectionPath(sessionId) {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions', sessionId + '.json')
}

function emptyState() {
  return { version: 1, items: [] }
}

let cache = null
let queue = Promise.resolve()

function serialized(task) {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function readState() {
  if (cache) return cache
  try {
    const text = await readFile(statePath(), 'utf8')
    const parsed = JSON.parse(text)
    const items = Array.isArray(parsed?.items) ? parsed.items.filter(validEntry) : []
    cache = { version: 1, items }
  } catch {
    cache = emptyState()
  }
  return cache
}

function validEntry(entry) {
  return Boolean(entry) && typeof entry.sessionId === 'string' && ID_PATTERN.test(entry.sessionId) && typeof entry.trashedAt === 'number'
}

async function writeState(next) {
  cache = next
  const target = statePath()
  await mkdir(join(dshHome(), 'recycle-bin'), { recursive: true })
  const temporary = target + '.' + process.pid + '.tmp'
  await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
  await rename(temporary, target)
}

async function sessionExists(ctx, sessionId) {
  try {
    const snapshot = await ctx.sessionPersistence.stat(sessionId)
    return Boolean(snapshot)
  } catch {
    return false
  }
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// The drag payload is a sidebar row key, not necessarily the stored session id:
// the row may carry `session:<uuid>`, a bare uuid, or `session-<uuid>`, while the
// session directory uses one specific spelling. Try every spelling the value can
// stand for, in order, and keep the first one the host actually knows.
function idCandidates(raw) {
  const out = []
  const push = (value) => {
    const id = String(value || '').trim()
    if (id && id.length <= 128 && !out.includes(id)) out.push(id)
  }
  const value = String(raw || '').trim()
  push(value)
  const uuid = (value.match(UUID_IN_TEXT) || [])[0]
  if (uuid) {
    push(uuid)
    push('session-' + uuid)
  }
  if (value.includes(':')) {
    const tail = value.slice(value.lastIndexOf(':') + 1).trim()
    push(tail)
    if (UUID_IN_TEXT.test(tail)) push('session-' + (tail.match(UUID_IN_TEXT) || [])[0])
  }
  if (value && !value.startsWith('session-')) push('session-' + value)
  return out
}

async function resolveSessionId(ctx, raw) {
  const candidates = idCandidates(raw)
  for (const candidate of candidates) {
    if (!ID_PATTERN.test(candidate)) continue
    if (await sessionExists(ctx, candidate)) return { id: candidate, candidates }
  }
  return { id: null, candidates }
}

async function findSessionDirectory(sessionId) {
  const root = sessionsRoot()
  let groups
  try {
    groups = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue
    const candidate = join(root, group.name, sessionId)
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) return candidate
    } catch {
      // not in this workspace bucket
    }
  }
  return null
}

function locateWorkspace(ctx, sessionId) {
  let list = []
  try {
    list = ctx.workspaceRegistry.list() || []
  } catch {
    list = []
  }
  for (const workspace of list) {
    const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
    if (ids.includes(sessionId)) return { id: workspace.id, title: workspace.title || '' }
  }
  return null
}

function view(entry, existence) {
  const expiresAt = entry.trashedAt + RETENTION_MS
  const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY))
  return {
    sessionId: entry.sessionId,
    title: entry.title || '',
    workspaceTitle: entry.workspaceTitle || '',
    trashedAt: entry.trashedAt,
    expiresAt,
    daysLeft,
    exists: existence,
  }
}

async function listTrash(ctx) {
  const state = await readState()
  const items = []
  let dirty = false
  for (const entry of state.items) {
    if (!(await sessionExists(ctx, entry.sessionId))) {
      dirty = true
      continue
    }
    items.push(view(entry, true))
  }
  if (dirty) {
    await serialized(async () => {
      const current = await readState()
      const kept = []
      for (const entry of current.items) {
        if (await sessionExists(ctx, entry.sessionId)) kept.push(entry)
      }
      await writeState({ version: 1, items: kept })
      return kept
    })
  }
  items.sort((a, b) => b.trashedAt - a.trashedAt)
  return { ok: true, retentionDays: Math.round(RETENTION_MS / DAY), items }
}

function sessionController(ctx) {
  if (typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get('sessionController')
  } catch {
    return undefined
  }
}

function controllerRows(raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) return raw.items
    if (Array.isArray(raw.sessions)) return raw.sessions
    if (Array.isArray(raw.rows)) return raw.rows
  }
  return []
}

async function isRunning(ctx, sessionId) {
  const controller = sessionController(ctx)
  if (!controller || typeof controller.list !== 'function') return false
  try {
    const rows = controllerRows(await controller.list())
    const row = rows.find((entry) => entry && entry.sessionId === sessionId)
    return Boolean(row && row.running)
  } catch {
    return false
  }
}

function notifyRemoved(ctx, sessionId) {
  if (typeof ctx.emit !== 'function') {
    logLine('emit skipped id=' + sessionId)
    return
  }
  try {
    ctx.emit('api-session/removed', sessionId)
    logLine('emit api-session/removed id=' + sessionId)
  } catch (error) {
    // the event is advisory: a failure must not undo a completed deletion
    logLine('emit failed id=' + sessionId + ' err=' + String((error && error.message) || error))
  }
}

async function debugSessions(ctx, probeId) {
  const controller = sessionController(ctx)
  const out = {
    hasGet: typeof ctx.get === 'function',
    hasController: Boolean(controller),
    controller: null,
    persistence: null,
    registry: null,
    store: null,
  }
  try {
    const store = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    const rows = store && typeof store.list === 'function' ? store.list() : []
    out.store = {
      present: Boolean(store),
      count: Array.isArray(rows) ? rows.length : 0,
      methods: store ? Object.keys(store).slice(0, 40) : [],
      hasProbe: Array.isArray(rows) ? rows.some((row) => row && row.id === probeId) : false,
    }
  } catch (error) {
    out.store = 'error: ' + String((error && error.message) || error)
  }
  try {
    const store = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    const live = store && typeof store.get === 'function' && probeId && probeId !== '#create' ? store.get(probeId) : undefined
    out.live = live ? {
      constructor: live.constructor ? live.constructor.name : 'anonymous',
      own: Object.keys(live).slice(0, 40),
      proto: Object.getOwnPropertyNames(Object.getPrototypeOf(live) || {}).slice(0, 40),
      symbols: Object.getOwnPropertySymbols(live).map((symbol) => String(symbol.description || symbol)),
      hasDispose: typeof live[Symbol.dispose] === 'function',
      hasAsyncDispose: typeof live[Symbol.asyncDispose] === 'function',
      hasClose: typeof live.close === 'function',
      storeIsMap: Boolean(store.store instanceof Map),
      storeSize: store.store instanceof Map ? store.store.size : null,
      logKeys: live.log ? Object.keys(live.log).slice(0, 30) : null,
      logProto: live.log ? Object.getOwnPropertyNames(Object.getPrototypeOf(live.log) || {}).slice(0, 30) : null,
      logSymbols: live.log ? Object.getOwnPropertySymbols(live.log).map((symbol) => String(symbol.description || symbol)) : null,
      projectionsIsMap: Boolean(store.projections instanceof Map),
      projectionsSize: store.projections instanceof Map ? store.projections.size : null,
    } : null
  } catch (error) {
    out.live = 'error: ' + String((error && error.message) || error)
  }
  try {
    if (controller && typeof controller.list === 'function') {
      out.keys = Object.keys(controller)
      out.controllerShape = {}
      for (const key of Object.keys(controller)) {
        const value = controller[key]
        out.controllerShape[key] = value instanceof Map
          ? { kind: 'Map', size: value.size, hasProbe: probeId ? value.has(probeId) : null }
          : Array.isArray(value)
            ? { kind: 'Array', size: value.length }
            : { kind: value === null ? 'null' : typeof value }
      }
      const rows = await controller.list()
      out.shape = Array.isArray(rows) ? 'array' : typeof rows
      out.raw = rows && typeof rows === 'object' && !Array.isArray(rows) ? Object.keys(rows) : 'n/a'
      const list = Array.isArray(rows) ? rows : (rows && (rows.sessions || rows.items || rows.rows)) || []
      out.controller = list.slice(0, 200).map((row) => ({
        id: row && (row.sessionId || row.id),
        running: Boolean(row && row.running),
        blank: Boolean(row && row.blank),
      }))
    }
  } catch (error) {
    out.controller = 'error: ' + String((error && error.message) || error)
  }
  try {
    if (typeof ctx.sessionPersistence.list === 'function') {
      const rows = await ctx.sessionPersistence.list()
      out.persistence = (rows || []).map((row) => (row && row.header && row.header.id) || (row && row.id) || '?')
    }
  } catch (error) {
    out.persistence = 'error: ' + String((error && error.message) || error)
  }
  try {
    out.registry = (ctx.workspaceRegistry.list() || []).map((ws) => ({ id: ws.id, sessions: (ws.sessionIds || []).length }))
  } catch (error) {
    out.registry = 'error: ' + String((error && error.message) || error)
  }
  if (probeId === '#create') {
    // Verification helper: make a throwaway Session so the delete path can be
    // exercised against a session that is opened by the running app.
    try {
      const controller = sessionController(ctx)
      if (!controller || typeof controller.create !== 'function') {
        out.created = { ok: false, code: 'no-create' }
      } else {
        const value = await controller.create({})
        out.created = { ok: true, value: value ? JSON.parse(JSON.stringify(value)) : null }
      }
    } catch (error) {
      out.created = { ok: false, message: String((error && error.message) || error) }
    }
  }
  if (probeId && probeId !== '#create') {
    out.probe = { id: probeId, running: null, claim: null }
    try {
      out.probe.running = await isRunning(ctx, probeId)
    } catch (error) {
      out.probe.running = 'error: ' + String((error && error.message) || error)
    }
    try {
      const handle = await ctx.sessionPersistence.open(probeId, 'write')
      try {
        await handle.close()
      } catch {
        // best effort
      }
      out.probe.claim = 'free'
    } catch (error) {
      out.probe.claim = String((error && error.name) || 'error') + ': ' + String((error && error.message) || error)
    }
  }
  return out
}

function defaultTitle(sessionId) {
  const bare = String(sessionId).replace(/^session-/, '')
  return bare.slice(0, 8) || String(sessionId).slice(0, 8)
}

async function trash(ctx, rawId, title) {
  return serialized(async () => {
    const state = await readState()
    const resolved = await resolveSessionId(ctx, rawId)
    const sessionId = resolved.id
    if (!sessionId) {
      logLine('miss trash raw=' + String(rawId) + ' tried=' + resolved.candidates.join('|'))
      return { ok: false, code: 'not-found', message: '找不到该会话的记录' }
    }
    const existing = state.items.find((entry) => entry.sessionId === sessionId)
    if (existing) return { ok: true, already: true, item: view(existing, true) }
    if (await isRunning(ctx, sessionId)) {
      return { ok: false, code: 'active', message: '该会话正在运行，请先停止它再移入回收站' }
    }
    const workspace = locateWorkspace(ctx, sessionId)
    try {
      await ctx.workspaceRegistry.archiveSession(sessionId)
    } catch (error) {
      const kind = String((error && error.name) || '')
      if (!kind.includes('Active')) {
        return { ok: false, code: 'archive-failed', message: '归档失败：' + String((error && error.message) || error) }
      }
      if (await isRunning(ctx, sessionId)) {
        return { ok: false, code: 'active', message: '该会话正在运行，请先停止它再移入回收站' }
      }
      // The session is merely open in a view: stop that activity and archive it,
      // which is what dragging a row into the bin is expected to do.
      try {
        await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
      } catch (retry) {
        const retryKind = String((retry && retry.name) || '')
        if (retryKind.includes('Active')) {
          return { ok: false, code: 'active', message: '该会话仍在使用中，请先关闭它再移入回收站' }
        }
        return { ok: false, code: 'archive-failed', message: '归档失败：' + String((retry && retry.message) || retry) }
      }
    }
    let workspaceTitle = ''
    if (workspace) workspaceTitle = String(workspace.title || '')
    const entry = {
      sessionId,
      title: title || defaultTitle(sessionId),
      workspaceId: workspace ? workspace.id : null,
      workspaceTitle,
      trashedAt: Date.now(),
    }
    const next = { version: 1, items: [...state.items, entry] }
    await writeState(next)
    return { ok: true, item: view(entry, true) }
  })
}

async function restore(ctx, sessionId) {
  return serialized(async () => {
    const state = await readState()
    const entry = state.items.find((item) => item.sessionId === sessionId)
    if (!entry) return { ok: false, code: 'missing', message: '回收站中没有这个会话' }
    if (!(await sessionExists(ctx, sessionId))) {
      await writeState({ version: 1, items: state.items.filter((item) => item.sessionId !== sessionId) })
      return { ok: false, code: 'vanished', message: '会话记录已不存在，已从回收站移除' }
    }
    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    } catch (error) {
      return { ok: false, code: 'unarchive-failed', message: '恢复失败：' + String((error && error.message) || error) }
    }
    const next = { version: 1, items: state.items.filter((item) => item.sessionId !== sessionId) }
    await writeState(next)
    return { ok: true, workspaceTitle: entry.workspaceTitle || '' }
  })
}

async function detachEverywhere(ctx, sessionId) {
  let list = []
  try {
    list = ctx.workspaceRegistry.list() || []
  } catch {
    return
  }
  for (const workspace of list) {
    const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
    if (!ids.includes(sessionId)) continue
    try {
      await workspace.detachSession(sessionId)
    } catch {
      // already gone from the roster
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function claimSessionLog(ctx, sessionId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await ctx.sessionPersistence.open(sessionId, 'write')
      try {
        await handle.close()
      } catch {
        // closing a claimed handle is best effort
      }
      return true
    } catch {
      if (attempt < 2) await delay(200)
    }
  }
  return false
}

async function purgeFiles(ctx, sessionId) {
  if (!(await sessionExists(ctx, sessionId))) {
    return { ok: true, removed: false, vanished: true }
  }
  // A running Agent owns the log and is still producing events: deleting it
  // would silently destroy work in flight, so the caller has to stop it first.
  if (await isRunning(ctx, sessionId)) {
    return {
      ok: false,
      code: 'running',
      message: '该会话正在运行，请先停止它再删除',
    }
  }
  // Any Session merely *opened* by the app (the startup window, a freshly
  // created conversation, an archived row still on screen) keeps an exclusive
  // write handle for as long as the page that opened it lives — that is why
  // deleting used to fail until the app was restarted. Files stay deletable
  // while that handle is open, so a failed claim only means "fall through".
  const claimed = await claimSessionLog(ctx, sessionId)
  if (!claimed) {
    logLine('force-delete id=' + sessionId + ' (log held open by a live Session; deleting files directly)')
  }
  const directory = await findSessionDirectory(sessionId)
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error) {
      return {
        ok: false,
        code: 'busy',
        message: '无法删除会话文件：' + String((error && error.message) || error),
      }
    }
    if (await findSessionDirectory(sessionId)) {
      await delay(250)
      try {
        await rm(directory, { recursive: true, force: true })
      } catch {
        // reported below
      }
      if (await findSessionDirectory(sessionId)) {
        return { ok: false, code: 'busy', message: '会话文件仍被占用，请稍后重试或重启应用后再删除' }
      }
    }
  }
  try {
    await rm(projectionPath(sessionId), { force: true })
  } catch {
    // projection cache is optional
  }
  await detachEverywhere(ctx, sessionId)
  // A session the app still holds open outlives its own files inside the Host's
  // in-memory registry: keeping the trash-time archive in place hides that ghost
  // from the default view until the next app start rebuilds the list from disk.
  if (claimed) {
    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    } catch {
      // may not be archived
    }
  }
  notifyRemoved(ctx, sessionId)
  return { ok: true, removed: Boolean(directory), forced: !claimed }
}

async function deleteEntry(ctx, sessionId) {
  return serialized(async () => {
    const state = await readState()
    const entry = state.items.find((item) => item.sessionId === sessionId)
    if (!entry) return { ok: false, code: 'missing', message: '回收站中没有这个会话' }
    const result = await purgeFiles(ctx, sessionId)
    if (!result.ok) return result
    const current = await readState()
    await writeState({ version: 1, items: current.items.filter((item) => item.sessionId !== sessionId) })
    return result
  })
}

async function emptyTrash(ctx) {
  const state = await readState()
  const outcomes = []
  for (const entry of state.items.slice()) {
    const result = await deleteEntry(ctx, entry.sessionId)
    outcomes.push({ sessionId: entry.sessionId, ok: result.ok, message: result.message || '' })
  }
  const failed = outcomes.filter((item) => !item.ok)
  return { ok: failed.length === 0, removed: outcomes.length - failed.length, failed: failed.length, outcomes }
}

async function sweep(ctx) {
  const state = await readState()
  const now = Date.now()
  const due = state.items.filter((entry) => now >= entry.trashedAt + RETENTION_MS)
  let removed = 0
  for (const entry of due) {
    const result = await deleteEntry(ctx, entry.sessionId)
    if (result.ok) removed += 1
  }
  return { ok: true, removed, due: due.length }
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function serverOrigin(ctx) {
  try {
    const value = ctx?.webServer?.getOrigin ? ctx.webServer.getOrigin() : ''
    return typeof value === 'string' ? value.replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

function sameOrigin(requestOrigin, origin) {
  if (!requestOrigin || !origin || requestOrigin === origin) return true
  try {
    const left = new URL(requestOrigin)
    const right = new URL(origin)
    const loopback = (host) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
    return left.port === right.port && loopback(left.hostname) && loopback(right.hostname)
  } catch {
    return false
  }
}

function guardFailure(req, origin) {
  const headers = req.headers || {}
  if (headers[GUARD_HEADER] !== '1') return 'missing-guard-header'
  const site = String(headers['sec-fetch-site'] || '')
  if (site && site !== 'same-origin' && site !== 'none') return 'cross-site-request'
  if (!sameOrigin(String(headers.origin || ''), origin)) return 'unexpected-origin'
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'POST' && !String(headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return 'unsupported-content-type'
  }
  return ''
}

function handler(ctx, req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (!url.pathname.startsWith(ROUTE)) {
    send(res, 404, { ok: false, code: 'not-found' })
    return
  }
  const blocked = guardFailure(req, serverOrigin(ctx))
  if (blocked) {
    logLine('guard-reject ' + (req.method || 'GET') + ' ' + url.pathname
      + ' reason=' + blocked
      + ' origin=' + String(req.headers.origin || '-')
      + ' site=' + String(req.headers['sec-fetch-site'] || '-')
      + ' type=' + String(req.headers['content-type'] || '-')
      + ' guard=' + String(req.headers[GUARD_HEADER] || '-'))
    send(res, 403, { ok: false, code: 'forbidden', message: blocked })
    return
  }
  const action = url.pathname.slice(ROUTE.length).replace(/^\/+/, '') || 'list'
  const method = (req.method || 'GET').toUpperCase()
  const respond = (promise) => {
    promise.then(
      (value) => {
        if (value && value.ok === false) logLine('fail ' + method + ' ' + action + ' code=' + String(value.code) + ' message=' + String(value.message || ''))
        send(res, 200, value)
      },
      (error) => {
        logLine('error ' + method + ' ' + action + ' ' + String((error && error.stack) || error))
        send(res, 500, { ok: false, code: 'internal', message: String((error && error.message) || error) })
      },
    )
  }
  if (method === 'GET' && (action === 'list' || action === 'state')) {
    respond(listTrash(ctx))
    return
  }
  if (method === 'GET' && action === 'version') {
    send(res, 200, { ok: true, build: BUILD, route: ROUTE })
    return
  }
  if (method === 'GET' && action === 'debug') {
    const probeId = typeof url.searchParams?.get === 'function' ? url.searchParams.get('id') : null
    respond(debugSessions(ctx, probeId ? String(probeId).trim() : ''))
    return
  }
  if (method !== 'POST') {
    send(res, 405, { ok: false, code: 'method-not-allowed' })
    return
  }
  if (action === 'sweep') {
    respond(sweep(ctx))
    return
  }
  readBody(req).then(
    (body) => {
      if (action === 'client-boot') {
        // Diagnoses the cold start: a line here proves the client half was
        // evaluated by this page load, and what it managed to register.
        logLine('client-boot ' + JSON.stringify(body ?? {}))
        send(res, 200, { ok: true })
        return
      }
      if (action === 'empty') {
        respond(emptyTrash(ctx))
        return
      }
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
      if (!ID_PATTERN.test(sessionId)) {
        send(res, 400, { ok: false, code: 'bad-id', message: '会话标识不合法' })
        return
      }
      if (action === 'trash') {
        respond(trash(ctx, sessionId, typeof body?.title === 'string' ? body.title : ''))
        return
      }
      if (action === 'restore') {
        respond(restore(ctx, sessionId))
        return
      }
      if (action === 'delete') {
        respond(deleteEntry(ctx, sessionId))
        return
      }
      send(res, 404, { ok: false, code: 'not-found' })
    },
    (error) => send(res, 400, { ok: false, code: 'bad-body', message: String((error && error.message) || error) }),
  )
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: (req, res) => handler(ctx, req, res) }))
  ctx.effect(() => {
    let stopped = false
    const tick = () => {
      if (stopped) return
      sweep(ctx).catch(() => undefined)
    }
    const first = setTimeout(tick, 5000)
    const interval = setInterval(tick, SWEEP_EVERY)
    if (typeof first.unref === 'function') first.unref()
    if (typeof interval.unref === 'function') interval.unref()
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(interval)
    }
  })
}

