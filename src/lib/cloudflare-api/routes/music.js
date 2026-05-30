const METING_API = 'https://api.injahow.cn/meting/'
const NETEASE_API = 'https://neteasecloudmusicapi.ivelly.com'

export function registerMusicRoutes(app) {
  const CHUNK_SIZE = 500000

  function arrayBufferToBase64(buffer) {
    const uint8 = new Uint8Array(buffer)
    let binaryStr = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length))
      binaryStr += String.fromCharCode.apply(null, chunk)
    }
    return btoa(binaryStr)
  }

  function base64ToBytes(base64) {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  }

  function commaStringToBytes(str) {
    const parts = String(str).split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 255)
    return new Uint8Array(parts)
  }

  function decodeStoredData(data) {
    try { return base64ToBytes(data) }
    catch { return commaStringToBytes(data) }
  }

  async function storeChunks(db, musicId, base64Data) {
    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      await db.prepare(
        'INSERT INTO music_chunks (music_id, chunk_index, data) VALUES (?, ?, ?)'
      ).bind(musicId, i, chunk).run()
    }
  }

  async function readChunks(db, musicId) {
    const { results } = await db.prepare(
      'SELECT chunk_index, data FROM music_chunks WHERE music_id = ? ORDER BY chunk_index'
    ).bind(musicId).all()
    if (!results || results.length === 0) return null
    let combined = ''
    for (const row of results) combined += row.data
    return combined
  }

  async function deleteChunks(db, musicId) {
    await db.prepare('DELETE FROM music_chunks WHERE music_id = ?').bind(musicId).run()
  }

  const SELECT_COLS = 'id, title, artist, filename, path, size, mime_type, duration, cover_path, source, external_url, created_at'

  app.get('/api/music', async (c) => {
    try {
      const { results } = await c.env.DB.prepare(
        'SELECT ' + SELECT_COLS + ' FROM music ORDER BY created_at DESC'
      ).all()
      return c.json({ songs: results || [] })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/api/music/cover/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const song = await c.env.DB.prepare(
        'SELECT cover_path, source FROM music WHERE id = ?'
      ).bind(id).first()
      if (!song || !song.cover_path) {
        return new Response(null, { status: 404 })
      }
      const coverUrl = song.cover_path
      const resp = await fetch(coverUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000)
      })
      if (!resp.ok) return new Response(null, { status: resp.status })
      const contentType = resp.headers.get('content-type') || 'image/jpeg'
      const body = await resp.arrayBuffer()
      return new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response(null, { status: 500 })
    }
  })

  app.get('/api/music/stream/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const song = await c.env.DB.prepare(
        'SELECT id, title, mime_type, source, external_url, path FROM music WHERE id = ?'
      ).bind(id).first()

      if (!song) return c.json({ error: '歌曲不存在' }, 404)

      if (song.source === 'qq' && song.external_url && song.external_url.startsWith('tencent:')) {
        const songMid = song.external_url.replace('tencent:', '')
        try {
          const songData = await metingProxy('tencent', 'song', songMid)
          if (songData && Array.isArray(songData) && songData.length > 0 && songData[0].url) {
            return c.redirect(songData[0].url, 302)
          }
        } catch {}
        return c.json({ error: '无法获取播放链接' }, 404)
      }

      if (song.source === 'kugou' && song.external_url && song.external_url.startsWith('kugou:')) {
        const hash = song.external_url.replace('kugou:', '')
        try {
          const songData = await metingProxy('kugou', 'song', hash)
          if (songData && Array.isArray(songData) && songData.length > 0 && songData[0].url) {
            return c.redirect(songData[0].url, 302)
          }
        } catch {}
        return c.json({ error: '无法获取播放链接' }, 404)
      }

      if (song.source === 'external' && song.external_url) {
        return c.json({
          redirect: true,
          url: song.external_url,
          title: song.title,
          mime_type: song.mime_type || 'audio/mpeg'
        })
      }

      const storedData = await readChunks(c.env.DB, id)
      if (!storedData) return c.json({ error: '音频数据不存在' }, 404)

      const bytes = decodeStoredData(storedData)
      const rangeHeader = c.req.header('Range')

      if (rangeHeader) {
        const matches = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
        if (matches) {
          const start = parseInt(matches[1])
          const end = matches[2] ? parseInt(matches[2]) : bytes.length - 1
          const clampedEnd = Math.min(end, bytes.length - 1)
          const chunk = bytes.slice(start, clampedEnd + 1)
          return new Response(chunk, {
            status: 206,
            headers: {
              'Content-Type': song.mime_type || 'audio/mpeg',
              'Content-Range': `bytes ${start}-${clampedEnd}/${bytes.length}`,
              'Content-Length': String(chunk.length),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=86400',
            }
          })
        }
      }

      return new Response(bytes, {
        headers: {
          'Content-Type': song.mime_type || 'audio/mpeg',
          'Content-Length': String(bytes.length),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        }
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/music/add', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const body = await c.req.json()
      const title = (body.title || '').trim()
      const artist = (body.artist || '').trim()
      const externalUrl = (body.external_url || '').trim()
      const coverPath = (body.cover_path || '').trim()
      const duration = parseFloat(body.duration) || 0

      if (!title) return c.json({ error: '请输入歌曲名称' }, 400)

      let source = 'external'
      let path = externalUrl
      let mimeType = 'audio/mpeg'

      if (!externalUrl) {
        return c.json({ error: '请输入音乐链接' }, 400)
      }

      const result = await c.env.DB.prepare(
        "INSERT INTO music (title, artist, filename, path, size, mime_type, duration, cover_path, source, external_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))"
      ).bind(title, artist, title, path, 0, mimeType, duration, coverPath, source, externalUrl).run()

      const musicId = result.meta.last_row_id

      const song = await c.env.DB.prepare(
        'SELECT ' + SELECT_COLS + ' FROM music WHERE id = ?'
      ).bind(musicId).first()

      return c.json(song, 201)
    } catch (err) {
      return c.json({ error: '添加失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })

  app.post('/api/music/upload', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const formData = await c.req.parseBody()
      const file = formData.file
      if (!file) return c.json({ error: '请选择音频文件' }, 400)

      const title = (formData.title || file.name.replace(/\.[^/.]+$/, '')).trim()
      const artist = (formData.artist || '').trim()
      const duration = parseFloat(formData.duration) || 0
      const coverPath = (formData.cover_path || '').trim()

      const ext = file.name.split('.').pop().toLowerCase() || 'mp3'
      const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.' + ext
      const basePath = '/api/music/stream/'

      const mimeMap = {
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
        oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
        flac: 'audio/flac', webm: 'audio/webm', wma: 'audio/x-ms-wma'
      }
      const mimeType = file.type || mimeMap[ext] || 'audio/mpeg'

      const fileBuffer = await file.arrayBuffer()
      const base64Data = arrayBufferToBase64(fileBuffer)

      const result = await c.env.DB.prepare(
        "INSERT INTO music (title, artist, filename, path, size, mime_type, duration, cover_path, source, external_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upload', '', datetime('now', '+8 hours'))"
      ).bind(title, artist, filename, basePath, file.size, mimeType, duration, coverPath).run()

      const musicId = result.meta.last_row_id

      await c.env.DB.prepare(
        'UPDATE music SET path = ? WHERE id = ?'
      ).bind(basePath + musicId, musicId).run()

      try {
        await storeChunks(c.env.DB, musicId, base64Data)
      } catch (chunkErr) {
        await c.env.DB.prepare('DELETE FROM music WHERE id = ?').bind(musicId).run()
        return c.json({ error: '音频存储失败: ' + (chunkErr.message || '数据过大') }, 500)
      }

      const song = await c.env.DB.prepare(
        'SELECT ' + SELECT_COLS + ' FROM music WHERE id = ?'
      ).bind(musicId).first()

      return c.json(song, 201)
    } catch (err) {
      return c.json({ error: '上传失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })

  app.delete('/api/music/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const id = c.req.param('id')
      const song = await c.env.DB.prepare('SELECT * FROM music WHERE id = ?').bind(id).first()
      if (!song) return c.json({ error: '歌曲不存在' }, 404)

      if (song.source !== 'external') {
        await deleteChunks(c.env.DB, id)
      }
      await c.env.DB.prepare('DELETE FROM music WHERE id = ?').bind(id).run()

      return c.json({ message: '删除成功' })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/music/batch', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const body = await c.req.json()
      const songs = body.songs
      if (!Array.isArray(songs) || songs.length === 0) {
        return c.json({ error: '请提供歌曲列表' }, 400)
      }

      const results = []
      for (const item of songs) {
        const title = (item.title || '').trim()
        const artist = (item.artist || '').trim()
        const externalUrl = (item.external_url || '').trim()
        const coverPath = (item.cover_path || '').trim()
        const duration = parseFloat(item.duration) || 0

        if (!title || !externalUrl) {
          results.push({ title: title || '(空)', status: 'skipped', reason: '缺少名称或链接' })
          continue
        }

        try {
          const result = await c.env.DB.prepare(
            "INSERT INTO music (title, artist, filename, path, size, mime_type, duration, cover_path, source, external_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'external', ?, datetime('now', '+8 hours'))"
          ).bind(title, artist, title, externalUrl, 0, 'audio/mpeg', duration, coverPath, externalUrl).run()

          const musicId = result.meta.last_row_id
          const song = await c.env.DB.prepare(
            'SELECT ' + SELECT_COLS + ' FROM music WHERE id = ?'
          ).bind(musicId).first()

          results.push({ ...song, status: 'ok' })
        } catch (err) {
          results.push({ title, status: 'error', reason: err.message })
        }
      }

      return c.json({ results, total: results.length, ok: results.filter(r => r.status === 'ok').length })
    } catch (err) {
      return c.json({ error: '批量导入失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })

  const NETEASE_HEADERS = {
    'Referer': 'https://music.163.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Cookie': 'MUSIC_U=; os=pc; appver=2.10.11; osver=Microsoft-Windows-10-Professional-build-22631'
  }

  const QQ_HEADERS = {
    'Referer': 'https://y.qq.com/',
    'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/54409 CFNetwork/901.1 Darwin/17.6.0 (x86_64)',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.8,gl;q=0.6,zh-TW;q=0.4',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  const KUGOU_HEADERS = {
    'User-Agent': 'IPhone-8990-searchSong',
    'UNI-UserAgent': 'iOS11.4-Phone8990-1009-0-WiFi'
  }

  async function safeFetch(url, customHeaders) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const resp = await fetch(url, { headers: customHeaders || NETEASE_HEADERS, signal: controller.signal })
      if (!resp.ok) return null
      const text = await resp.text()
      try { return JSON.parse(text) } catch { return null }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async function safePostFetch(url, body, customHeaders) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(customHeaders || {})
        },
        body: typeof body === 'string' ? body : new URLSearchParams(body).toString(),
        signal: controller.signal
      })
      if (!resp.ok) return null
      const text = await resp.text()
      try { return JSON.parse(text) } catch { return null }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async function metingProxy(server, type, id) {
    const url = `${METING_API}?server=${server}&type=${type}&id=${encodeURIComponent(id)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const resp = await fetch(url, { signal: controller.signal })
      if (!resp.ok) return null
      const text = await resp.text()
      try { return JSON.parse(text) } catch { return null }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  app.get('/api/music/netease/search', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const keyword = c.req.query('keyword')
    if (!keyword) return c.json({ error: '请输入搜索关键词' }, 400)

    try {
      let data = await safeFetch(`${NETEASE_API}/search?keywords=${encodeURIComponent(keyword)}&limit=100&offset=0`, {})

      if (!data || data.code !== 200 || !data.result || !data.result.songs) {
        data = await safePostFetch('https://apis.netstart.cn/music/search', {
          keywords: keyword,
          type: 1,
          limit: 100,
          offset: 0
        })
      }

      if (!data || !data.result || !data.result.songs) {
        const searchUrls = [
          `https://interface3.music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=100&offset=0`,
          `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=100&offset=0`,
        ]
        for (const url of searchUrls) {
          data = await safeFetch(url)
          if (data && data.code === 200 && data.result && data.result.songs) break
        }
      }

      if (!data) {
        return c.json({ songs: [], message: '无法连接网易云服务，请稍后再试' })
      }
      if (!data.result || !data.result.songs || data.result.songs.length === 0) {
        return c.json({ songs: [], message: '未找到相关歌曲' })
      }

      const songs = data.result.songs.map(s => ({
        id: s.id,
        title: s.name,
        artist: (s.artists || s.ar || []).map(a => a.name).join(' / '),
        album: (s.album || s.al || {}).name || '',
        duration: Math.round((s.duration || s.dt || 0) / 1000),
        cover: '',
        external_url: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`
      }))

      const coverMap = {}
      try {
        const allIds = songs.map(s => s.id)
        const batchSize = 50
        for (let i = 0; i < allIds.length; i += batchSize) {
          const batchIds = allIds.slice(i, i + batchSize)
          const idsParam = batchIds.join(',')
          const detailData = await safeFetch(`${NETEASE_API}/song/detail?ids=${idsParam}`, {})
          if (detailData && detailData.songs) {
            detailData.songs.forEach(s => { coverMap[s.id] = (s.al || {}).picUrl || '' })
          }
        }
      } catch {}
      songs.forEach(s => { if (coverMap[s.id]) s.cover = coverMap[s.id] })

      return c.json({ songs })
    } catch (err) {
      return c.json({ error: '搜索失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })

  app.get('/api/music/netease/debug', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const keyword = c.req.query('keyword') || '周杰伦'
    const results = {}

    try {
      const resp = await fetch(`${NETEASE_API}/search?keywords=${encodeURIComponent(keyword)}&limit=5&offset=0`, {
        signal: AbortSignal.timeout(10000)
      })
      results.ivelly_status = resp.status
      results.ivelly_ok = resp.ok
      const text = await resp.text()
      results.ivelly_raw_length = text.length
      try {
        const json = JSON.parse(text)
        results.ivelly_code = json.code
        results.ivelly_has_result = !!json.result
        results.ivelly_has_songs = !!(json.result && json.result.songs)
        results.ivelly_song_count = json.result && json.result.songs ? json.result.songs.length : 0
        if (json.result && json.result.songs) {
          results.ivelly_song_ids = json.result.songs.map(s => s.id)
        }
      } catch {
        results.ivelly_parse_error = true
        results.ivelly_raw_preview = text.substring(0, 200)
      }
    } catch (e) {
      results.ivelly_error = e.message
    }

    try {
      const ids = results.ivelly_song_ids || [509781655, 5257138]
      const idsParam = ids.join(',')
      const resp = await fetch(`${NETEASE_API}/song/detail?ids=${idsParam}`, {
        signal: AbortSignal.timeout(10000)
      })
      results.detail_status = resp.status
      results.detail_ok = resp.ok
      results.detail_url = `${NETEASE_API}/song/detail?ids=${idsParam}`
      const text = await resp.text()
      results.detail_raw_length = text.length
      try {
        const json = JSON.parse(text)
        results.detail_code = json.code
        results.detail_has_songs = !!(json.songs && json.songs.length > 0)
        if (json.songs) {
          results.detail_covers = json.songs.map(s => ({
            id: s.id,
            picUrl: (s.al || {}).picUrl || 'NONE'
          }))
        }
      } catch {
        results.detail_parse_error = true
        results.detail_raw_preview = text.substring(0, 200)
      }
    } catch (e) {
      results.detail_error = e.message
    }

    try {
      const resp = await fetch(`https://interface3.music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=5&offset=0`, {
        headers: NETEASE_HEADERS,
        signal: AbortSignal.timeout(10000)
      })
      results.direct_status = resp.status
      results.direct_ok = resp.ok
      const text = await resp.text()
      results.direct_raw_length = text.length
      try {
        const json = JSON.parse(text)
        results.direct_code = json.code
        results.direct_has_result = !!json.result
        results.direct_has_songs = !!(json.result && json.result.songs)
      } catch {
        results.direct_parse_error = true
        results.direct_raw_preview = text.substring(0, 200)
      }
    } catch (e) {
      results.direct_error = e.message
    }

    return c.json(results)
  })

  app.get('/api/music/netease/song/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const songId = c.req.param('id')
    try {
      let data = await safeFetch(`${NETEASE_API}/song/detail?ids=${songId}`, {})

      if (!data || data.code !== 200 || !data.songs || data.songs.length === 0) {
        data = await safePostFetch('https://apis.netstart.cn/music/song/detail', {
          ids: songId
        })
      }

      if (!data || data.code !== 200 || !data.songs || data.songs.length === 0) {
        const songUrls = [
          `https://interface3.music.163.com/api/song/detail/?id=${songId}&ids=%5B${songId}%5D`,
          `https://music.163.com/api/song/detail/?id=${songId}&ids=%5B${songId}%5D`,
        ]
        for (const url of songUrls) {
          data = await safeFetch(url)
          if (data && data.code === 200 && data.songs && data.songs.length > 0) break
        }
      }

      if (!data || data.code !== 200 || !data.songs || data.songs.length === 0) {
        return c.json({ error: '无法获取歌曲详情' }, 404)
      }

      const s = data.songs[0]
      const song = {
        id: s.id,
        title: s.name,
        artist: (s.artists || s.ar || []).map(a => a.name).join(' / '),
        album: (s.album || s.al || {}).name || '',
        duration: Math.round((s.duration || s.dt || 0) / 1000),
        cover: (s.album || s.al || {}).picUrl || '',
        external_url: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`
      }

      return c.json(song)
    } catch (err) {
      return c.json({ error: '获取歌曲详情失败' }, 500)
    }
  })

  app.get('/api/music/netease/playlist/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const playlistId = c.req.param('id')
    try {
      let data = await safeFetch(`${NETEASE_API}/playlist/detail?id=${playlistId}`, {})

      if (!data || data.code !== 200 || !data.playlist) {
        data = await safePostFetch('https://apis.netstart.cn/music/playlist/detail', {
          id: playlistId,
          n: 100000
        })
      }

      if (!data || data.code !== 200 || !data.playlist) {
        const playlistUrls = [
          `https://interface3.music.163.com/api/v6/playlist/detail?id=${playlistId}&n=100000`,
          `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&n=100000`,
        ]
        for (const url of playlistUrls) {
          data = await safeFetch(url)
          if (data && data.code === 200 && data.playlist) break
        }
      }

      if (!data || data.code !== 200 || !data.playlist) {
        return c.json({ error: '无法获取歌单，请检查 ID 是否正确或稍后再试' }, 404)
      }

      const playlist = data.playlist
      const songs = (playlist.tracks || []).map(s => ({
        id: s.id,
        title: s.name,
        artist: (s.ar || []).map(a => a.name).join(' / '),
        album: (s.al || {}).name || '',
        duration: Math.round((s.dt || 0) / 1000),
        cover: (s.al || {}).picUrl || '',
        external_url: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`
      }))

      return c.json({
        name: playlist.name,
        description: playlist.description || '',
        cover: playlist.coverImgUrl || '',
        trackCount: playlist.trackCount || songs.length,
        songs
      })
    } catch (err) {
      return c.json({ error: '获取歌单失败' }, 500)
    }
  })

  app.post('/api/music/netease/import', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const body = await c.req.json()
      const songs = body.songs
      if (!Array.isArray(songs) || songs.length === 0) {
        return c.json({ error: '请提供歌曲列表' }, 400)
      }

      const results = []
      const needCoverNetease = []
      const needCoverQQ = []
      const needCoverKugou = []

      for (const item of songs) {
        const title = (item.title || '').trim()
        const artist = (item.artist || '').trim()
        const externalUrl = (item.external_url || '').trim()
        const coverPath = (item.cover || item.cover_path || '').trim()
        const duration = parseFloat(item.duration) || 0
        const source = item._source || 'netease'

        if (!title || !externalUrl) {
          results.push({ title: title || '(空)', status: 'skipped', reason: '缺少名称或链接' })
          continue
        }

        try {
          const result = await c.env.DB.prepare(
            "INSERT INTO music (title, artist, filename, path, size, mime_type, duration, cover_path, source, external_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))"
          ).bind(title, artist, title, externalUrl, 0, 'audio/mpeg', duration, coverPath, source, externalUrl).run()

          const musicId = result.meta.last_row_id
          const song = await c.env.DB.prepare(
            'SELECT ' + SELECT_COLS + ' FROM music WHERE id = ?'
          ).bind(musicId).first()

          if (!coverPath) {
            if (source === 'netease') needCoverNetease.push({ id: musicId, url: externalUrl })
            else if (source === 'qq') needCoverQQ.push({ id: musicId, url: externalUrl })
            else if (source === 'kugou') needCoverKugou.push({ id: musicId, url: externalUrl })
          }

          results.push({ ...song, status: 'ok' })
        } catch (err) {
          results.push({ title, status: 'error', reason: err.message })
        }
      }

      if (needCoverNetease.length > 0) {
        const idMap = {}
        const neteaseIds = []
        for (const item of needCoverNetease) {
          const match = item.url.match(/id=(\d+)/)
          if (match) {
            const songId = Number(match[1])
            idMap[songId] = item.id
            neteaseIds.push(songId)
          }
        }
        if (neteaseIds.length > 0) {
          const batchSize = 50
          const coverMap = {}
          for (let i = 0; i < neteaseIds.length; i += batchSize) {
            const batchIds = neteaseIds.slice(i, i + batchSize)
            try {
              const detailData = await safeFetch(`${NETEASE_API}/song/detail?ids=${batchIds.join(',')}`, {})
              if (detailData && detailData.songs) {
                detailData.songs.forEach(s => {
                  const picUrl = (s.al || {}).picUrl || ''
                  if (picUrl) coverMap[s.id] = picUrl
                })
              }
            } catch {}
          }
          for (const [songId, dbId] of Object.entries(idMap)) {
            if (coverMap[songId]) {
              try {
                await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(coverMap[songId], dbId).run()
                const song = results.find(r => r.id === Number(dbId))
                if (song) song.cover_path = coverMap[songId]
              } catch {}
            }
          }
        }
      }

      if (needCoverQQ.length > 0) {
        for (const item of needCoverQQ) {
          const match = item.url.match(/^tencent:(.+)$/)
          if (!match) continue
          try {
            const qqData = await safeFetch(
              `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${encodeURIComponent(match[1])}&format=json`,
              QQ_HEADERS
            )
            if (qqData && qqData.data && qqData.data.track_info && qqData.data.track_info.album && qqData.data.track_info.album.mid) {
              const coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${qqData.data.track_info.album.mid}.jpg`
              await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(coverUrl, item.id).run()
              const song = results.find(r => r.id === item.id)
              if (song) song.cover_path = coverUrl
            }
          } catch {}
        }
      }

      if (needCoverKugou.length > 0) {
        for (const item of needCoverKugou) {
          const match = item.url.match(/^kugou:(.+)$/)
          if (!match) continue
          try {
            const songData = await safeFetch(
              `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${encodeURIComponent(match[1])}`,
              KUGOU_HEADERS
            )
            if (songData && songData.data && songData.data.img) {
              await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(songData.data.img, item.id).run()
              const song = results.find(r => r.id === item.id)
              if (song) song.cover_path = songData.data.img
            } else if (songData && songData.data && songData.data.album_id) {
              const albumData = await safeFetch(
                `https://mobileservice.kugou.com/api/v3/album/info?albumid=${songData.data.album_id}`,
                KUGOU_HEADERS
              )
              if (albumData && albumData.data && albumData.data.imgurl) {
                const coverUrl = albumData.data.imgurl.replace('{size}', '400')
                await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(coverUrl, item.id).run()
                const song = results.find(r => r.id === item.id)
                if (song) song.cover_path = coverUrl
              }
            }
          } catch {}
        }
      }

      return c.json({ results, total: results.length, ok: results.filter(r => r.status === 'ok').length })
    } catch (err) {
      return c.json({ error: '导入失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })

  app.get('/api/music/qq/search', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const keyword = c.req.query('keyword')
    if (!keyword) return c.json({ error: '请输入搜索关键词' }, 400)

    try {
      const data = await safeFetch(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=999999&w=${encodeURIComponent(keyword)}&aggr=1&lossless=1&cr=1&new_json=1`,
        QQ_HEADERS
      )

      if (!data || data.code !== 0 || !data.data || !data.data.song || !data.data.song.list) {
        return c.json({ songs: [], message: '未找到相关歌曲' })
      }

      const songs = data.data.song.list.map(s => ({
        id: s.mid || s.songmid,
        title: s.title || s.name || '',
        artist: (s.singer || []).map(a => a.name || a.title).join(' / '),
        album: (s.album || {}).title || s.albumname || '',
        duration: s.interval || 0,
        cover: (s.album || {}).mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
        external_url: `tencent:${s.mid || s.songmid}`
      }))

      return c.json({ songs })
    } catch (err) {
      return c.json({ songs: [], message: '搜索失败: ' + (err.message || '请稍后再试') })
    }
  })

  app.get('/api/music/qq/playlist/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const playlistId = c.req.param('id')
    try {
      const data = await safeFetch(
        `https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?id=${playlistId}&format=json&newsong=1&platform=jqspaframe.json`,
        QQ_HEADERS
      )

      if (!data || data.code !== 0 || !data.data) {
        return c.json({ error: '无法获取歌单，请检查 ID 或稍后再试' }, 404)
      }

      const pd = data.data
      const songList = pd.songlist || pd.cdlist && pd.cdlist[0] && pd.cdlist[0].songlist || []
      const songs = songList.map(s => {
        const songData = s.musicData || s
        return {
          id: songData.mid || songData.songmid,
          title: songData.title || songData.name || songData.songname || '',
          artist: (songData.singer || []).map(a => a.name || a.title).join(' / '),
          album: (songData.album || {}).title || songData.albumname || '',
          duration: songData.interval || 0,
          cover: (songData.album || {}).mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${songData.album.mid}.jpg` : '',
          external_url: `tencent:${songData.mid || songData.songmid}`
        }
      })

      return c.json({
        name: pd.diss_name || pd.dissname || (pd.cdlist && pd.cdlist[0] && pd.cdlist[0].diss_name) || '',
        description: pd.desc || '',
        cover: pd.diss_cover || pd.logo || '',
        trackCount: pd.total_song_num || songs.length,
        songs
      })
    } catch (err) {
      return c.json({ error: '获取歌单失败' }, 500)
    }
  })

  app.get('/api/music/kugou/search', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const keyword = c.req.query('keyword')
    if (!keyword) return c.json({ error: '请输入搜索关键词' }, 400)

    try {
      const data = await safeFetch(
        `https://mobileservice.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(keyword)}&pagesize=999999&page=1&api_ver=1&area_code=1&correct=1&plat=2&tag=1&sver=5&showtype=10&version=8990`,
        KUGOU_HEADERS
      )

      if (!data || data.status !== 1 || !data.data || !data.data.info) {
        return c.json({ songs: [], message: '未找到相关歌曲' })
      }

      const songs = data.data.info.map(s => ({
        id: s.hash || s.album_audio_id || String(s.songid),
        title: (s.songname || s.filename || '').replace(/<[^>]*>/g, ''),
        artist: (s.author_name || (s.authors && s.authors.map(a => a.author_name).join(' / ')) || '').replace(/<[^>]*>/g, ''),
        album: (s.album_name || '').replace(/<[^>]*>/g, ''),
        duration: s.duration ? Math.round(s.duration) : 0,
        cover: '',
        _album_id: s.album_id || '',
        external_url: `kugou:${s.hash}`
      }))

      try {
        const albumIds = [...new Set(songs.map(s => s._album_id).filter(Boolean))]
        if (albumIds.length > 0) {
          const coverMap = {}
          await Promise.all(albumIds.slice(0, 20).map(async aid => {
            try {
              const albumData = await safeFetch(
                `https://mobileservice.kugou.com/api/v3/album/info?albumid=${aid}`,
                KUGOU_HEADERS
              )
              if (albumData && albumData.data && albumData.data.imgurl) {
                coverMap[aid] = albumData.data.imgurl.replace('{size}', '400')
              }
            } catch {}
          }))
          songs.forEach(s => { if (s._album_id && coverMap[s._album_id]) s.cover = coverMap[s._album_id] })
        }
      } catch {}

      songs.forEach(s => { delete s._album_id })
      return c.json({ songs })
    } catch (err) {
      return c.json({ songs: [], message: '搜索失败: ' + (err.message || '请稍后再试') })
    }
  })

  app.get('/api/music/kugou/song/:hash', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    const hash = c.req.param('hash')
    try {
      const songData = await metingProxy('kugou', 'song', hash)

      if (!songData || (Array.isArray(songData) && songData.length === 0) || songData.error) {
        return c.json({ error: '无法获取歌曲详情' }, 404)
      }

      const s = Array.isArray(songData) ? songData[0] : songData
      return c.json({
        id: hash,
        title: s.name || s.songName || '',
        artist: s.artist || s.author_name || '',
        album: s.album || s.album_name || '',
        duration: 0,
        cover: s.pic || s.img || '',
        external_url: s.url || `${METING_API}?server=kugou&type=url&id=${hash}`
      })
    } catch (err) {
      return c.json({ error: '获取歌曲详情失败' }, 500)
    }
  })

  app.put('/api/music/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const id = c.req.param('id')
      const song = await c.env.DB.prepare('SELECT * FROM music WHERE id = ?').bind(id).first()
      if (!song) return c.json({ error: '歌曲不存在' }, 404)

      const body = await c.req.json()
      const updates = []
      const values = []

      if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title) }
      if (body.artist !== undefined) { updates.push('artist = ?'); values.push(body.artist) }
      if (body.cover_path !== undefined) { updates.push('cover_path = ?'); values.push(body.cover_path) }
      if (body.external_url !== undefined) { updates.push('external_url = ?'); values.push(body.external_url) }

      if (updates.length === 0) return c.json(song)

      values.push(id)
      await c.env.DB.prepare(
        'UPDATE music SET ' + updates.join(', ') + ' WHERE id = ?'
      ).bind(...values).run()

      const updated = await c.env.DB.prepare(
        'SELECT ' + SELECT_COLS + ' FROM music WHERE id = ?'
      ).bind(id).first()

      return c.json(updated)
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/music/update-covers', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const { results } = await c.env.DB.prepare(
        "SELECT id, title, artist, source, external_url FROM music WHERE cover_path = '' OR cover_path IS NULL"
      ).all()

      const songs = results || []
      let updated = 0

      const neteaseSongs = songs.filter(s => s.source === 'netease')
      const qqSongs = songs.filter(s => s.source === 'qq')
      const kugouSongs = songs.filter(s => s.source === 'kugou')

      if (neteaseSongs.length > 0) {
        const idMap = {}
        const neteaseIds = []
        for (const song of neteaseSongs) {
          const match = (song.external_url || '').match(/id=(\d+)/)
          if (match) {
            const songId = Number(match[1])
            idMap[songId] = song.id
            neteaseIds.push(songId)
          }
        }

        const batchSize = 50
        const coverMap = {}
        for (let i = 0; i < neteaseIds.length; i += batchSize) {
          const batchIds = neteaseIds.slice(i, i + batchSize)
          const idsParam = batchIds.join(',')
          const detailData = await safeFetch(`${NETEASE_API}/song/detail?ids=${idsParam}`, {})
          if (detailData && detailData.songs) {
            detailData.songs.forEach(s => {
              const picUrl = (s.al || {}).picUrl || ''
              if (picUrl) coverMap[s.id] = picUrl
            })
          }
        }

        for (const [songId, dbId] of Object.entries(idMap)) {
          const coverUrl = coverMap[songId]
          if (coverUrl) {
            await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(coverUrl, dbId).run()
            updated++
          }
        }
      }

      for (const song of qqSongs) {
        const match = (song.external_url || '').match(/^tencent:(.+)$/)
        if (!match) continue
        const songMid = match[1]
        try {
          const qqData = await safeFetch(
            `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${encodeURIComponent(songMid)}&format=json`,
            QQ_HEADERS
          )
          if (qqData && qqData.data && qqData.data.track_info && qqData.data.track_info.album && qqData.data.track_info.album.mid) {
            const albumMid = qqData.data.track_info.album.mid
            const coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(coverUrl, song.id).run()
            updated++
          }
        } catch {}
      }

      for (const song of kugouSongs) {
        const match = (song.external_url || '').match(/^kugou:(.+)$/)
        if (!match) continue
        const hash = match[1]
        try {
          const songData = await safeFetch(
            `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${encodeURIComponent(hash)}`,
            KUGOU_HEADERS
          )
          if (songData && songData.data && songData.data.img) {
            await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(songData.data.img, song.id).run()
            updated++
          } else if (songData && songData.data && songData.data.album_id) {
            const albumData = await safeFetch(
              `https://mobileservice.kugou.com/api/v3/album/info?albumid=${songData.data.album_id}`,
              KUGOU_HEADERS
            )
            if (albumData && albumData.data && albumData.data.imgurl) {
              const coverUrl = albumData.data.imgurl.replace('{size}', '400')
              await c.env.DB.prepare('UPDATE music SET cover_path = ? WHERE id = ?').bind(coverUrl, song.id).run()
              updated++
            }
          }
        } catch {}
      }

      return c.json({ updated, total: songs.length })
    } catch (err) {
      return c.json({ error: '更新封面失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })
}