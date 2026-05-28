<script>
  import { onMount } from 'svelte';

  let songs = $state([]);
  let currentIndex = $state(-1);
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(0.7);
  let showPlaylist = $state(false);
  let showPlayer = $state(false);
  let isDragging = $state(false);
  let isLoading = $state(true);
  let audioError = $state('');
  let playMode = $state('sequence');
  let progressBarEl = $state(null);
  let volumeBarEl = $state(null);

  let currentSong = $derived(currentIndex >= 0 && currentIndex < songs.length ? songs[currentIndex] : null);
  let progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
  let formattedCurrentTime = $derived(formatTime(currentTime));
  let formattedDuration = $derived(formatTime(duration));

  let audio = null;

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  }

  function getCoverColor(str) {
    if (!str) return '#6b7280';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = ((hash % 360) + 360) % 360;
    return `hsl(${h}, 45%, 45%)`;
  }

  function getCoverUrl(song) {
    if (!song) return '';
    if (song.cover_path) return song.cover_path;
    return '';
  }

  async function fetchSongs() {
    try {
      const res = await fetch('/api/music');
      if (res.ok) {
        const data = await res.json();
        songs = data.songs || [];
        if (songs.length > 0) showPlayer = true;
      }
    } catch (e) {
      console.error('Failed to fetch songs:', e);
    }
    isLoading = false;
  }

  function playSong(index) {
    if (index < 0 || index >= songs.length) return;
    currentIndex = index;
    audioError = '';
    const song = songs[index];
    audio.src = song.path;
    audio.load();
    audio.play().then(() => {
      isPlaying = true;
    }).catch(e => {
      console.error('Play failed:', e);
      audioError = '播放失败';
      isPlaying = false;
    });
  }

  function togglePlay() {
    if (!audio || !currentSong) return;
    if (isPlaying) {
      audio.pause();
      isPlaying = false;
    } else {
      audio.play().then(() => {
        isPlaying = true;
      }).catch(() => {
        isPlaying = false;
      });
    }
  }

  function nextSong() {
    if (songs.length === 0) return;
    if (playMode === 'shuffle') {
      let next = Math.floor(Math.random() * songs.length);
      if (songs.length > 1) {
        while (next === currentIndex) next = Math.floor(Math.random() * songs.length);
      }
      playSong(next);
    } else {
      playSong((currentIndex + 1) % songs.length);
    }
  }

  function prevSong() {
    if (songs.length === 0) return;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (playMode === 'shuffle') {
      let prev = Math.floor(Math.random() * songs.length);
      if (songs.length > 1) {
        while (prev === currentIndex) prev = Math.floor(Math.random() * songs.length);
      }
      playSong(prev);
    } else {
      playSong((currentIndex - 1 + songs.length) % songs.length);
    }
  }

  function handleEnded() {
    if (playMode === 'single') {
      audio.currentTime = 0;
      audio.play();
    } else {
      nextSong();
    }
  }

  function handleProgressClick(e) {
    if (!progressBarEl || !audio || !duration) return;
    const rect = progressBarEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = pct * duration;
    currentTime = audio.currentTime;
  }

  function handleProgressMouseDown(e) {
    isDragging = true;
    handleProgressClick(e);
    const onMouseMove = (ev) => {
      if (!progressBarEl || !audio || !duration) return;
      const rect = progressBarEl.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      audio.currentTime = pct * duration;
      currentTime = audio.currentTime;
    };
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function handleVolumeClick(e) {
    if (!volumeBarEl || !audio) return;
    const rect = volumeBarEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    volume = pct;
    audio.volume = pct;
  }

  function handleVolumeMouseDown(e) {
    handleVolumeClick(e);
    const onMouseMove = (ev) => {
      if (!volumeBarEl || !audio) return;
      const rect = volumeBarEl.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      volume = pct;
      audio.volume = pct;
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function toggleMute() {
    if (!audio) return;
    if (audio.volume > 0) {
      audio._prevVolume = audio.volume;
      volume = 0;
      audio.volume = 0;
    } else {
      volume = audio._prevVolume || 0.7;
      audio.volume = volume;
    }
  }

  function cyclePlayMode() {
    const modes = ['sequence', 'single', 'shuffle'];
    const idx = modes.indexOf(playMode);
    playMode = modes[(idx + 1) % modes.length];
  }

  function getVolumeIcon() {
    if (volume === 0) return 'mute';
    if (volume < 0.5) return 'low';
    return 'high';
  }

  function getPlayModeTitle() {
    if (playMode === 'single') return '单曲循环';
    if (playMode === 'shuffle') return '随机播放';
    return '列表循环';
  }

  $effect(() => {
    localStorage.setItem('music-volume', String(volume));
  });

  $effect(() => {
    localStorage.setItem('music-play-mode', playMode);
  });

  onMount(async () => {
    if (typeof window !== 'undefined' && window.__musicAudio) {
      audio = window.__musicAudio;
      if (audio.src) {
        isPlaying = !audio.paused;
        currentTime = audio.currentTime;
        duration = audio.duration || 0;
      }
    } else {
      audio = new Audio();
      audio.preload = 'metadata';
      if (typeof window !== 'undefined') {
        window.__musicAudio = audio;
      }
    }

    const savedVolume = localStorage.getItem('music-volume');
    if (savedVolume !== null) {
      volume = parseFloat(savedVolume);
      audio.volume = volume;
    }

    const savedMode = localStorage.getItem('music-play-mode');
    if (savedMode) playMode = savedMode;

    const onTimeUpdate = () => { if (!isDragging) currentTime = audio.currentTime; };
    const onLoadedMetadata = () => { duration = audio.duration; };
    const onDurationChange = () => { duration = audio.duration; };
    const onError = () => { audioError = '加载失败'; isPlaying = false; };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', onError);

    await fetchSongs();

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', onError);
    };
  });
</script>

{#if showPlayer && !isLoading}
<div class="music-fab">
  <button
    class="music-trigger"
    onclick={() => showPlaylist = !showPlaylist}
    title="音乐播放器"
  >
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" class="trigger-icon" class:playing={isPlaying}>
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
    </svg>
  </button>

  {#if showPlaylist}
    <div class="music-panel">
      <div class="panel-header">
        <div class="now-cover">
          {#if currentSong && getCoverUrl(currentSong)}
            <img src={getCoverUrl(currentSong)} alt="" class="cover-img" class:spinning={isPlaying} />
          {:else}
            <div class="cover-placeholder" style={currentSong ? 'background:' + getCoverColor(currentSong.title) : ''} class:spinning={isPlaying}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
          {/if}
        </div>
        <div class="now-info">
          <div class="now-title">{currentSong?.title || '未选择歌曲'}</div>
          <div class="now-artist">{currentSong?.artist || '未知艺术家'}</div>
        </div>
        <button class="panel-close" onclick={() => showPlaylist = false} title="关闭">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      <div class="panel-progress" bind:this={progressBarEl} onmousedown={handleProgressMouseDown}>
        <div class="progress-track">
          <div class="progress-filled" style="width: {progress}%"></div>
        </div>
        <div class="progress-time">
          <span>{formattedCurrentTime}</span>
          <span>{formattedDuration}</span>
        </div>
      </div>

      <div class="panel-controls">
        <button class="ctrl-btn mode-btn" onclick={cyclePlayMode} title={getPlayModeTitle()}>
          {#if playMode === 'single'}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              <text x="12" y="15" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor">1</text>
            </svg>
          {:else if playMode === 'shuffle'}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
            </svg>
          {/if}
        </button>
        <button class="ctrl-btn" onclick={prevSong} title="上一首" disabled={songs.length === 0}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
          </svg>
        </button>
        <button class="ctrl-btn play-btn" onclick={togglePlay} title={isPlaying ? '暂停' : '播放'} disabled={songs.length === 0}>
          {#if isPlaying}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M8 5v14l11-7z"/>
            </svg>
          {/if}
        </button>
        <button class="ctrl-btn" onclick={nextSong} title="下一首" disabled={songs.length === 0}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
          </svg>
        </button>
        <button class="ctrl-btn volume-toggle" onclick={toggleMute} title="音量">
          {#if getVolumeIcon() === 'mute'}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
          {:else if getVolumeIcon() === 'low'}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          {/if}
        </button>
      </div>

      <div class="panel-volume" bind:this={volumeBarEl} onmousedown={handleVolumeMouseDown}>
        <div class="volume-track">
          <div class="volume-filled" style="width: {volume * 100}%"></div>
        </div>
      </div>

      <div class="panel-list-header">
        <span class="list-title">播放列表</span>
        <span class="list-count">{songs.length} 首</span>
      </div>

      <div class="panel-list">
        {#each songs as song, i}
          <button class="list-item" class:active={i === currentIndex} onclick={() => playSong(i)}>
            <span class="item-index">
              {#if i === currentIndex && isPlaying}
                <span class="playing-indicator">
                  <span class="bar"></span><span class="bar"></span><span class="bar"></span>
                </span>
              {:else}
                {i + 1}
              {/if}
            </span>
            <span class="item-cover">
              {#if getCoverUrl(song)}
                <img src={getCoverUrl(song)} alt="" />
              {:else}
                <span class="mini-cover" style="background:{getCoverColor(song.title)}"></span>
              {/if}
            </span>
            <span class="item-info">
              <span class="item-title">{song.title}</span>
              <span class="item-artist">{song.artist || '未知艺术家'}</span>
            </span>
            <span class="item-duration">{song.duration ? formatTime(song.duration) : ''}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
{/if}

<style>
  .music-fab {
    position: fixed;
    bottom: calc(5vh - 4px);
    right: 7vw;
    z-index: 999;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  @media (min-width: 1024px) {
    .music-fab {
      bottom: calc(13.5vh - 4px);
    }
  }

  .music-trigger {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid var(--text-color, #374151);
    opacity: 0.2;
    border-color: var(--text-color, #374151);
    background: var(--bg-color, rgba(255,255,255,0.2));
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    padding: 0;
    color: var(--text-color, #374151);
  }

  .music-trigger:hover {
    background: var(--button-hover-color, rgba(0,0,0,0.06));
  }

  .music-trigger:active {
    transform: scale(0.9);
  }

  .trigger-icon {
    width: 18px;
    height: 18px;
  }

  .trigger-icon.playing {
    animation: pulse-icon 1.5s ease-in-out infinite;
  }

  @keyframes pulse-icon {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.12); }
  }

  .music-panel {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    width: 300px;
    max-height: 460px;
    background: var(--bg-color, rgba(255,255,255,0.95));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--text-color, #374151);
    border-opacity: 0.2;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: panel-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    color: var(--text-color, #374151);
  }

  @keyframes panel-in {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 12px 8px;
  }

  .now-cover {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .cover-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #6b7280;
    color: rgba(255, 255, 255, 0.9);
  }

  .spinning {
    animation: spin 8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .now-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .now-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color, #374151);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now-artist {
    font-size: 11px;
    color: var(--text-color, #374151);
    opacity: 0.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .panel-close {
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: var(--text-color, #374151);
    opacity: 0.4;
    cursor: pointer;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .panel-close:hover {
    opacity: 1;
    background: var(--button-hover-color, rgba(0,0,0,0.06));
  }

  .panel-progress {
    padding: 0 12px;
    cursor: pointer;
  }

  .progress-track {
    position: relative;
    width: 100%;
    height: 4px;
    background: var(--text-color, #374151);
    opacity: 0.1;
    border-radius: 2px;
  }

  .progress-filled {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--link-color, #2563eb);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .progress-time {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 10px;
    color: var(--text-color, #374151);
    opacity: 0.4;
    font-variant-numeric: tabular-nums;
  }

  .panel-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px 12px 2px;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-color, #374151);
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.15s ease;
    padding: 0;
    flex-shrink: 0;
  }

  .ctrl-btn:hover {
    background: var(--button-hover-color, rgba(0,0,0,0.06));
  }

  .ctrl-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .ctrl-btn:disabled:hover {
    background: transparent;
  }

  .play-btn {
    width: 38px;
    height: 38px;
    background: var(--link-color, #2563eb);
    color: white;
  }

  .play-btn:hover {
    opacity: 0.85;
    background: var(--link-color, #2563eb);
    color: white;
  }

  .mode-btn {
    opacity: 0.5;
  }

  .mode-btn:hover {
    opacity: 1;
  }

  .volume-toggle {
    opacity: 0.5;
  }

  .volume-toggle:hover {
    opacity: 1;
  }

  .panel-volume {
    padding: 2px 12px 6px;
    cursor: pointer;
  }

  .panel-volume .volume-track {
    position: relative;
    width: 100%;
    height: 3px;
    background: var(--text-color, #374151);
    opacity: 0.1;
    border-radius: 1.5px;
  }

  .volume-filled {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--link-color, #2563eb);
    border-radius: 1.5px;
    transition: width 0.05s linear;
  }

  .panel-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-top: 1px solid var(--text-color, #374151);
    border-opacity: 0.08;
  }

  .list-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color, #374151);
  }

  .list-count {
    font-size: 10px;
    color: var(--text-color, #374151);
    opacity: 0.4;
  }

  .panel-list {
    overflow-y: auto;
    overscroll-behavior: contain;
    max-height: 200px;
    padding: 2px 0 6px;
  }

  .panel-list::-webkit-scrollbar {
    width: 4px;
  }

  .panel-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .panel-list::-webkit-scrollbar-thumb {
    background: var(--text-color, #374151);
    opacity: 0.15;
    border-radius: 2px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
    color: var(--text-color, #374151);
  }

  .list-item:hover {
    background: var(--button-hover-color, rgba(0,0,0,0.06));
  }

  .list-item.active {
    background: var(--button-hover-color, rgba(0,0,0,0.06));
  }

  .item-index {
    width: 18px;
    font-size: 11px;
    color: var(--text-color, #374151);
    opacity: 0.4;
    text-align: center;
    flex-shrink: 0;
  }

  .list-item.active .item-index {
    opacity: 1;
    color: var(--link-color, #2563eb);
  }

  .playing-indicator {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
  }

  .playing-indicator .bar {
    width: 2.5px;
    background: var(--link-color, #2563eb);
    border-radius: 1px;
    animation: barBounce 0.8s ease-in-out infinite;
  }

  .playing-indicator .bar:nth-child(1) { height: 5px; animation-delay: 0s; }
  .playing-indicator .bar:nth-child(2) { height: 9px; animation-delay: 0.2s; }
  .playing-indicator .bar:nth-child(3) { height: 4px; animation-delay: 0.4s; }

  @keyframes barBounce {
    0%, 100% { height: 4px; }
    50% { height: 12px; }
  }

  .item-cover {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .item-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mini-cover {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 6px;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .item-title {
    font-size: 12px;
    color: var(--text-color, #374151);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  .list-item.active .item-title {
    color: var(--link-color, #2563eb);
    font-weight: 500;
  }

  .item-artist {
    font-size: 10px;
    color: var(--text-color, #374151);
    opacity: 0.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .item-duration {
    font-size: 10px;
    color: var(--text-color, #374151);
    opacity: 0.4;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
