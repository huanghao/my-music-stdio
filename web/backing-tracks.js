let btTracks = [];
let btLoaded = false;

async function btInitPage() {
  if (!btLoaded) {
    const data = await api('/api/backing-tracks');
    btTracks = data.tracks || [];
    btBuildFilters();
    ['bt-key', 'bt-style', 'bt-bpm-min', 'bt-bpm-max', 'bt-search'].forEach(id => {
      document.getElementById(id).addEventListener('input', btRender);
      document.getElementById(id).addEventListener('change', btRender);
    });
    btLoaded = true;
  }
  btRender();
}

function btBuildFilters() {
  const keys = [...new Set(btTracks.map(t => t.key).filter(Boolean))].sort();
  const styles = [...new Set(btTracks.flatMap(t => t.style || []))].sort();
  document.getElementById('bt-key').innerHTML += keys.map(v => `<option>${htmlEsc(v)}</option>`).join('');
  document.getElementById('bt-style').innerHTML += styles.map(v => `<option>${htmlEsc(v)}</option>`).join('');
}

function btRender() {
  const key = document.getElementById('bt-key').value;
  const style = document.getElementById('bt-style').value;
  const min = Number(document.getElementById('bt-bpm-min').value) || null;
  const max = Number(document.getElementById('bt-bpm-max').value) || null;
  const q = document.getElementById('bt-search').value.trim().toLowerCase();
  const list = btTracks.filter(t => (!key || t.key === key)
    && (!style || (t.style || []).includes(style))
    && (!min || (t.bpm && t.bpm >= min))
    && (!max || (t.bpm && t.bpm <= max))
    && (!q || `${t.title} ${t.progression || ''} ${(t.style || []).join(' ')}`.toLowerCase().includes(q)));
  document.getElementById('bt-results').innerHTML = list.length ? list.map((t, i) => `
    <article class="bt-card">
      <div class="bt-card-head"><h3>${htmlEsc(t.title)}</h3><button class="btn btn-primary btn-sm" onclick="btPlay(${btTracks.indexOf(t)})">▶ 试听</button></div>
      <div class="bt-tags"><span>${htmlEsc(t.key || '调未知')}</span><span>${t.bpm ? `${t.bpm} BPM` : '速度未知'}</span>${(t.style || []).map(s => `<span>${htmlEsc(s)}</span>`).join('')}</div>
      <p><b>和弦：</b>${htmlEsc(t.progression || '暂未记录')}</p>
      <p><b>来源：</b><a href="${htmlEsc(t.source_url)}" target="_blank" rel="noopener">打开来源 ↗</a></p>
      <p class="bt-license">${htmlEsc(t.availability || '')} · ${htmlEsc(t.license || '')}</p>
      ${t.notes ? `<p class="bt-note">${htmlEsc(t.notes)}</p>` : ''}
    </article>`).join('') : '<p class="bt-empty">没有符合条件的伴奏，试试清空部分筛选条件。</p>';
}

function btPlay(index) {
  const t = btTracks[index];
  const player = document.getElementById('bt-player');
  const id = t.source_url?.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/))([\w-]{11})/)?.[1];
  if (t.local_url) {
    player.innerHTML = `<audio controls autoplay src="${htmlEsc(t.local_url)}"></audio>`;
  } else if (id) {
    player.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="${htmlEsc(t.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  } else {
    window.open(t.source_url, '_blank', 'noopener');
    return;
  }
  player.classList.remove('hidden');
  player.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
