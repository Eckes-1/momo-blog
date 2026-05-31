import { getToken, setToken, setUser, addToast } from './stores.svelte.js'

const BASE = '/api'
const TIMEOUT = 30000
const SESSION_DURATION = 60 * 60 * 1000
const RENEW_THRESHOLD = 5 * 60 * 1000
const WARN_THRESHOLD = 5 * 60 * 1000

let lastActivityTime = 0
let sessionTimer = null
let warnTimer = null
let hasWarned = false
let isRefreshing = false

function decodeToken(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

function getTokenExpiry() {
  const token = getToken()
  if (!token) return 0
  const payload = decodeToken(token)
  if (!payload || !payload.exp) return 0
  return payload.exp * 1000
}

function getTimeUntilExpiry() {
  return getTokenExpiry() - Date.now()
}

function recordActivity() {
  lastActivityTime = Date.now()
}

async function tryRefreshToken() {
  if (isRefreshing) return false
  const token = getToken()
  if (!token) return false

  isRefreshing = true
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      cache: 'no-store'
    })
    if (!res.ok) return false
    const data = await res.json()
    if (data.token) {
      setToken(data.token)
      if (data.user) setUser(data.user)
      return true
    }
    return false
  } catch {
    return false
  } finally {
    isRefreshing = false
  }
}

function getTokenDuration() {
  const token = getToken()
  if (!token) return 0
  const payload = decodeToken(token)
  if (!payload || !payload.exp || !payload.iat) return 0
  return (payload.exp - payload.iat) * 1000
}

export function startSessionMonitor() {
  stopSessionMonitor()
  const duration = getTokenDuration()
  if (duration > 0 && duration < 50 * 60 * 1000) {
    setToken(null)
    setUser(null)
    addToast('会话时长已更新为1小时，请重新登录', 'warning')
    if (typeof location !== 'undefined') {
      location.hash = '#/login'
    }
    return
  }
  if (duration > SESSION_DURATION + 60000) {
    setToken(null)
    setUser(null)
    addToast('会话格式已更新，请重新登录', 'warning')
    if (typeof location !== 'undefined') {
      location.hash = '#/login'
    }
    return
  }
  hasWarned = false
  recordActivity()
  scheduleTimers()
}

export function stopSessionMonitor() {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null }
  if (warnTimer) { clearTimeout(warnTimer); warnTimer = null }
  hasWarned = false
}

function scheduleTimers() {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null }
  if (warnTimer) { clearTimeout(warnTimer); warnTimer = null }

  const timeLeft = getTimeUntilExpiry()
  if (timeLeft <= 0) {
    handleSessionExpired()
    return
  }

  const warnAt = Math.max(timeLeft - WARN_THRESHOLD, 0)
  warnTimer = setTimeout(() => {
    hasWarned = true
    const minutes = Math.ceil(getTimeUntilExpiry() / 60000)
    addToast(`会话即将过期（剩余 ${minutes} 分钟），请进行操作以续期`, 'warning')
  }, warnAt)

  const renewAt = Math.max(timeLeft - 60000, 0)
  sessionTimer = setTimeout(async () => {
    const idleTime = Date.now() - lastActivityTime
    if (idleTime < SESSION_DURATION) {
      const success = await tryRefreshToken()
      if (success) {
        hasWarned = false
        addToast('会话已自动续期 1 小时', 'success')
        scheduleTimers()
      } else {
        handleSessionExpired()
      }
    } else {
      handleSessionExpired()
    }
  }, renewAt)
}

function handleSessionExpired() {
  stopSessionMonitor()
  setToken(null)
  setUser(null)
  addToast('会话已过期，请重新登录', 'error')
  if (typeof location !== 'undefined') {
    location.hash = '#/login'
  }
}

export function getSessionInfo() {
  const timeLeft = getTimeUntilExpiry()
  const idleTime = Date.now() - lastActivityTime
  return {
    timeLeft: Math.max(0, timeLeft),
    idleTime,
    isExpiringSoon: timeLeft > 0 && timeLeft < WARN_THRESHOLD,
    isExpired: timeLeft <= 0
  }
}

async function request(path, options = {}, timeout = TIMEOUT) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const isGet = !options.method || options.method === 'GET'
  let url = `${BASE}${path}`
  if (isGet) {
    const sep = url.includes('?') ? '&' : '?'
    url += `${sep}_t=${Date.now()}`
  }

  let res
  try {
    res = await fetch(url, { ...options, headers, signal: controller.signal, cache: 'no-store' })
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接')
    }
    throw new Error('网络错误，无法连接服务器')
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    if (res.status === 401) {
      stopSessionMonitor()
      setToken(null)
      setUser(null)
      addToast('登录已过期，请重新登录', 'error')
      if (typeof location !== 'undefined') {
        location.hash = '#/login'
      }
      throw new Error('登录已过期')
    }
    if (res.status === 504) {
      throw new Error('服务器连接超时(504)，SMTP服务器可能无法访问')
    }
    let err
    try {
      err = await res.json()
    } catch {
      throw new Error(`请求失败 (HTTP ${res.status})`)
    }
    throw new Error(err.error || err.message || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null

  recordActivity()

  if (token && !path.startsWith('/auth/')) {
    const timeLeft = getTimeUntilExpiry()
    if (timeLeft > 0 && timeLeft < RENEW_THRESHOLD) {
      tryRefreshToken().then(success => {
        if (success) {
          scheduleTimers()
          if (!hasWarned) {
            addToast('会话已自动续期 1 小时', 'success')
          }
          hasWarned = false
        }
      })
    }
  }

  return res.json()
}

export const auth = {
  async login(username, password, code = '', email = '', turnstileToken = null) {
    const body = { username, password }
    if (code) body.code = code
    if (email) body.email = email
    if (turnstileToken) body.turnstileToken = turnstileToken
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    setToken(data.token)
    setUser(data.user)
    startSessionMonitor()
    return data
  },
  async register(username, password) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    })
  },
  async getMe() { return request('/auth/me', { method: 'GET' }) },
  async changePassword(oldPassword, newPassword) {
    return request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword })
    })
  }
}

export const posts = {
  list(params = {}) {
    const query = new URLSearchParams(params).toString()
    return request(`/posts${query ? '?' + query : ''}`)
  },
  get(id) { return request(`/posts/${id}`) },
  create(data) { return request('/posts', { method: 'POST', body: JSON.stringify(data) }) },
  update(id, data) { return request(`/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }) },
  delete(id) { return request(`/posts/${id}`, { method: 'DELETE' }) },
  toggleDraft(id) { return request(`/posts/${id}/toggle-draft`, { method: 'PUT' }) },
  togglePin(id) { return request(`/posts/${id}/toggle-pin`, { method: 'PUT' }) },
  clone(id) { return request(`/posts/${id}/clone`, { method: 'POST' }) },
  batch(ids, action, extra = {}) { return request('/posts/batch', { method: 'POST', body: JSON.stringify({ ids, action, ...extra }) }) },
  stats() { return request('/posts/stats') }
}

export const categories = {
  list() { return request('/categories') },
  create(data) { return request('/categories', { method: 'POST', body: JSON.stringify(data) }) },
  update(id, data) { return request(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }) },
  delete(id) { return request(`/categories/${id}`, { method: 'DELETE' }) }
}

export const comments = {
  list(params = {}) {
    const query = new URLSearchParams(params).toString()
    return request(`/comments/admin/list${query ? '?' + query : ''}`)
  },
  stats() {
    return request('/comments/admin/stats')
  },
  exportCsv(status) {
    const token = getToken()
    let url = `${BASE}/comments/admin/export`
    const params = []
    if (status) params.push(`status=${status}`)
    if (token) params.push(`token=${token}`)
    if (params.length) url += '?' + params.join('&')
    return url
  },
  batch(ids, action) {
    return request('/comments/admin/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
  },
  updateStatus(id, status) {
    return request(`/comments/admin/status?id=${id}&status=${status}`, { method: 'PUT' })
  },
  update(id, data) {
    return request(`/comments/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  },
  delete(id) {
    return request(`/comments/${id}`, { method: 'DELETE' })
  },
  restore(id) {
    return request(`/comments/${id}/restore`, { method: 'PUT' })
  },
  permanentDelete(id) {
    return request(`/comments/${id}/permanent`, { method: 'DELETE' })
  },
  reply(id, content, email = '') {
    return request(`/comments/${id}/reply`, { method: 'POST', body: JSON.stringify({ content, email }) })
  }
}

export const config = {
  getAll() { return request('/config') },
  updateAll(data) { return request('/config', { method: 'PUT', body: JSON.stringify(data) }) },
  getSection(section) { return request(`/config/${section}`) }
}

export const email = {
  test(to) {
    return request('/email/test', { method: 'POST', body: JSON.stringify({ to }) }, 30000)
  },
  testSmtp(smtpHost, smtpPort, username, password, fromName, to) {
    return request('/email/test-smtp', { method: 'POST', body: JSON.stringify({ smtpHost, smtpPort, username, password, fromName, to }) }, 30000)
  },
  testResend(apiKey, fromEmail, to) {
    return request('/email/test-resend', { method: 'POST', body: JSON.stringify({ apiKey, fromEmail, to }) }, 12000)
  },
  configured() {
    return request('/email/configured')
  },
  sendCode(emailAddr, captchaToken) {
    return request('/email/send-code', { method: 'POST', body: JSON.stringify({ email: emailAddr, captchaToken }) }, 30000)
  },
  save(data) {
    return request('/email/config', { method: 'PUT', body: JSON.stringify(data) })
  },
  getConfig() {
    return request('/email/config')
  },
  getStats() {
    return request('/email/stats')
  },
  getLogs(limit = 50) {
    return request(`/email/logs?limit=${limit}`)
  },
  clearLogs() {
    return request('/email/logs', { method: 'DELETE' })
  },
  diagnose() {
    return request('/email/diagnose', {}, 25000)
  }
}

export const profile = {
  get() { return request('/profile') },
  update(data) { return request('/profile', { method: 'PUT', body: JSON.stringify(data) }) }
}

export const links = {
  list() { return request('/links') },
  create(data) { return request('/links', { method: 'POST', body: JSON.stringify(data) }) },
  update(id, data) { return request(`/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }) },
  delete(id) { return request(`/links/${id}`, { method: 'DELETE' }) },
  reorder(data) { return request('/links/reorder', { method: 'POST', body: JSON.stringify({ order: data }) }) }
}

export const media = {
  list(params = {}) {
    const query = new URLSearchParams(params).toString()
    return request(`/media${query ? '?' + query : ''}`)
  },
  stats() {
    return request('/media/stats')
  },
  async upload(file, onProgress) {
    const token = getToken()
    const formData = new FormData()
    formData.append('file', file)
    if (onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${BASE}/media/upload`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total)
        }
        xhr.onload = () => {
          recordActivity()
          try {
            const data = JSON.parse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data)
            } else {
              reject(new Error(data.message || data.error || '上传失败'))
            }
          } catch {
            reject(new Error('上传失败'))
          }
        }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.send(formData)
      })
    }
    const res = await fetch(`${BASE}/media/upload`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '上传失败' }))
      throw new Error(err.message || err.error || '上传失败')
    }
    recordActivity()
    return res.json()
  },
  delete(id) { return request(`/media/${id}`, { method: 'DELETE' }) },
  update(id, data) { return request(`/media/${id}`, { method: 'PUT', body: JSON.stringify(data) }) },
  async replace(id, file) {
    const token = getToken()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/media/${id}`, {
      method: 'PUT',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '替换失败' }))
      throw new Error(err.message || err.error || '替换失败')
    }
    recordActivity()
    return res.json()
  },
  batchDelete(ids) { return request('/media/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }) }
}

export const dashboard = {
  getStats() { return request('/dashboard/stats') }
}

export const music = {
  list() { return request('/music') },
  get(id) { return request(`/music/stream/${id}`) },
  add(data) { return request('/music/add', { method: 'POST', body: JSON.stringify(data) }) },
  batch(songs) { return request('/music/batch', { method: 'POST', body: JSON.stringify({ songs }) }) },
  update(id, data) { return request(`/music/${id}`, { method: 'PUT', body: JSON.stringify(data) }) },
  delete(id) { return request(`/music/${id}`, { method: 'DELETE' }) },
  batchDelete(ids) { return request('/music/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }) },
  neteaseSearch(keyword) { return request(`/music/netease/search?keyword=${encodeURIComponent(keyword)}`) },
  neteasePlaylist(id) { return request(`/music/netease/playlist/${id}`) },
  neteaseImport(songs) { return request('/music/netease/import', { method: 'POST', body: JSON.stringify({ songs }) }) },
  qqSearch(keyword) { return request(`/music/qq/search?keyword=${encodeURIComponent(keyword)}`) },
  qqPlaylist(id) { return request(`/music/qq/playlist/${id}`) },
  kugouSearch(keyword) { return request(`/music/kugou/search?keyword=${encodeURIComponent(keyword)}`) },
  kugouSong(hash) { return request(`/music/kugou/song/${hash}`) },
  kuwoSearch(keyword) { return request(`/music/kuwo/search?keyword=${encodeURIComponent(keyword)}`) },
  kuwoSong(rid) { return request(`/music/kuwo/song/${rid}`) },
  updateCovers() { return request('/music/update-covers', { method: 'POST' }) },
  importSongs(songs, source = 'external') { return request('/music/netease/import', { method: 'POST', body: JSON.stringify({ songs, source }) }) }
}
