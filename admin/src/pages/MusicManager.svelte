<script>
  import { onMount } from 'svelte'
  import { music } from '../api.js'
  import { addToast } from '../stores.svelte.js'
  import { onSSE } from '../lib/sse.js'

  let songs = $state([])
  let loading = $state(true)
  let search = $state('')
  let musicPage = $state(1)
  let musicPageSize = $state(20)

  let showAddForm = $state(false)
  let editingId = $state(null)
  let form = $state({ title: '', artist: '', external_url: '', cover_path: '', duration: 0 })
  let formError = $state('')
  let formSaving = $state(false)

  let deletingId = $state(null)

  let activeTab = $state('list')
  let platform = $state('netease')
  let platformKeyword = $state('')
  let platformSearching = $state(false)
  let platformResults = $state([])
  let platformImporting = $state(false)
  let platformSelected = $state(new Set())
  let platformSearched = $state(false)
  let platformMessage = $state('')

  let playlistId = $state('')
  let playlistLoading = $state(false)
  let playlistData = $state(null)
  let playlistImporting = $state(false)
  let playlistSelected = $state(new Set())
  let playlistError = $state('')

  let batchText = $state('')
  let batchResults = $state(null)
  let batchImporting = $state(false)

  let sourceFilter = $state('')
  let coverUpdating = $state(false)

  let filteredSongs = $derived(
    sourceFilter
      ? songs.filter(s => s.source === sourceFilter || (!s.source && sourceFilter === 'upload'))
      : songs
  )

  let searchFiltered = $derived(
    search ? filteredSongs.filter(s => {
      const q = search.toLowerCase()
      return s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)
    }) : filteredSongs
  )

  $effect(() => { search; sourceFilter; musicPage = 1 })

  let totalPages = $derived(Math.max(1, Math.ceil(searchFiltered.length / musicPageSize)))
  let pagedSongs = $derived(searchFiltered.slice((musicPage - 1) * musicPageSize, musicPage * musicPageSize))

  let stats = $derived({
    total: songs.length,
    netease: songs.filter(s => s.source === 'netease').length,
    qq: songs.filter(s => s.source === 'qq').length,
    kugou: songs.filter(s => s.source === 'kugou').length,
    external: songs.filter(s => s.source === 'external').length,
    upload: songs.filter(s => s.source === 'upload' || !s.source).length
  })

  async function loadData(silent = false) {
    if (!silent) loading = true
    try {
      const data = await music.list()
      songs = data.songs || []
    } catch (e) {
      if (!silent) addToast('加载失败', 'error')
    }
    if (!silent) loading = false
  }

  function resetForm() {
    form = { title: '', artist: '', external_url: '', cover_path: '', duration: 0 }
    formError = ''
    editingId = null
  }

  function openAdd() {
    resetForm()
    showAddForm = true
  }

  function openEdit(song) {
    form = {
      title: song.title || '',
      artist: song.artist || '',
      external_url: song.external_url || '',
      cover_path: song.cover_path || '',
      duration: song.duration || 0
    }
    formError = ''
    editingId = song.id
    showAddForm = true
  }

  function closeForm() {
    showAddForm = false
    resetForm()
  }

  async function handleSubmit() {
    formError = ''
    if (!form.title.trim()) { formError = '请输入歌曲名称'; return }
    if (!editingId && !form.external_url.trim()) { formError = '请输入音乐链接'; return }

    formSaving = true
    try {
      if (editingId) {
        await music.update(editingId, {
          title: form.title.trim(),
          artist: form.artist.trim(),
          external_url: form.external_url.trim(),
          cover_path: form.cover_path.trim()
        })
        addToast('已更新', 'success')
      } else {
        await music.add({
          title: form.title.trim(),
          artist: form.artist.trim(),
          external_url: form.external_url.trim(),
          cover_path: form.cover_path.trim(),
          duration: form.duration || 0
        })
        addToast('已添加', 'success')
      }
      closeForm()
      loadData()
    } catch (e) {
      addToast(e.message || '保存失败', 'error')
    }
    formSaving = false
  }

  async function handleDelete(id) {
    try {
      await music.delete(id)
      addToast('已删除', 'success')
      deletingId = null
      loadData()
    } catch (e) {
      addToast(e.message || '删除失败', 'error')
      deletingId = null
    }
  }

  const NETEASE_API = 'https://neteasecloudmusicapi.ivelly.com'

  async function neteaseSearchDirect(keyword) {
    const resp = await fetch(`${NETEASE_API}/search?keywords=${encodeURIComponent(keyword)}&limit=100&offset=0`)
    if (!resp.ok) throw new Error('网易云服务请求失败')
    const data = await resp.json()
    if (data.code !== 200 || !data.result || !data.result.songs || data.result.songs.length === 0) {
      return { songs: [], message: '未找到相关歌曲' }
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
    try {
      const allIds = songs.map(s => s.id)
      const batchSize = 50
      const coverMap = {}
      for (let i = 0; i < allIds.length; i += batchSize) {
        const batchIds = allIds.slice(i, i + batchSize)
        const idsParam = batchIds.join(',')
        const detailResp = await fetch(`${NETEASE_API}/song/detail?ids=${idsParam}`)
        if (detailResp.ok) {
          const detailData = await detailResp.json()
          if (detailData.songs) {
            detailData.songs.forEach(s => { coverMap[s.id] = (s.al || {}).picUrl || '' })
          }
        }
      }
      songs.forEach(s => { if (coverMap[s.id]) s.cover = coverMap[s.id] })
    } catch {}
    return { songs }
  }

  async function neteasePlaylistDirect(id) {
    const resp = await fetch(`${NETEASE_API}/playlist/detail?id=${id}`)
    if (!resp.ok) throw new Error('网易云服务请求失败')
    const data = await resp.json()
    if (data.code !== 200 || !data.playlist) throw new Error('无法获取歌单')
    const playlist = data.playlist
    const songs = (playlist.tracks || []).map(s => ({
      id: s.id,
      title: s.name,
      artist: (s.ar || s.artists || []).map(a => a.name).join(' / '),
      album: (s.al || s.album || {}).name || '',
      duration: Math.round((s.dt || s.duration || 0) / 1000),
      cover: (s.al || s.album || {}).picUrl || '',
      external_url: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`
    }))
    return {
      name: playlist.name,
      description: playlist.description || '',
      cover: playlist.coverImgUrl || '',
      trackCount: playlist.trackCount || songs.length,
      songs
    }
  }

  async function handlePlatformSearch() {
    if (!platformKeyword.trim()) return
    platformSearching = true
    platformResults = []
    platformSelected = new Set()
    platformSearched = false
    platformMessage = ''
    try {
      let data
      if (platform === 'netease') {
        try {
          data = await neteaseSearchDirect(platformKeyword.trim())
        } catch {
          data = await music.neteaseSearch(platformKeyword.trim())
        }
      } else if (platform === 'qq') {
        data = await music.qqSearch(platformKeyword.trim())
      } else if (platform === 'kugou') {
        data = await music.kugouSearch(platformKeyword.trim())
      }
      platformResults = data.songs || []
      platformMessage = data.message || ''
      platformSearched = true
      if (platformResults.length === 0 && !platformMessage) {
        platformMessage = '未找到相关歌曲'
      }
    } catch (e) {
      platformSearched = true
      platformMessage = e.message || '搜索失败，请稍后再试'
    }
    platformSearching = false
  }

  async function handlePlatformImport() {
    const selected = platformResults.filter(s => platformSelected.has(s.id))
    if (selected.length === 0) { addToast('请先选择歌曲', 'error'); return }

    platformImporting = true
    try {
      const result = await music.neteaseImport(selected.map(s => ({ ...s, _source: platform })))
      addToast(`成功导入 ${result.ok}/${result.total} 首歌曲`, 'success')
      platformSelected = new Set()
      loadData()
    } catch (e) {
      addToast(e.message || '导入失败', 'error')
    }
    platformImporting = false
  }

  function extractPlaylistId(input) {
    const trimmed = input.trim()
    const m = trimmed.match(/[?&]id=(\d+)/)
    if (m) return m[1]
    if (/^\d+$/.test(trimmed)) return trimmed
    return ''
  }

  async function handlePlaylistFetch() {
    const id = extractPlaylistId(playlistId)
    if (!id) { playlistError = '请输入歌单链接或 ID'; return }
    playlistLoading = true
    playlistData = null
    playlistSelected = new Set()
    playlistError = ''
    try {
      let data
      if (platform === 'qq') {
        data = await music.qqPlaylist(id)
      } else {
        try {
          data = await neteasePlaylistDirect(id)
        } catch {
          data = await music.neteasePlaylist(id)
        }
      }
      playlistData = data
    } catch (e) {
      playlistError = e.message || '获取歌单失败'
    }
    playlistLoading = false
  }

  async function handlePlaylistImport() {
    if (!playlistData) return
    const selected = playlistData.songs.filter(s => playlistSelected.has(s.id))
    if (selected.length === 0) { addToast('请先选择歌曲', 'error'); return }

    playlistImporting = true
    try {
      const source = platform === 'qq' ? 'qq' : 'netease'
      const result = await music.neteaseImport(selected.map(s => ({ ...s, _source: source })))
      addToast(`成功导入 ${result.ok}/${result.total} 首歌曲`, 'success')
      playlistSelected = new Set()
      loadData()
    } catch (e) {
      addToast(e.message || '导入失败', 'error')
    }
    playlistImporting = false
  }

  function parsePlaylistText(text) {
    const lines = text.split('\n').filter(l => l.trim())
    const result = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const urlMatch = trimmed.match(/(https?:\/\/[^\s]+\.(?:mp3|wav|ogg|oga|m4a|aac|flac|webm|wma)(?:\?[^\s]*)?)/i)
      if (!urlMatch) {
        const genericUrl = trimmed.match(/(https?:\/\/[^\s]+)/i)
        if (genericUrl) {
          const url = genericUrl[1]
          const rest = trimmed.replace(url, '').replace(/\s*-\s*$/, '').trim()
          const parts = rest.split(/\s*-\s*/)
          const title = (parts[0] || url.split('/').pop()?.split('?')[0] || '未知歌曲').trim()
          const artist = (parts[1] || '').trim()
          result.push({ title, artist, external_url: url, cover_path: '', duration: 0 })
          continue
        }
        continue
      }
      const url = urlMatch[1]
      const rest = trimmed.replace(url, '').replace(/\s*-\s*$/, '').trim()
      const parts = rest.split(/\s*-\s*/)
      const title = (parts[0] || url.split('/').pop()?.split('?')[0]?.replace(/\.[^.]+$/, '') || '未知歌曲').trim()
      const artist = (parts[1] || '').trim()
      result.push({ title, artist, external_url: url, cover_path: '', duration: 0 })
    }
    return result
  }

  async function handleBatchImport() {
    const parsed = parsePlaylistText(batchText)
    if (parsed.length === 0) { addToast('未能解析到有效歌曲，请检查格式', 'error'); return }

    batchImporting = true
    batchResults = null
    try {
      const result = await music.batch(parsed)
      batchResults = result
      if (result.ok > 0) {
        addToast(`成功导入 ${result.ok}/${result.total} 首歌曲`, 'success')
        loadData()
      } else {
        addToast('没有歌曲被导入，请检查链接是否有效', 'error')
      }
    } catch (e) {
      addToast(e.message || '导入失败', 'error')
    }
    batchImporting = false
  }

  async function handleUpdateCovers() {
    coverUpdating = true
    try {
      const result = await music.updateCovers()
      addToast(`已更新 ${result.updated}/${result.total} 首歌曲的封面`, 'success')
      loadData()
    } catch (e) {
      addToast(e.message || '更新封面失败', 'error')
    }
    coverUpdating = false
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return '--'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return m + ':' + (sec < 10 ? '0' : '') + sec
  }

  function toggleSelection(set, id) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  function toggleAll(sourceArr, currentSet) {
    if (currentSet.size === sourceArr.length) return new Set()
    return new Set(sourceArr.map(s => s.id))
  }

  onMount(() => {
    loadData()
    const off = onSSE((data) => {
      if (data.resources.includes('music')) loadData(true)
    })
    return off
  })
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">音乐管理</h2>
    <div class="flex items-center gap-2">
      <button
        onclick={handleUpdateCovers}
        disabled={coverUpdating}
        class="px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur hover:bg-white/80 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >{coverUpdating ? '更新中...' : '更新封面'}</button>
      <button
        onclick={openAdd}
        class="px-5 py-2 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-sm font-medium transition-colors"
      >
        + 添加歌曲
      </button>
    </div>
  </div>

  <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
    <button onclick={() => { sourceFilter = ''; musicPage = 1 }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 text-left transition-all duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.02] {sourceFilter === '' ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">全部</p>
      <p class="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
    </button>
    <button onclick={() => { sourceFilter = 'netease'; musicPage = 1 }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 text-left transition-all duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.02] {sourceFilter === 'netease' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">网易云</p>
      <p class="text-xl font-bold text-red-500 dark:text-red-400">{stats.netease}</p>
    </button>
    <button onclick={() => { sourceFilter = 'qq'; musicPage = 1 }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 text-left transition-all duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.02] {sourceFilter === 'qq' ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">QQ</p>
      <p class="text-xl font-bold text-green-600 dark:text-green-400">{stats.qq}</p>
    </button>
    <button onclick={() => { sourceFilter = 'kugou'; musicPage = 1 }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 text-left transition-all duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.02] {sourceFilter === 'kugou' ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">酷狗</p>
      <p class="text-xl font-bold text-blue-600 dark:text-blue-400">{stats.kugou}</p>
    </button>
    <button onclick={() => { sourceFilter = 'external'; musicPage = 1 }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 text-left transition-all duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.02] {sourceFilter === 'external' ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">网络</p>
      <p class="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.external}</p>
    </button>
    <button onclick={() => { sourceFilter = 'upload'; musicPage = 1 }} class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border p-3 text-left transition-all duration-200 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-md hover:scale-[1.02] {sourceFilter === 'upload' ? 'border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-700/50' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}">
      <p class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">本地</p>
      <p class="text-xl font-bold text-gray-600 dark:text-gray-300">{stats.upload}</p>
    </button>
  </div>

  <div class="flex gap-2 border-b border-gray-200 dark:border-gray-700">
    <button
      onclick={() => activeTab = 'list'}
      class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'list' ? 'text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
    >歌曲列表</button>
    <button
      onclick={() => activeTab = 'netease'}
      class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'netease' ? 'text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
    >平台导入</button>
    <button
      onclick={() => activeTab = 'batch'}
      class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'batch' ? 'text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}"
    >批量导入</button>
  </div>

  {#if activeTab === 'list'}
    <div class="relative">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <input
        type="text"
        placeholder="搜索歌曲..."
        bind:value={search}
        class="w-full max-w-xs pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
      />
    </div>

    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/20 dark:border-gray-700/20 bg-white/40 dark:bg-gray-800/40">
              <th class="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-10">#</th>
              <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-12"></th>
              <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">歌曲</th>
              <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">来源</th>
              <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">时长</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/10 dark:divide-gray-700/10">
            {#if loading}
              <tr><td colspan="6" class="px-5 py-8 text-center text-gray-400 dark:text-gray-500">加载中...</td></tr>
            {:else if searchFiltered.length === 0}
              <tr>
                <td colspan="6" class="px-5 py-12 text-center">
                  <div class="flex flex-col items-center gap-3 text-gray-400 dark:text-gray-500">
                    <svg viewBox="0 0 24 24" fill="currentColor" class="w-10 h-10 opacity-40"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                    <span class="text-sm">{search ? '没有找到匹配的歌曲' : '还没有添加歌曲'}</span>
                    {#if !search}
                      <button onclick={openAdd} class="text-xs px-4 py-1.5 rounded-full bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900 hover:bg-gray-800/80 dark:hover:bg-gray-200/80 transition-colors">添加第一首歌</button>
                    {/if}
                  </div>
                </td>
              </tr>
            {:else}
              {#each pagedSongs as song, i}
                <tr class="hover:bg-white/30 dark:hover:bg-gray-700/30 transition-colors">
                  <td class="px-5 py-3 text-sm text-gray-400 dark:text-gray-500 text-center">{(musicPage - 1) * musicPageSize + i + 1}</td>
                  <td class="px-3 py-3">
                    {#if song.cover_path}
                      <img src="/api/music/cover/{song.id}" alt="" class="w-9 h-9 rounded-lg object-cover" />
                    {:else}
                      <div class="w-9 h-9 rounded-lg bg-gray-200/50 dark:bg-gray-700/50 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-gray-400 dark:text-gray-500"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                      </div>
                    {/if}
                  </td>
                  <td class="px-3 py-3">
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{song.title}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{song.artist || '未知艺术家'}</div>
                  </td>
                  <td class="px-3 py-3 whitespace-nowrap">
                    {#if song.source === 'netease'}
                      <span class="inline-block text-xs px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 font-medium">网易</span>
                    {:else if song.source === 'qq'}
                      <span class="inline-block text-xs px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium">QQ</span>
                    {:else if song.source === 'kugou'}
                      <span class="inline-block text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">酷狗</span>
                    {:else if song.source === 'external'}
                      <span class="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 font-medium">网络</span>
                    {:else}
                      <span class="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 font-medium">本地</span>
                    {/if}
                  </td>
                  <td class="px-3 py-3 text-sm text-gray-500 dark:text-gray-400 tabular-nums">{song.duration ? formatTime(song.duration) : '--'}</td>
                  <td class="px-3 sm:px-5 py-3 text-right whitespace-nowrap">
                    <div class="flex items-center justify-end gap-1 flex-nowrap">
                      <button onclick={() => openEdit(song)} class="text-xs px-2 py-1 sm:px-2.5 rounded-full text-gray-900 dark:text-gray-100 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap">编辑</button>
                      {#if song.external_url}
                        <a href={song.external_url} target="_blank" rel="noopener" class="text-xs px-2 py-1 sm:px-2.5 rounded-full text-gray-500 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors whitespace-nowrap">链接</a>
                      {/if}
                      <button onclick={() => deletingId = song.id} class="text-xs px-2 py-1 sm:px-2.5 rounded-full text-red-600 dark:text-red-400 hover:bg-red-50/60 dark:hover:bg-red-900/30 transition-colors whitespace-nowrap">删除</button>
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    {#if searchFiltered.length > musicPageSize}
      <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">共 {searchFiltered.length} 首</span>
            <select onchange={(e) => { musicPageSize = parseInt(e.target.value); musicPage = 1 }} class="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-gray-400">
              <option value="10" selected={musicPageSize === 10}>10条/页</option>
              <option value="20" selected={musicPageSize === 20}>20条/页</option>
              <option value="50" selected={musicPageSize === 50}>50条/页</option>
            </select>
          </div>
          <div class="flex gap-2 shrink-0">
            <button onclick={() => { if (musicPage > 1) musicPage-- }} disabled={musicPage <= 1} class="px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
            <button onclick={() => { if (musicPage < totalPages) musicPage++ }} disabled={musicPage >= totalPages} class="px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
          </div>
        </div>
        <div class="flex items-center justify-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <span class="text-sm text-gray-400 dark:text-gray-500">第 {musicPage} / {totalPages} 页</span>
        </div>
      </div>
    {/if}
  {/if}

  {#if activeTab === 'netease'}
    <div class="space-y-4">
      <div class="flex gap-2">
        <button onclick={() => { platform = 'netease'; platformResults = []; platformSearched = false; platformMessage = '' }} class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors {platform === 'netease' ? 'bg-red-500/70 text-white' : 'bg-white/40 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60'}">网易云音乐</button>
        <button onclick={() => { platform = 'qq'; platformResults = []; platformSearched = false; platformMessage = '' }} class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors {platform === 'qq' ? 'bg-green-500/70 text-white' : 'bg-white/40 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60'}">QQ音乐</button>
        <button onclick={() => { platform = 'kugou'; platformResults = []; platformSearched = false; platformMessage = '' }} class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors {platform === 'kugou' ? 'bg-blue-500/70 text-white' : 'bg-white/40 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/60'}">酷狗音乐</button>
      </div>

      <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">搜索歌曲</h3>
        <div class="flex gap-2">
          <input
            type="text"
            placeholder="输入歌曲名或歌手名..."
            bind:value={platformKeyword}
            onkeydown={(e) => { if (e.key === 'Enter') handlePlatformSearch() }}
            class="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
          />
          <button
            onclick={handlePlatformSearch}
            disabled={platformSearching}
            class="px-5 py-2 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-sm transition-colors disabled:opacity-50"
          >{platformSearching ? '搜索中...' : '搜索'}</button>
        </div>

        {#if platformSearching}
          <div class="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
            <svg class="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            搜索中...
          </div>
        {/if}

        {#if platformSearched && !platformSearching && platformResults.length === 0}
          <div class="flex flex-col items-center py-8 text-gray-400 dark:text-gray-500">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-10 h-10 opacity-40 mb-2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <span class="text-sm">{platformMessage || '未找到相关歌曲'}</span>
          </div>
        {/if}

        {#if platformResults.length > 0}
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={platformSelected.size === platformResults.length} onchange={() => platformSelected = toggleAll(platformResults, platformSelected)} class="rounded" />
              全选 ({platformSelected.size}/{platformResults.length})
            </label>
            <button
              onclick={handlePlatformImport}
              disabled={platformImporting || platformSelected.size === 0}
              class="px-4 py-1.5 rounded-full bg-red-500/70 dark:bg-red-600/70 backdrop-blur hover:bg-red-600/70 dark:hover:bg-red-700/70 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >{platformImporting ? '导入中...' : `导入选中 (${platformSelected.size})`}</button>
          </div>
          <div class="divide-y divide-gray-100 dark:divide-gray-700/30 max-h-[400px] overflow-y-auto">
            {#each platformResults as song}
              <label class="flex items-center gap-3 px-2 py-2.5 hover:bg-white/30 dark:hover:bg-gray-700/30 rounded-lg cursor-pointer transition-colors">
                <input type="checkbox" checked={platformSelected.has(song.id)} onchange={() => platformSelected = toggleSelection(platformSelected, song.id)} class="rounded" />
                {#if song.cover}
                  <img src={song.cover + (platform === 'netease' ? '?param=80y80' : '')} alt="" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                {:else}
                  <div class="w-10 h-10 rounded-lg bg-gray-200/50 dark:bg-gray-700/50 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-gray-400 dark:text-gray-500"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                  </div>
                {/if}
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{song.title}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{song.artist}{song.album ? ' · ' + song.album : ''}</div>
                </div>
                <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">{formatTime(song.duration)}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      {#if platform === 'netease' || platform === 'qq'}
        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">导入歌单</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">直接粘贴歌单链接或输入 ID，如 <code class="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700/50">{platform === 'qq' ? 'https://y.qq.com/n/ryqq/playlist/123456' : 'https://music.163.com/playlist?id=123456'}</code></p>
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="粘贴歌单链接或输入 ID..."
              bind:value={playlistId}
              onkeydown={(e) => { if (e.key === 'Enter') handlePlaylistFetch() }}
              class="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
            />
            <button
              onclick={handlePlaylistFetch}
              disabled={playlistLoading}
              class="px-5 py-2 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-sm transition-colors disabled:opacity-50"
            >{playlistLoading ? '获取中...' : '获取歌单'}</button>
          </div>

          {#if playlistLoading}
            <div class="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
              <svg class="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              获取歌单中...
            </div>
          {/if}

          {#if playlistError}
            <div class="px-3 py-2.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl text-sm">{playlistError}</div>
          {/if}

          {#if playlistData}
            <div class="flex items-center gap-3 p-3 bg-white/40 dark:bg-gray-700/40 rounded-xl">
              {#if playlistData.cover}
                <img src={playlistData.cover + (platform === 'netease' ? '?param=200y200' : '')} alt="" class="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              {/if}
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{playlistData.name}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">{playlistData.trackCount} 首歌曲</div>
                {#if playlistData.description}
                  <div class="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{playlistData.description}</div>
                {/if}
              </div>
            </div>

            <div class="flex items-center justify-between">
              <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={playlistSelected.size === playlistData.songs.length} onchange={() => playlistSelected = toggleAll(playlistData.songs, playlistSelected)} class="rounded" />
                全选 ({playlistSelected.size}/{playlistData.songs.length})
              </label>
              <button
                onclick={handlePlaylistImport}
                disabled={playlistImporting || playlistSelected.size === 0}
                class="px-4 py-1.5 rounded-full bg-red-500/70 dark:bg-red-600/70 backdrop-blur hover:bg-red-600/70 dark:hover:bg-red-700/70 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >{playlistImporting ? '导入中...' : `导入选中 (${playlistSelected.size})`}</button>
            </div>

            <div class="divide-y divide-gray-100 dark:divide-gray-700/30 max-h-[400px] overflow-y-auto">
              {#each playlistData.songs as song}
                <label class="flex items-center gap-3 px-2 py-2.5 hover:bg-white/30 dark:hover:bg-gray-700/30 rounded-lg cursor-pointer transition-colors">
                  <input type="checkbox" checked={playlistSelected.has(song.id)} onchange={() => playlistSelected = toggleSelection(playlistSelected, song.id)} class="rounded" />
                  {#if song.cover}
                    <img src={song.cover + (platform === 'netease' ? '?param=80y80' : '')} alt="" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  {:else}
                    <div class="w-10 h-10 rounded-lg bg-gray-200/50 dark:bg-gray-700/50 flex items-center justify-center flex-shrink-0">
                      <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-gray-400 dark:text-gray-500"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                    </div>
                  {/if}
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{song.title}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{song.artist}{song.album ? ' · ' + song.album : ''}</div>
                  </div>
                  <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">{formatTime(song.duration)}</span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if activeTab === 'batch'}
    <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">批量导入歌单</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">每行一首歌，格式：<code class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/50 text-xs">歌曲名 - 艺术家 - 链接</code>（艺术家可选）</p>
      <textarea
        rows="8"
        bind:value={batchText}
        placeholder="夜曲 - 周杰伦 - https://example.com/yeque.mp3&#10;晴天 - 周杰伦 - https://example.com/qingtian.mp3&#10;https://example.com/another.mp3"
        class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none resize-y font-mono leading-relaxed"
      ></textarea>
      {#if batchResults}
        <div class="px-3 py-2.5 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-100">导入完成：成功 {batchResults.ok}/{batchResults.total} 首</div>
          {#each batchResults.results.filter(r => r.status !== 'ok') as r}
            <div class="text-xs text-red-500 dark:text-red-400 mt-1">{r.title}: {r.reason}</div>
          {/each}
        </div>
      {/if}
      <div class="flex justify-end">
        <button
          onclick={handleBatchImport}
          disabled={batchImporting || !batchText.trim()}
          class="px-5 py-2 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >{batchImporting ? '导入中...' : '开始导入'}</button>
      </div>
    </div>
  {/if}
</div>

{#if showAddForm}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={closeForm}>
    <div class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-6 max-w-md w-full mx-4 border border-white/20 dark:border-gray-700/20" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {editingId ? '编辑歌曲' : '添加网络歌曲'}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">歌曲名称 *</label>
          <input type="text" bind:value={form.title} placeholder="歌曲名称" class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">艺术家</label>
          <input type="text" bind:value={form.artist} placeholder="艺术家" class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none" />
        </div>
        {#if !editingId || songs.find(s => s.id === editingId && s.source !== 'upload')}
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">音乐链接</label>
            <input type="text" bind:value={form.external_url} placeholder="https://example.com/music.mp3" class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none" />
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">支持直链 MP3/WAV/OGG/AAC/FLAC/WebM 等格式</p>
          </div>
        {/if}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">封面图片链接</label>
          <input type="text" bind:value={form.cover_path} placeholder="https://example.com/cover.jpg" class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">时长（秒）</label>
          <input type="number" bind:value={form.duration} min="0" step="1" placeholder="0" class="w-32 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none" />
        </div>
        {#if formError}
          <div class="px-3 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl text-sm">{formError}</div>
        {/if}
      </div>
      <div class="flex justify-end gap-3 mt-6">
        <button onclick={closeForm} class="px-4 py-2 rounded-full border border-white/30 dark:border-gray-700/30 bg-white/40 dark:bg-gray-800/40 backdrop-blur text-sm text-gray-700 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors">取消</button>
        <button onclick={handleSubmit} disabled={formSaving} class="px-4 py-2 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 text-white dark:text-gray-900 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{formSaving ? '保存中...' : '保存'}</button>
      </div>
    </div>
  </div>
{/if}

{#if deletingId}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => deletingId = null}>
    <div class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-6 max-w-sm w-full mx-4 border border-white/20 dark:border-gray-700/20" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">确认删除</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">确定要删除这首歌曲吗？此操作不可撤销。</p>
      <div class="flex justify-end gap-3">
        <button onclick={() => deletingId = null} class="px-4 py-2 rounded-full border border-white/30 dark:border-gray-700/30 bg-white/40 dark:bg-gray-800/40 backdrop-blur text-sm text-gray-700 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors">取消</button>
        <button onclick={() => handleDelete(deletingId)} class="px-4 py-2 rounded-full bg-red-500/70 dark:bg-red-600/70 backdrop-blur hover:bg-red-600/70 dark:hover:bg-red-700/70 text-white dark:text-gray-100 text-sm transition-colors">删除</button>
      </div>
    </div>
  </div>
{/if}
