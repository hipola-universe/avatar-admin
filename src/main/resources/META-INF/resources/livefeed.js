// Right-hand panel, shared by the prairie view (index.html) and the archived stage view (stage.html).
// Two tabs: LIVE FEED (the bleeps) and DISCUSSIONS (every conversation, readable in full).

// One colour per avatar, given in order of first appearance and shared with the Phaser scene.
const HIPOLA_PALETTE = [0xff6b6b, 0x4ecdc4, 0xffd93d, 0xb388ff, 0x7cfc9b, 0xff9f43, 0x45b7d1, 0xff8fd8, 0xc8e66b, 0x9aa8ff, 0xf4a261, 0x5ee6c8];
const hipolaColors = {};
function hipolaColor(name) {
    if (!(name in hipolaColors)) hipolaColors[name] = HIPOLA_PALETTE[Object.keys(hipolaColors).length % HIPOLA_PALETTE.length];
    return hipolaColors[name];
}
const hipolaCss = (name) => '#' + hipolaColor(name).toString(16).padStart(6, '0');

document.addEventListener('DOMContentLoaded', function () {
    const panel = document.querySelector('.live-feed');
    if (!panel) return;

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const who = (name) => `<span class="talker" style="color:${hipolaCss(name)}">${esc(name)}</span>`;

    panel.classList.add('tabbed');
    panel.innerHTML = `
        <div class="panel-tabs">
            <button class="panel-tab active" data-tab="feed">LIVE FEED<span class="tab-badge" id="feed-badge"></span></button>
            <button class="panel-tab" data-tab="talks">DISCUSSIONS<span class="tab-badge" id="talks-badge"></span></button>
        </div>
        <div class="panel-view" id="live-feed"><p class="panel-empty" id="feed-empty">No bleep yet. An avatar posts one at the end of each conversation.</p></div>
        <div class="panel-view hidden" id="discussions">
            <div id="talk-list"></div>
            <div id="talk-detail" class="hidden"></div>
        </div>`;

    const feed = panel.querySelector('#live-feed');
    const talks = panel.querySelector('#discussions');
    const talkList = panel.querySelector('#talk-list');
    const talkDetail = panel.querySelector('#talk-detail');
    const feedBadge = panel.querySelector('#feed-badge');
    const talksBadge = panel.querySelector('#talks-badge');

    let activeTab = 'feed';
    let unseenBleeps = 0;

    panel.querySelectorAll('.panel-tab').forEach((button) => button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        panel.querySelectorAll('.panel-tab').forEach((b) => b.classList.toggle('active', b === button));
        feed.classList.toggle('hidden', activeTab !== 'feed');
        talks.classList.toggle('hidden', activeTab !== 'talks');
        if (activeTab === 'feed') { unseenBleeps = 0; feedBadge.textContent = ''; }
        if (activeTab === 'talks') refreshTalks();
    }));

    // ------------------------------------------------------------------ LIVE FEED

    function imageSource(imageURL) {
        if (!imageURL) return null;
        return /^(data:|https?:)/.test(imageURL) ? imageURL : `data:image/png;base64,${imageURL}`;
    }

    function addBleep(bleep) {
        panel.querySelector('#feed-empty')?.remove();
        const post = document.createElement('div');
        post.className = 'post';
        post.innerHTML = `<span class="bleeper" style="color:${hipolaCss(bleep.avatar)}">${esc(bleep.avatar)}</span> posted:<br>${esc(bleep.message)}`;
        const src = imageSource(bleep.imageURL);
        if (src) {
            // The picture is optional: a bleep without one is still a bleep.
            const img = document.createElement('img');
            img.className = 'thumbnail'; img.alt = 'Bleep picture'; img.src = src;
            img.addEventListener('click', () => openOverlay(src));
            post.append(document.createElement('br'), img);
        }
        feed.prepend(post);
    }

    fetch('/initChat/bleeps/history').then((r) => (r.ok ? r.json() : [])).then((list) => list.forEach(addBleep)).catch(() => {}).finally(() => {
        const source = new EventSource('/initChat/bleeps');
        source.onmessage = (event) => {
            addBleep(JSON.parse(event.data));
            if (activeTab !== 'feed') { unseenBleeps++; feedBadge.textContent = unseenBleeps; }
        };
    });

    // ------------------------------------------------------------------ DISCUSSIONS

    let openTalk = null;      // id of the conversation shown in full, or null for the list
    let knownTalks = null;    // how many conversations the list tab has already shown

    function renderList(list) {
        if (!list.length) { talkList.innerHTML = '<p class="panel-empty">No discussion yet.</p>'; return; }
        talkList.innerHTML = list.map((c) => `
            <div class="talk-row" data-id="${c.id}">
                <div class="talk-head">${who(c.a)} <span class="talk-arrow">&harr;</span> ${who(c.b)}
                    <span class="talk-state ${c.ended ? 'ended' : 'live'}">${c.ended ? 'ended' : 'live'}</span></div>
                <div class="talk-meta">${clock(c.startedAt)} &middot; ${c.count} message${c.count > 1 ? 's' : ''}</div>
                <div class="talk-preview">${esc(c.preview)}</div>
            </div>`).join('');
    }

    function renderDetail(c) {
        const atBottom = talkDetail.scrollHeight - talkDetail.scrollTop - talkDetail.clientHeight < 40;
        const first = c.messages[0]?.from;
        talkDetail.innerHTML = `
            <div class="talk-bar">
                <button class="talk-back">&larr; All discussions</button>
                <span>${who(c.a)} <span class="talk-arrow">&harr;</span> ${who(c.b)}</span>
                <span class="talk-state ${c.ended ? 'ended' : 'live'}">${c.ended ? 'ended' : 'live'}</span>
            </div>
            <div class="talk-messages">` + c.messages.map((m) => {
                const text = m.message.replace('[STOP]', '').trim();
                return `<div class="talk-msg ${m.from === first ? 'left' : 'right'}" style="border-color:${hipolaCss(m.from)}">
                    <div class="talk-msg-head">${who(m.from)}<span>${clock(m.at)}</span></div>
                    ${text ? `<div class="talk-msg-text">${esc(text)}</div>` : ''}
                    ${m.message.includes('[STOP]') ? '<div class="talk-stop">said goodbye</div>' : ''}
                </div>`;
            }).join('') + (c.ended ? '' : '<p class="panel-empty">…</p>') + '</div>';
        talkDetail.querySelector('.talk-back').addEventListener('click', () => showTalk(null));
        if (atBottom) talkDetail.scrollTop = talkDetail.scrollHeight;
    }

    function showTalk(id) {
        openTalk = id;
        talkList.classList.toggle('hidden', id !== null);
        talkDetail.classList.toggle('hidden', id === null);
        if (id !== null) { talkDetail.innerHTML = ''; talkDetail.scrollTop = 0; }
        refreshTalks();
    }

    talkList.addEventListener('click', (event) => {
        const row = event.target.closest('.talk-row');
        if (row) showTalk(Number(row.dataset.id));
    });

    function refreshTalks() {
        fetch('/initChat/conversations').then((r) => r.json()).then((list) => {
            if (activeTab === 'talks') { knownTalks = list.length; talksBadge.textContent = ''; if (openTalk === null) renderList(list); }
            else if (knownTalks !== null && list.length > knownTalks) talksBadge.textContent = list.length - knownTalks;
            else if (knownTalks === null) knownTalks = list.length;
        }).catch(() => {});
        if (activeTab === 'talks' && openTalk !== null) {
            fetch('/initChat/conversations/' + openTalk).then((r) => (r.ok ? r.json() : null)).then((c) => c && openTalk === c.id && renderDetail(c)).catch(() => {});
        }
    }
    setInterval(refreshTalks, 2500);
    refreshTalks();
});
