export function registerMediaRoutes(app) {
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
    try {
      return base64ToBytes(data)
    } catch {
      return commaStringToBytes(data)
    }
  }

  async function storeChunks(db, mediaId, base64Data) {
    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      await db.prepare(
        'INSERT INTO media_chunks (media_id, chunk_index, data) VALUES (?, ?, ?)'
      ).bind(mediaId, i, chunk).run()
    }
  }

  async function readChunks(db, mediaId) {
    const { results } = await db.prepare(
      'SELECT chunk_index, data FROM media_chunks WHERE media_id = ? ORDER BY chunk_index'
    ).bind(mediaId).all()

    if (!results || results.length === 0) {
      const legacy = await db.prepare(
        'SELECT data FROM media_files WHERE id = ?'
      ).bind(mediaId).first()
      if (legacy && legacy.data) return legacy.data
      return null
    }

    let combined = ''
    for (const row of results) {
      combined += row.data
    }
    return combined
  }

  async function deleteChunks(db, mediaId) {
    await db.prepare('DELETE FROM media_chunks WHERE media_id = ?').bind(mediaId).run()
    await db.prepare('DELETE FROM media_files WHERE id = ?').bind(mediaId).run()
  }

  function getMimeTypeCategory(mime) {
    if (!mime) return 'other'
    const m = mime.toLowerCase()
    if (m.startsWith('image/')) return 'image'
    if (m.startsWith('video/')) return 'video'
    if (m.startsWith('audio/')) return 'audio'
    if (m === 'application/pdf') return 'pdf'
    if (m.includes('word') || m.includes('document')) return 'document'
    if (m.includes('sheet') || m.includes('excel')) return 'document'
    if (m.includes('presentation') || m.includes('powerpoint')) return 'document'
    if (m.includes('zip') || m.includes('rar') || m.includes('7z') || m.includes('tar') || m.includes('compressed')) return 'archive'
    if (m.startsWith('text/') || m.includes('json') || m.includes('xml') || m.includes('yaml')) return 'text'
    return 'other'
  }

  app.get('/api/media', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const page = Math.max(1, parseInt(c.req.query('page')) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize')) || 20))
      const offset = (page - 1) * pageSize
      const search = (c.req.query('search') || '').trim()
      const type = (c.req.query('type') || '').trim().toLowerCase()
      const sort = (c.req.query('sort') || 'date_desc').toLowerCase()
      const date = (c.req.query('date') || '').trim().toLowerCase()

      let whereClauses = []
      let bindings = []

      if (search) {
        whereClauses.push('filename LIKE ?')
        bindings.push('%' + search + '%')
      }

      if (date && date !== 'all') {
        if (date === 'today') {
          whereClauses.push("created_at >= datetime('now', '+8 hours', '-1 day')")
        } else if (date === 'week') {
          whereClauses.push("created_at >= datetime('now', '+8 hours', '-7 days')")
        } else if (date === 'month') {
          whereClauses.push("created_at >= datetime('now', '+8 hours', '-30 days')")
        }
      }

      if (type && type !== 'all') {
        if (type === 'image') {
          whereClauses.push("(mime_type LIKE 'image/%')")
        } else if (type === 'video') {
          whereClauses.push("(mime_type LIKE 'video/%')")
        } else if (type === 'audio') {
          whereClauses.push("(mime_type LIKE 'audio/%')")
        } else if (type === 'pdf') {
          whereClauses.push("(mime_type = 'application/pdf')")
        } else if (type === 'document') {
          whereClauses.push("(mime_type LIKE '%word%' OR mime_type LIKE '%document%' OR mime_type LIKE '%sheet%' OR mime_type LIKE '%excel%' OR mime_type LIKE '%presentation%' OR mime_type LIKE '%powerpoint%')")
        } else if (type === 'archive') {
          whereClauses.push("(mime_type LIKE '%zip%' OR mime_type LIKE '%rar%' OR mime_type LIKE '%7z%' OR mime_type LIKE '%tar%' OR mime_type LIKE '%compressed%')")
        } else if (type === 'text') {
          whereClauses.push("(mime_type LIKE 'text/%' OR mime_type LIKE '%json%' OR mime_type LIKE '%xml%' OR mime_type LIKE '%yaml%')")
        } else {
          whereClauses.push("(mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%' AND mime_type != 'application/pdf')")
        }
      }

      const whereStr = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : ''

      const totalRow = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM media' + whereStr
      ).bind(...bindings).first()
      const total = totalRow.count

      let orderClause = 'ORDER BY created_at DESC'
      switch (sort) {
        case 'date_asc': orderClause = 'ORDER BY created_at ASC'; break
        case 'name_asc': orderClause = 'ORDER BY filename ASC'; break
        case 'name_desc': orderClause = 'ORDER BY filename DESC'; break
        case 'size_asc': orderClause = 'ORDER BY size ASC'; break
        case 'size_desc': orderClause = 'ORDER BY size DESC'; break
        case 'type': orderClause = 'ORDER BY mime_type ASC, created_at DESC'; break
        default: orderClause = 'ORDER BY created_at DESC'
      }

      const { results } = await c.env.DB.prepare(
        'SELECT * FROM media ' + whereStr + ' ' + orderClause + ' LIMIT ? OFFSET ?'
      ).bind(...bindings, pageSize, offset).all()

      return c.json({
        media: results,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/api/media/stats', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const totalRow = await c.env.DB.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM media').first()
      const typeRows = await c.env.DB.prepare('SELECT mime_type, COUNT(*) as count, COALESCE(SUM(size), 0) as size FROM media GROUP BY mime_type ORDER BY count DESC').all()

      const byType = {}
      if (typeRows.results) {
        for (const row of typeRows.results) {
          const cat = getMimeTypeCategory(row.mime_type)
          if (!byType[cat]) {
            byType[cat] = { count: 0, size: 0 }
          }
          byType[cat].count += row.count
          byType[cat].size += row.size
        }
      }

      return c.json({
        totalFiles: totalRow.count,
        totalSize: totalRow.totalSize,
        byType
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/media/batch-delete', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const { ids } = await c.req.json()
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json({ error: '请选择要删除的文件' }, 400)
      }

      let deleted = 0
      let failed = 0
      for (const id of ids) {
        try {
          await deleteChunks(c.env.DB, id)
          await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run()
          deleted++
        } catch {
          failed++
        }
      }

      return c.json({ message: `成功删除 ${deleted} 个文件${failed > 0 ? `，${failed} 个失败` : ''}`, deleted, failed })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/media/upload', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const formData = await c.req.parseBody()
      const file = formData.file

      if (!file) {
        return c.json({ error: '请选择文件' }, 400)
      }

      const ext = file.name.split('.').pop().toLowerCase() || 'bin'
      const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.' + ext
      const path = '/uploads/' + filename

      const fileBuffer = await file.arrayBuffer()
      const base64Data = arrayBufferToBase64(fileBuffer)
      const alt_text = formData.alt_text || ''

      const result = await c.env.DB.prepare(
        "INSERT INTO media (filename, path, size, mime_type, alt_text, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'))"
      ).bind(file.name, path, file.size, file.type || 'application/octet-stream', alt_text).run()

      const mediaId = result.meta.last_row_id

      try {
        await storeChunks(c.env.DB, mediaId, base64Data)
      } catch (chunkErr) {
        await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId).run()
        return c.json({ error: '文件存储失败: ' + (chunkErr.message || '数据过大') }, 500)
      }

      const media = await c.env.DB.prepare(
        'SELECT * FROM media WHERE id = ?'
      ).bind(mediaId).first()

      return c.json(media, 201)
    } catch (err) {
      return c.json({ error: '上传失败: ' + (err.message || '服务器内部错误') }, 500)
    }
  })

  app.delete('/api/media/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const id = c.req.param('id')
      const media = await c.env.DB.prepare(
        'SELECT * FROM media WHERE id = ?'
      ).bind(id).first()

      if (!media) {
        return c.json({ error: '媒体文件不存在' }, 404)
      }

      await deleteChunks(c.env.DB, id)
      await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run()

      return c.json({ message: '删除成功' })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.put('/api/media/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const id = c.req.param('id')
      const media = await c.env.DB.prepare(
        'SELECT * FROM media WHERE id = ?'
      ).bind(id).first()

      if (!media) {
        return c.json({ error: '媒体文件不存在' }, 404)
      }

      const contentType = c.req.header('Content-Type') || ''
      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.parseBody()
        const file = formData.file
        if (!file) {
          return c.json({ error: '请选择文件' }, 400)
        }
        const fileBuffer = await file.arrayBuffer()
        const base64Data = arrayBufferToBase64(fileBuffer)
        await deleteChunks(c.env.DB, id)
        try {
          await storeChunks(c.env.DB, id, base64Data)
        } catch (chunkErr) {
          return c.json({ error: '文件存储失败: ' + (chunkErr.message || '数据过大') }, 500)
        }
        await c.env.DB.prepare(
          'UPDATE media SET size = ?, mime_type = ? WHERE id = ?'
        ).bind(file.size, file.type || media.mime_type, id).run()
        const updated = await c.env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(id).first()
        return c.json(updated)
      }

      const body = await c.req.json()
      const updates = []
      const values = []

      if (body.alt_text !== undefined) {
        updates.push('alt_text = ?')
        values.push(body.alt_text)
      }
      if (body.filename !== undefined) {
        updates.push('filename = ?')
        values.push(body.filename)
      }

      if (updates.length === 0) {
        return c.json(media)
      }

      values.push(id)
      await c.env.DB.prepare(
        'UPDATE media SET ' + updates.join(', ') + ' WHERE id = ?'
      ).bind(...values).run()

      const updated = await c.env.DB.prepare(
        'SELECT * FROM media WHERE id = ?'
      ).bind(id).first()

      return c.json(updated)
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/uploads/:filename', async (c) => {
    try {
      const filename = c.req.param('filename')
      const media = await c.env.DB.prepare(
        "SELECT m.id, m.mime_type FROM media m WHERE m.path = '/uploads/' || ?"
      ).bind(filename).first()

      if (!media) {
        return c.json({ error: '文件不存在' }, 404)
      }

      const storedData = await readChunks(c.env.DB, media.id)

      if (!storedData) {
        return c.json({ error: '文件数据不存在' }, 404)
      }

      const bytes = decodeStoredData(storedData)

      const headers = {
        'Content-Type': media.mime_type || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000',
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline; filename="' + filename + '"'
      }

      return new Response(bytes, { headers })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })
}
