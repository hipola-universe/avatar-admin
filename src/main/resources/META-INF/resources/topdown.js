// Topdown view of Hipola: a prairie you can scroll, where every avatar that joins the planet gets a body.
// Two avatars that come close start talking; you can also grab one and drop it next to another.
//
//   mouse   drag an avatar: move it     drag the ground: scroll     wheel: zoom
//   keys    arrows / WASD: scroll   G: grab or drop the avatar nearest to the pointer
//           F: follow or release the nearest avatar   H: back to the village square

const WORLD = { cols: 64, rows: 48, tile: 32 };           // 2048 × 1536 px
WORLD.width = WORLD.cols * WORLD.tile;
WORLD.height = WORLD.rows * WORLD.tile;
WORLD.cx = WORLD.width / 2;
WORLD.cy = WORLD.height / 2;

const TALK_DISTANCE = 90;        // two avatars closer than this start a conversation…
const PAIR_COOLDOWN = 120000;    // …but the same two wait before starting another one
const BUSY_AFTER_LINE = 25000;   // an avatar that just spoke or was spoken to is considered busy
const WALK_SPEED = 62;

// Tiles of prairie_tileset.png (ids as in the original Tiled map)
const GRASS = [57, 57, 57, 58, 58, 112, 112, 113];
const DIRT = 225;
const TREE = [[555, 556], [610, 611]];

const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'phaser-container',
    backgroundColor: '#0b1a12',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: { preload, create, update },
});

const avatars = new Map();       // id -> avatar
const pairCooldown = new Map();  // "a|b" -> time when these two may chat again
const talking = new Map();       // "a|b" -> time until which the line between them is drawn
let scene, links, keys, held = null, followed = null, panning = false, lastProximityCheck = 0;

const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const hud = (text) => { const el = document.getElementById('hud-status'); if (el) el.textContent = text; };
const updateCount = () => { const el = document.getElementById('avatar-count'); if (el) el.textContent = avatars.size + (avatars.size > 1 ? ' avatars' : ' avatar'); };

function preload() {
    this.load.image('prairie-tiles', 'prairie_tileset.png');
    this.load.spritesheet('dude', 'dude.png', { frameWidth: 32, frameHeight: 48 });
}

// ------------------------------------------------------------------ the world

function buildWorld() {
    // Same seed every time: the prairie looks the same after a reload.
    let seed = 20231107;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

    const map = scene.make.tilemap({ tileWidth: WORLD.tile, tileHeight: WORLD.tile, width: WORLD.cols, height: WORLD.rows });
    const tiles = map.addTilesetImage('prairie', 'prairie-tiles', WORLD.tile, WORLD.tile, 0, 0, 1);
    const layer = map.createBlankLayer('Grass', tiles);

    for (let y = 0; y < WORLD.rows; y++) for (let x = 0; x < WORLD.cols; x++) {
        const edge = x === 0 || y === 0 || x === WORLD.cols - 1 || y === WORLD.rows - 1;
        layer.putTileAt(edge ? DIRT : GRASS[Math.floor(rnd() * GRASS.length)], x, y);
    }
    // The village square, and two paths that cross it.
    const mx = WORLD.cols / 2, my = WORLD.rows / 2;
    for (let x = 1; x < WORLD.cols - 1; x++) { layer.putTileAt(DIRT, x, my - 1); layer.putTileAt(DIRT, x, my); }
    for (let y = 1; y < WORLD.rows - 1; y++) { layer.putTileAt(DIRT, mx - 1, y); layer.putTileAt(DIRT, mx, y); }
    for (let y = my - 4; y < my + 4; y++) for (let x = mx - 5; x < mx + 5; x++) layer.putTileAt(DIRT, x, y);
    // Small woods, away from the paths.
    for (let i = 0; i < 90; i++) {
        const x = 2 + Math.floor(rnd() * (WORLD.cols - 5)), y = 2 + Math.floor(rnd() * (WORLD.rows - 5));
        if (Math.abs(x - mx) < 8 && Math.abs(y - my) < 7) continue;
        if (Math.abs(x - mx) < 3 || Math.abs(y - my) < 3) continue;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) layer.putTileAt(TREE[dy][dx], x + dx, y + dy);
    }
    return layer;
}

function create() {
    scene = this;
    const layer = buildWorld();

    this.physics.world.setBounds(WORLD.tile, WORLD.tile, WORLD.width - 2 * WORLD.tile, WORLD.height - 2 * WORLD.tile);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.centerOn(WORLD.cx, WORLD.cy);

    this.anims.create({ key: 'walk-left', frames: this.anims.generateFrameNumbers('dude', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk-right', frames: this.anims.generateFrameNumbers('dude', { start: 5, end: 8 }), frameRate: 8, repeat: -1 });

    if (this.renderer.type === Phaser.WEBGL) {
        this.lights.enable();
        this.lights.setAmbientColor(0x8a8a8a);
        layer.setPipeline('Light2D');
    }
    links = this.add.graphics().setDepth(5);

    setupControls();

    // Who is already here, then who arrives and leaves.
    const loadAvatars = () => fetch('/initChat/avatars').then((r) => r.json()).then((names) => names.forEach((n) => addAvatar(n, false))).catch(() => {});
    loadAvatars();
    const joiners = new EventSource('/initChat/joiners');
    joiners.onopen = loadAvatars; // also after a reconnection
    joiners.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (String(data.chat).startsWith('Leaving')) removeAvatar(data.sender); else addAvatar(data.sender, true);
    };
    // What they say, as soon as they say it.
    new EventSource('/initChat/live').onmessage = (event) => onLine(JSON.parse(event.data));
}

// ------------------------------------------------------------------ avatars

function addAvatar(id, announce) {
    if (avatars.has(id)) return avatars.get(id);
    const color = hipolaColor(id);
    const angle = Math.random() * Math.PI * 2, radius = 60 + Math.random() * 230;
    const x = WORLD.cx + Math.cos(angle) * radius, y = WORLD.cy + Math.sin(angle) * radius * 0.8;

    const sprite = scene.physics.add.sprite(x, y, 'dude', 4).setTint(color).setScale(1.2).setDepth(10).setCollideWorldBounds(true);
    sprite.body.setSize(20, 32);
    // A generous hit area: small sprites are hard to catch.
    sprite.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-10, -8, 52, 64), hitAreaCallback: Phaser.Geom.Rectangle.Contains, draggable: true, useHandCursor: true });
    const label = scene.add.text(x, y, id, { fontFamily: 'Courier New, monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#06140c', strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(11);

    const avatar = { id, color, sprite, label, light: null, bubble: null, busyUntil: 0, moveUntil: 0, nextMoveAt: scene.time.now + 800 + Math.random() * 1500 };
    if (scene.renderer.type === Phaser.WEBGL) {
        sprite.setPipeline('Light2D');
        avatar.light = scene.lights.addLight(x, y, 130, color, 0.9);
    }
    sprite.avatar = avatar;
    avatars.set(id, avatar);
    updateCount();

    if (announce) {
        // Landing: the avatar drops in with a flash.
        sprite.setScale(0.1).setAlpha(0);
        scene.tweens.add({ targets: sprite, scale: 1.2, alpha: 1, duration: 500, ease: 'Back.easeOut' });
        burst(x, y, color);
    }
    return avatar;
}

function removeAvatar(id) {
    const avatar = avatars.get(id);
    if (!avatar) return;
    if (held === avatar) held = null;
    if (followed === avatar) { followed = null; scene.cameras.main.stopFollow(); }
    burst(avatar.sprite.x, avatar.sprite.y, avatar.color);
    avatar.bubble?.destroy(); avatar.label.destroy(); avatar.sprite.destroy();
    if (avatar.light) scene.lights.removeLight(avatar.light);
    avatars.delete(id);
    updateCount();
}

function burst(x, y, color) {
    const ring = scene.add.circle(x, y, 12, color, 0.7).setDepth(9).setBlendMode('ADD');
    scene.tweens.add({ targets: ring, scale: 6, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
}

function wander(avatar, now) {
    if (avatar === held || now < avatar.nextMoveAt) return;
    if (now < avatar.busyUntil) { avatar.nextMoveAt = now + 1000; return; } // stands still while talking

    let dx, dy;
    const others = [...avatars.values()].filter((o) => o !== avatar && now >= o.busyUntil && now >= (pairCooldown.get(pairKey(avatar.id, o.id)) || 0));
    const fromSquare = Phaser.Math.Distance.Between(avatar.sprite.x, avatar.sprite.y, WORLD.cx, WORLD.cy);
    if (others.length && Math.random() < 0.55) {
        // Sociable: walk towards someone they could talk to.
        const target = Phaser.Utils.Array.GetRandom(others);
        dx = target.sprite.x - avatar.sprite.x; dy = target.sprite.y - avatar.sprite.y;
    } else if (fromSquare > 520 && Math.random() < 0.6) {
        dx = WORLD.cx - avatar.sprite.x; dy = WORLD.cy - avatar.sprite.y; // drift back to the village
    } else {
        const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a);
    }
    const length = Math.hypot(dx, dy) || 1;
    avatar.sprite.body.setVelocity((dx / length) * WALK_SPEED, (dy / length) * WALK_SPEED);
    avatar.sprite.anims.play(dx < 0 ? 'walk-left' : 'walk-right', true);
    avatar.moveUntil = now + 1100 + Math.random() * 1400;
    avatar.nextMoveAt = avatar.moveUntil + 500 + Math.random() * 1800;
}

function stand(avatar) {
    avatar.sprite.body.setVelocity(0);
    avatar.sprite.anims.stop();
    avatar.sprite.setFrame(4);
    avatar.moveUntil = 0;
}

// ------------------------------------------------------------------ conversations

function checkProximity(now) {
    const list = [...avatars.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a === held || b === held || now < a.busyUntil || now < b.busyUntil) continue;
        const key = pairKey(a.id, b.id);
        if (now < (pairCooldown.get(key) || 0)) continue;
        if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, b.sprite.x, b.sprite.y) > TALK_DISTANCE) continue;

        pairCooldown.set(key, now + PAIR_COOLDOWN);
        a.busyUntil = b.busyUntil = now + BUSY_AFTER_LINE;   // waiting for the first reply
        talking.set(key, now + BUSY_AFTER_LINE);
        stand(a); stand(b);
        burst((a.sprite.x + b.sprite.x) / 2, (a.sprite.y + b.sprite.y) / 2, 0xffffff);
        fetch('/initChat/' + encodeURIComponent(a.id) + '/' + encodeURIComponent(b.id)).catch((error) => console.error('Could not start the chat', error));
        return; // one new conversation at a time
    }
}

function onLine(line) {
    const now = scene.time.now;
    const speaker = addAvatar(line.from, false);   // also covers an avatar this page has not seen join
    const listener = avatars.get(line.to);
    const key = pairKey(line.from, line.to);
    const goodbye = line.message.includes('[STOP]');

    const until = now + (goodbye ? 3000 : BUSY_AFTER_LINE);
    speaker.busyUntil = until;
    if (listener) listener.busyUntil = until;
    if (goodbye) { talking.delete(key); pairCooldown.set(key, now + PAIR_COOLDOWN); } else talking.set(key, until);

    stand(speaker);
    if (listener) speaker.sprite.setFrame(listener.sprite.x < speaker.sprite.x ? 0 : 5); // look at each other
    const text = line.message.replace('[STOP]', '').trim();
    say(speaker, text || '👋');
}

function say(avatar, text) {
    avatar.bubble?.destroy();
    const shown = text.length > 300 ? text.slice(0, 297) + '…' : text;   // the full text is in the DISCUSSIONS tab
    const label = scene.add.text(12, 10, shown, { fontFamily: 'Courier New, monospace', fontSize: '13px', color: '#101418', wordWrap: { width: 250 } });
    const w = label.width + 24, h = label.height + 20;
    const box = scene.add.graphics();
    box.fillStyle(0xffffff, 0.95).fillRoundedRect(0, 0, w, h, 12);
    box.lineStyle(3, avatar.color, 1).strokeRoundedRect(0, 0, w, h, 12);
    box.fillStyle(0xffffff, 0.95).fillTriangle(w / 2 - 8, h - 1, w / 2 + 8, h - 1, w / 2, h + 10);
    const bubble = scene.add.container(0, 0, [box, label]).setDepth(1000).setSize(w, h);
    bubble.setScale(0.6).setAlpha(0);
    scene.tweens.add({ targets: bubble, scale: 1, alpha: 1, duration: 180 });
    avatar.bubble = bubble;
    const life = Phaser.Math.Clamp(3500 + shown.length * 28, 4500, 11000);
    scene.time.delayedCall(life, () => { if (avatar.bubble === bubble) avatar.bubble = null; bubble.destroy(); });
}

// ------------------------------------------------------------------ controls

function nearestToPointer(maxDistance) {
    const p = scene.input.activePointer; p.updateWorldPoint(scene.cameras.main);
    let best = null, bestD = maxDistance;
    for (const a of avatars.values()) {
        const d = Phaser.Math.Distance.Between(p.worldX, p.worldY, a.sprite.x, a.sprite.y);
        if (d < bestD) { best = a; bestD = d; }
    }
    return best;
}

function grab(avatar) {
    held = avatar; stand(avatar);
    avatar.sprite.setDepth(900);
    scene.tweens.add({ targets: avatar.sprite, scale: 1.6, duration: 120 });
    hud('holding ' + avatar.id + ' — drop it next to someone');
}

function drop() {
    if (!held) return;
    const avatar = held; held = null;
    avatar.sprite.setDepth(10);
    scene.tweens.add({ targets: avatar.sprite, scale: 1.2, duration: 120 });
    avatar.nextMoveAt = scene.time.now + 5000;   // stays where you put it for a moment
    hud('');
}

function setupControls() {
    const cam = scene.cameras.main;
    keys = scene.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D');

    // Mouse: drag an avatar…
    scene.input.on('dragstart', (pointer, object) => { if (object.avatar) grab(object.avatar); });
    scene.input.on('drag', (pointer, object, x, y) => { if (object.avatar) object.setPosition(x, y); });
    scene.input.on('dragend', () => drop());
    // …or drag the ground to scroll.
    scene.input.on('pointerdown', (pointer, over) => {
        if (held && !over.length) { drop(); return; }   // click to drop after a keyboard grab
        if (!over.length) { panning = true; unfollow(); }
    });
    scene.input.on('pointermove', (pointer) => {
        if (!panning || !pointer.isDown) return;
        cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
        cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
    });
    scene.input.on('pointerup', () => { panning = false; });
    scene.input.on('wheel', (pointer, over, dx, dy) => { cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.45, 2)); });

    // Keyboard.
    scene.input.keyboard.on('keydown-G', () => {
        if (held) { drop(); return; }
        const avatar = nearestToPointer(260);
        if (avatar) grab(avatar); else hud('no avatar near the pointer');
    });
    scene.input.keyboard.on('keydown-F', () => {
        if (followed) { unfollow(); return; }
        const avatar = nearestToPointer(400);
        if (avatar) { followed = avatar; cam.startFollow(avatar.sprite, true, 0.08, 0.08); hud('following ' + avatar.id + ' — F to release'); }
    });
    scene.input.keyboard.on('keydown-H', () => { unfollow(); cam.setZoom(1); cam.pan(WORLD.cx, WORLD.cy, 400, 'Sine.easeInOut'); });
    scene.input.keyboard.on('keydown-ESC', () => { drop(); unfollow(); });
}

function unfollow() {
    if (!followed) return;
    followed = null; scene.cameras.main.stopFollow(); hud('');
}

// ------------------------------------------------------------------ every frame

function update(time, delta) {
    const cam = this.cameras.main;

    // Scroll with the keyboard.
    const step = (520 * delta) / 1000 / cam.zoom;
    const kx = (keys.RIGHT.isDown || keys.D.isDown ? 1 : 0) - (keys.LEFT.isDown || keys.A.isDown ? 1 : 0);
    const ky = (keys.DOWN.isDown || keys.S.isDown ? 1 : 0) - (keys.UP.isDown || keys.W.isDown ? 1 : 0);
    if (kx || ky) { unfollow(); cam.scrollX += kx * step; cam.scrollY += ky * step; }

    // An avatar held with G follows the pointer; near an edge of the screen, the world scrolls.
    if (held) {
        const p = this.input.activePointer;
        const margin = 50, edge = (420 * delta) / 1000 / cam.zoom;
        if (p.x < margin) cam.scrollX -= edge; else if (p.x > this.scale.width - margin) cam.scrollX += edge;
        if (p.y < margin) cam.scrollY -= edge; else if (p.y > this.scale.height - margin) cam.scrollY += edge;
        p.updateWorldPoint(cam);
        if (!p.isDown) held.sprite.setPosition(Phaser.Math.Clamp(p.worldX, 40, WORLD.width - 40), Phaser.Math.Clamp(p.worldY, 40, WORLD.height - 40));
    }

    for (const avatar of avatars.values()) {
        if (avatar.moveUntil && time > avatar.moveUntil) stand(avatar);
        wander(avatar, time);
        const { x, y } = avatar.sprite;
        avatar.label.setPosition(x, y + 30);
        if (avatar.light) avatar.light.setPosition(x, y);
        if (avatar.bubble) {
            // Above the head, but never outside the world.
            const bx = Phaser.Math.Clamp(x - avatar.bubble.width / 2, 8, WORLD.width - avatar.bubble.width - 8);
            const by = Math.max(8, y - 44 - avatar.bubble.height);
            avatar.bubble.setPosition(bx, by);
        }
    }

    if (time - lastProximityCheck > 400) { lastProximityCheck = time; checkProximity(time); }

    // A line between two avatars who are talking to each other.
    links.clear();
    for (const [key, until] of talking) {
        if (time > until) { talking.delete(key); continue; }
        const [a, b] = key.split('|').map((id) => avatars.get(id));
        if (!a || !b) continue;
        links.lineStyle(3, 0xffffff, 0.35 + 0.25 * Math.sin(time / 200));
        links.lineBetween(a.sprite.x, a.sprite.y, b.sprite.x, b.sprite.y);
    }
}
