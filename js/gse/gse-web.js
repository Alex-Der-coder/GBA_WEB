/*!
 * GSE Web — éditeur "live" Golden Sun pour gbajs / gbajs2
 * Portage navigateur de Golden Sun Editor v1.22 (udanworld.free.fr/GSE) :
 * au lieu de lire la RAM de VisualBoyAdvance.exe, on lit/écrit directement
 * la mémoire de l'émulateur JS via gba.mmu.
 *
 * Installation : charger gse-data.js puis gse-web.js APRÈS la création de `gba`.
 *   <script src="js/gse/gse-data.js"></script>
 *   <script src="js/gse/gse-web.js"></script>
 * Ouverture : bouton "GSE" en bas à droite, ou touche F2.
 */
(function () {
	'use strict';

	const D = window.GSE_DATA;
	if (!D) {
		console.error('[GSE] gse-data.js doit être chargé avant gse-web.js');
		return;
	}

	/* ------------------------------------------------------------------ *
	 *  Carte mémoire (offsets relevés dans le désassemblage de GSE v1.22) *
	 * ------------------------------------------------------------------ */
	const EW = 0x02000000; // EWRAM
	const IW = 0x03000000; // IWRAM
	const CHAR_SIZE = 0x14c;
	const NB_CHARS = 8;
	const DEFAULT_NAMES = ['Vlad', 'Garet', 'Ivan', 'Sofia', 'Pavel', 'Lina', 'Cylia', 'Piers'];
	const ELEMENTS = ['Vénus', 'Mercure', 'Mars', 'Jupiter'];
	const ELEM_KEYS = ['venus', 'mercury', 'mars', 'jupiter'];

	const GAMES = {
		1: { label: 'Golden Sun', cb: 0x500, playtime: IW + 0x1c9c, summons: false },
		2: { label: "Golden Sun : L'Âge Perdu", cb: 0x520, playtime: IW + 0x117c, summons: true }
	};

	const C = {
		// globaux
		partyFlags: 0x40, // u8, bit i = perso i dans l'équipe
		djinnFlags: 0x46, // 10 octets, 20 bits par élément
		summons: 0x24e, // u16 (GS2)
		gold: 0x250, // u32
		djinnQueue: 0x254, // [élément, n°, perso, tours|0xFF] * n
		// relatifs à la base perso (cb)
		order: -0xc8, // 8 octets
		map: -0x100, // u16
		door: -0xfe, // u16
		queueCount: -0x1ac, // u8
		// dans un perso
		name: 0x00,
		level: 0x0f,
		base: { hp: 0x10, pp: 0x12, atk: 0x18, def: 0x1a, agi: 0x1c, luck: 0x1e },
		cur: { maxhp: 0x34, maxpp: 0x36, hp: 0x38, pp: 0x3a, atk: 0x3c, def: 0x3e, agi: 0x40, luck: 0x42 },
		psy: 0x58, // 32 * u32
		items: 0xd8, // 15 * u16
		djOwned: 0xf8, // 4 * u32
		djSet: 0x108, // 4 * u32
		djOwnedCount: 0x118, // 4 * u8
		djSetCount: 0x11c, // 4 * u8
		exp: 0x124, // u32
		cls: 0x129, // u8
		cursed: 0x130, // u8
		poison: 0x131 // u8 : 1 poison, 2 venin
	};

	/* ------------------------------ Accès RAM ------------------------------ */
	function getGBA() {
		try {
			// `let gba` au niveau global d'un <script> classique n'est pas sur window
			// eslint-disable-next-line no-undef
			if (typeof gba !== 'undefined' && gba) return gba;
		} catch (e) {}
		return window.gba || null;
	}
	const M = {
		get mmu() {
			const g = getGBA();
			return g && g.mmu;
		},
		u8: (a) => M.mmu.loadU8(a),
		u16: (a) => M.mmu.loadU16(a),
		u32: (a) => M.mmu.load32(a) >>> 0,
		s32: (a) => M.mmu.load32(a) | 0,
		w8: (a, v) => M.mmu.store8(a, v & 0xff),
		w16: (a, v) => M.mmu.store16(a, v & 0xffff),
		w32: (a, v) => M.mmu.store32(a, v | 0),
		bytes(a, n) {
			const out = new Uint8Array(n);
			for (let i = 0; i < n; i++) out[i] = M.u8(a + i);
			return out;
		},
		wbytes(a, arr) {
			for (let i = 0; i < arr.length; i++) M.w8(a + i, arr[i]);
		}
	};

	/* ------------------------------ Détection ------------------------------ */
	function detect() {
		const g = getGBA();
		if (!g) return { ok: false, err: 'Émulateur introuvable (variable gba).' };
		const cart = g.mmu && g.mmu.cart;
		if (!cart || !cart.title) return { ok: false, err: 'Aucune ROM chargée.' };
		const title = String(cart.title).trim();
		let game = 0;
		if (title.startsWith('GOLDEN_SUN_A')) game = 1;
		else if (title.startsWith('GOLDEN_SUN_B')) game = 2;
		if (!game) return { ok: false, err: `ROM « ${title} » : ce n'est pas un Golden Sun.` };
		const code = cart.code || '';
		const info = { ok: true, game, code, title, G: GAMES[game], cb: EW + GAMES[game].cb };
		// GSE "LOC" : une partie doit être chargée (perso 1 avec un niveau)
		const lvl = M.u8(info.cb + C.level);
		info.loaded = lvl > 0 && lvl <= 99;
		info.frVersion = code === 'AGSF' || code === 'AGFF';
		return info;
	}

	/* ------------------------------ Encodage texte ------------------------------ */
	function readName(addr) {
		let s = '';
		for (let i = 0; i < 15; i++) {
			const c = M.u8(addr + i);
			if (!c) break;
			s += String.fromCharCode(c);
		}
		return s;
	}
	function writeName(addr, s) {
		const bytes = new Uint8Array(15);
		for (let i = 0; i < Math.min(14, s.length); i++) {
			const c = s.charCodeAt(i);
			bytes[i] = c > 0xff ? 0x3f : c;
		}
		M.wbytes(addr, bytes);
	}

	/* ------------------------------ Modèle ------------------------------ */
	const charAddr = (ctx, i) => ctx.cb + i * CHAR_SIZE;
	const popcount = (v) => {
		let n = 0;
		while (v) {
			n += v & 1;
			v >>>= 1;
		}
		return n;
	};

	function readChar(ctx, i) {
		const a = charAddr(ctx, i);
		const ch = {
			i,
			name: readName(a + C.name),
			level: M.u8(a + C.level),
			exp: M.u32(a + C.exp),
			cls: M.u8(a + C.cls),
			cursed: M.u8(a + C.cursed),
			poison: M.u8(a + C.poison),
			base: {},
			cur: {},
			psy: [],
			items: [],
			djOwned: [],
			djSet: []
		};
		for (const k in C.base) ch.base[k] = k === 'luck' ? M.u8(a + C.base[k]) : M.u16(a + C.base[k]);
		for (const k in C.cur) ch.cur[k] = k === 'luck' ? M.u8(a + C.cur[k]) : M.u16(a + C.cur[k]);
		for (let s = 0; s < 32; s++) ch.psy.push(M.u32(a + C.psy + s * 4));
		for (let s = 0; s < 15; s++) ch.items.push(M.u16(a + C.items + s * 2));
		for (let e = 0; e < 4; e++) {
			ch.djOwned.push(M.u32(a + C.djOwned + e * 4));
			ch.djSet.push(M.u32(a + C.djSet + e * 4));
		}
		return ch;
	}

	function queueMax(ctx) {
		return Math.floor((ctx.cb + C.queueCount - (EW + C.djinnQueue)) / 4);
	}
	function readQueue(ctx) {
		const n = Math.min(M.u8(ctx.cb + C.queueCount), queueMax(ctx));
		const q = [];
		for (let k = 0; k < n; k++) {
			const b = M.bytes(EW + C.djinnQueue + k * 4, 4);
			q.push({ e: b[0], idx: b[1], c: b[2], turns: b[3] });
		}
		return q;
	}
	function writeQueue(ctx, q) {
		const max = queueMax(ctx);
		q = q.slice(0, max);
		const buf = new Uint8Array(max * 4);
		q.forEach((x, k) => buf.set([x.e, x.idx, x.c, x.turns], k * 4));
		M.wbytes(EW + C.djinnQueue, buf);
		M.w8(ctx.cb + C.queueCount, q.length);
	}

	// Liste des djinns d'un perso : [{e, idx, state:'set'|'standby'|'rest', turns}]
	function djinnList(ctx, ch, queue) {
		const out = [];
		for (let e = 0; e < 4; e++) {
			for (let b = 0; b < 20; b++) {
				if (!(ch.djOwned[e] & (1 << b))) continue;
				const set = !!(ch.djSet[e] & (1 << b));
				let state = set ? 'set' : 'standby',
					turns = 0;
				if (!set) {
					const q = queue.find((x) => x.e === e && x.idx === b && x.c === ch.i);
					if (q && q.turns !== 0xff) {
						state = 'rest';
						turns = q.turns;
					}
				}
				out.push({ e, idx: b, state, turns });
			}
		}
		return out;
	}

	function writeDjinn(ctx, ci, list) {
		const a = charAddr(ctx, ci);
		const owned = [0, 0, 0, 0],
			set = [0, 0, 0, 0];
		for (const d of list) {
			owned[d.e] |= 1 << d.idx;
			if (d.state === 'set') set[d.e] |= 1 << d.idx;
		}
		for (let e = 0; e < 4; e++) {
			M.w32(a + C.djOwned + e * 4, owned[e]);
			M.w32(a + C.djSet + e * 4, set[e]);
			M.w8(a + C.djOwnedCount + e, popcount(owned[e] >>> 0));
			M.w8(a + C.djSetCount + e, popcount(set[e] >>> 0));
		}
		// Drapeaux globaux "djinn obtenu" = OU de tous les persos, 20 bits par élément
		let flags = 0n;
		const raw = M.bytes(EW + C.djinnFlags, 10);
		for (let k = 9; k >= 0; k--) flags = (flags << 8n) | BigInt(raw[k]);
		for (let e = 0; e < 4; e++) {
			let m = 0;
			for (let c = 0; c < NB_CHARS; c++) m |= M.u32(charAddr(ctx, c) + C.djOwned + e * 4);
			const sh = BigInt(20 * e);
			flags &= ~(0xfffffn << sh);
			flags |= BigInt(m & 0xfffff) << sh;
		}
		const out = new Uint8Array(10);
		for (let k = 0; k < 10; k++) out[k] = Number((flags >> BigInt(8 * k)) & 0xffn);
		M.wbytes(EW + C.djinnFlags, out);
		// File des djinns en attente / en repos
		const old = readQueue(ctx);
		const mine = list.filter((d) => d.state !== 'set');
		const q = [];
		for (const x of old) {
			if (x.c !== ci) {
				q.push(x);
				continue;
			}
			const d = mine.find((d) => d.e === x.e && d.idx === x.idx);
			if (d) {
				q.push({ e: d.e, idx: d.idx, c: ci, turns: d.state === 'rest' ? d.turns : 0xff });
				d._done = true;
			}
		}
		for (const d of mine)
			if (!d._done) q.push({ e: d.e, idx: d.idx, c: ci, turns: d.state === 'rest' ? d.turns : 0xff });
		writeQueue(ctx, q);
	}

	function posAddr(ctx) {
		const map = M.u16(ctx.cb + C.map),
			door = M.u16(ctx.cb + C.door);
		if (ctx.game === 1) {
			if (map === 2) return [{ label: 'Perso', a: EW + 0x30dac }];
			if (map >= 0x8f && map <= 0x91 && door === 1) return [{ label: 'Perso', a: EW + 0x30f34 }];
			return [{ label: 'Perso', a: EW + 0x30ec4 }];
		}
		return [
			{ label: 'Perso', a: EW + (map === 2 ? 0x321c0 : 0x322f4) },
			{ label: 'Bateau', a: EW + 0x32240 }
		];
	}

	/* ------------------------------ Index des données ------------------------------ */
	const byId = (arr) => {
		const m = new Map();
		for (const x of arr) if (!m.has(x[0])) m.set(x[0], x);
		return m;
	};
	const PSY = byId(D.psy),
		ITEMS = byId(D.items),
		CLASSES = byId(D.classes);
	const DJINN = D.djinn; // [e, idx, jeux, nom]
	const djinnName = (e, idx) => {
		const d = DJINN.find((x) => x[0] === e && x[1] === idx);
		return d ? d[3] : `${ELEMENTS[e]} #${idx}`;
	};
	const inGame = (flags, game) => !!(flags & game);
	const PSY_ELEM = { 1: 'Terre', 2: 'Eau', 4: 'Feu', 8: 'Air', 16: 'Neutre' };
	const psyCat = (cat) => `${cat & 0x20 ? 'Spécial' : 'Normal'} · ${PSY_ELEM[cat & 0x1f] || '?'}`;
	const ITEM_SUB = {
		9: { 0x40: 'Épées', 0x80: 'Sabres', 0x100: 'Bâtons', 0x200: 'Masses', 0x400: 'Haches' },
		10: { 0x40: 'Tête', 0x80: 'Corps', 0x100: 'Bras', 0x200: 'Jambes' }
	};
	function itemCat(cat) {
		const kind = cat & 0x1f,
			sub = cat & ~0x1f;
		if (kind === 9) return 'Arme · ' + (ITEM_SUB[9][sub] || '?');
		if (kind === 10) return 'Défense · ' + (ITEM_SUB[10][sub] || '?');
		return 'Objet';
	}
	const itemKind = (cat) => ((cat & 0x1f) === 9 ? 'arme' : (cat & 0x1f) === 10 ? 'def' : 'obj');
	function locName(game, map, door) {
		for (const l of D.locs[game] || [])
			for (const s of l.s) if (s[0] === map && s[1] === door) return `${l.n} — ${s[2]}`;
		for (const l of D.locs[game] || []) for (const s of l.s) if (s[0] === map) return l.n;
		return null;
	}

	/* ------------------------------ UI ------------------------------ */
	const CSS = `
#gse-fab{position:fixed;right:16px;bottom:16px;z-index:99998;font:700 13px/1 ui-monospace,Menlo,Consolas,monospace;
 letter-spacing:.12em;color:#1a1206;background:linear-gradient(160deg,#ffd879,#d79a2b);border:0;border-radius:999px;
 padding:12px 16px;box-shadow:0 6px 20px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.5);cursor:pointer}
#gse-fab:active{transform:translateY(1px)}
#gse{--bg:#0f1114;--bg2:#171a1f;--bg3:#20242b;--line:#2c313a;--tx:#e6e1d6;--mut:#8d8a83;--gold:#f2c14e;--gold2:#b8862a;
 --ok:#7bd88f;--err:#ff6b6b;--venus:#e0a34a;--mercury:#58a6ff;--mars:#ff6b57;--jupiter:#c58cff;
 position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);z-index:99999;background:var(--bg);color:var(--tx);
 font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;text-align:left;display:flex;flex-direction:column;border-left:1px solid var(--line);
 box-shadow:-12px 0 40px rgba(0,0,0,.5);transform:translateX(105%);transition:transform .22s ease}
#gse.open{transform:none}
#gse *{box-sizing:border-box}
#gse header{padding:12px 14px 10px;border-bottom:1px solid var(--line);background:var(--bg2)}
#gse .top{display:flex;align-items:center;gap:8px}
#gse .brand{font-weight:700;color:var(--gold);letter-spacing:.14em}
#gse .badge{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
#gse .sp{flex:1}
#gse button{font:inherit;color:var(--tx);background:var(--bg3);border:1px solid var(--line);border-radius:6px;padding:6px 10px;cursor:pointer}
#gse button:hover{border-color:var(--gold2)}
#gse button.pri{background:var(--gold);color:#1a1206;border-color:var(--gold);font-weight:700}
#gse button.danger{color:var(--err)}
#gse button.ic{padding:4px 8px}
#gse .status{margin-top:6px;font-size:12px;color:var(--mut);min-height:1.45em}
#gse .status.err{color:var(--err)} #gse .status.ok{color:var(--ok)}
#gse .chars{display:flex;gap:6px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid var(--line);scrollbar-width:none}
#gse .chars button{white-space:nowrap;padding:5px 10px;border-radius:999px}
#gse .chars button.on{background:var(--gold);color:#1a1206;border-color:var(--gold);font-weight:700}
#gse nav{display:flex;border-bottom:1px solid var(--line)}
#gse nav button{flex:1;border:0;border-radius:0;background:none;padding:10px 0;color:var(--mut);border-bottom:2px solid transparent}
#gse nav button.on{color:var(--gold);border-bottom-color:var(--gold)}
#gse main{flex:1;overflow:auto;padding:14px}
#gse h3{margin:16px 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);font-weight:600}
#gse h3:first-child{margin-top:0}
#gse label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--mut)}
#gse input,#gse select{font:inherit;font-size:14px;color:var(--tx);background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:6px 8px;width:100%;min-width:0}
#gse input:focus,#gse select:focus{outline:none;border-color:var(--gold)}
#gse input[type=checkbox],#gse input[type=radio]{width:auto;accent-color:var(--gold)}
#gse .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
#gse .row{display:flex;gap:8px;align-items:end}
#gse .row>*{flex:1}
#gse .chk{flex-direction:row;align-items:center;gap:6px;color:var(--tx);font-size:13px}
#gse table{width:100%;border-collapse:collapse}
#gse td,#gse th{font-size:13px;padding:4px 6px;border-bottom:1px solid var(--line);text-align:left}
#gse th{font-size:11px;color:var(--mut);font-weight:600}
#gse .list{border:1px solid var(--line);border-radius:8px;overflow:hidden}
#gse .li{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--line);cursor:pointer}
#gse .li:last-child{border-bottom:0}
#gse .li:hover{background:var(--bg2)}
#gse .li.sel{background:var(--bg3);box-shadow:inset 3px 0 0 var(--gold)}
#gse .li .n{color:var(--mut);width:22px;font-size:11px}
#gse .li .t{flex:1}
#gse .li .m{font-size:11px;color:var(--mut)}
#gse .li.empty .t{color:var(--mut);font-style:italic}
#gse .editor{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg2);display:flex;flex-direction:column;gap:8px}
#gse .actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
#gse .hint{font-size:11px;color:var(--mut);margin:6px 0 0}
#gse .dot{width:9px;height:9px;border-radius:50%;flex:none}
#gse .venus{background:var(--venus)} #gse .mercury{background:var(--mercury)} #gse .mars{background:var(--mars)} #gse .jupiter{background:var(--jupiter)}
#gse .tag{font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid var(--line);color:var(--mut)}
#gse .tag.set{color:var(--ok);border-color:#2f5a3a}
#gse .pad{display:grid;grid-template-columns:repeat(3,44px);gap:4px}
#gse .pad button{height:40px;padding:0}
#gse .team .li{cursor:default}
#gse footer{padding:10px 14px;border-top:1px solid var(--line);background:var(--bg2);display:flex;gap:8px;align-items:center}
#gse .blocker{padding:30px 10px;text-align:center;color:var(--mut)}
@media (max-width:640px){
 #gse{top:auto;width:100vw;height:78vh;border-left:0;border-top:1px solid var(--line);border-radius:14px 14px 0 0;transform:translateY(105%)}
 #gse.open{transform:none}
 #gse-fab{bottom:12px;right:12px}
}`;

	const h = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

	const st = {
		open: false,
		tab: 'misc',
		ci: 0,
		ctx: null,
		pauseWhileOpen: true,
		wasRunning: false,
		sel: { psy: -1, item: -1, djinn: -1 },
		filter: { psy: '', psyCat: 'all', item: '', itemKind: 'all' }
	};
	try {
		const p = localStorage.getItem('gse.pause');
		if (p !== null) st.pauseWhileOpen = p === '1';
	} catch (e) {}

	let root, fab, mainEl, statusEl, charsEl;

	function setStatus(msg, cls) {
		if (!statusEl) return;
		statusEl.textContent = msg || '';
		statusEl.className = 'status' + (cls ? ' ' + cls : '');
	}

	function build() {
		const style = document.createElement('style');
		style.textContent = CSS;
		document.head.appendChild(style);

		fab = document.createElement('button');
		fab.id = 'gse-fab';
		fab.textContent = 'GSE';
		fab.title = 'Golden Sun Editor (F2)';
		fab.addEventListener('click', toggle);
		document.body.appendChild(fab);

		root = document.createElement('aside');
		root.id = 'gse';
		root.innerHTML = `
<header>
 <div class="top"><span class="brand">GSE</span><span class="badge" data-k="game">—</span><span class="sp"></span>
  <button class="ic" data-act="refresh" title="Relire la RAM">⟳</button>
  <button class="ic" data-act="close" title="Fermer">✕</button></div>
 <div class="status" data-k="status"></div>
</header>
<div class="chars" data-k="chars"></div>
<nav>
 <button data-tab="misc">Misc</button><button data-tab="stats">Stats</button><button data-tab="psy">Psy</button>
 <button data-tab="djinn">Djinns</button><button data-tab="items">Objets</button>
</nav>
<main data-k="main"></main>
<footer><label class="chk"><input type="checkbox" data-k="pause"> Pause pendant l'édition</label></footer>`;
		document.body.appendChild(root);
		mainEl = root.querySelector('[data-k=main]');
		statusEl = root.querySelector('[data-k=status]');
		charsEl = root.querySelector('[data-k=chars]');
		const pauseEl = root.querySelector('[data-k=pause]');
		pauseEl.checked = st.pauseWhileOpen;
		pauseEl.addEventListener('change', () => {
			st.pauseWhileOpen = pauseEl.checked;
			try {
				localStorage.setItem('gse.pause', st.pauseWhileOpen ? '1' : '0');
			} catch (e) {}
			applyPause();
		});
		root.addEventListener('click', onClick);
		// Empêche le keypad de gbajs de "manger" les touches tapées dans les champs
		root.addEventListener('focusin', (e) => {
			const g = getGBA();
			if (g && g.keypad && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) {
				root._eat = g.keypad.eatInput;
				g.keypad.eatInput = false;
				g.keypad.currentDown = 0x3ff;
			}
		});
		root.addEventListener('focusout', () => {
			const g = getGBA();
			if (g && g.keypad && root._eat !== undefined) {
				g.keypad.eatInput = root._eat;
				root._eat = undefined;
			}
		});
		window.addEventListener('keydown', (e) => {
			if (e.key === 'F2') {
				e.preventDefault();
				toggle();
			}
		});
	}

	function applyPause() {
		const g = getGBA();
		if (!g) return;
		if (st.open && st.pauseWhileOpen) {
			if (!g.paused) {
				st.wasRunning = true;
				g.pause();
			}
		} else if (st.wasRunning) {
			st.wasRunning = false;
			if (g.hasRom && g.hasRom()) g.runStable();
		}
	}

	function toggle() {
		st.open = !st.open;
		root.classList.toggle('open', st.open);
		applyPause();
		if (st.open) refresh();
	}

	function refresh(keepMsg) {
		const ctx = detect();
		st.ctx = ctx;
		root.querySelector('[data-k=game]').textContent = ctx.ok ? `GS${ctx.game} · ${ctx.code || '?'}` : '—';
		if (!keepMsg) setStatus('');
		if (!ctx.ok) {
			charsEl.innerHTML = '';
			mainEl.innerHTML = `<div class="blocker">${h(ctx.err)}</div>`;
			return;
		}
		if (!ctx.loaded) {
			charsEl.innerHTML = '';
			mainEl.innerHTML = `<div class="blocker">${h(ctx.G.label)} détecté.<br>Charge ou commence une partie, puis ⟳.</div>`;
			return;
		}
		if (!keepMsg && !ctx.frVersion)
			setStatus(`ROM ${ctx.code} : GSE ciblait la version FR — temps de jeu/position à vérifier.`);
		renderChars();
		render();
	}

	function chars() {
		const ctx = st.ctx;
		const out = [];
		for (let i = 0; i < NB_CHARS; i++) {
			const a = charAddr(ctx, i);
			const name = readName(a);
			const lvl = M.u8(a + C.level);
			if (name && lvl) out.push({ i, name, lvl });
		}
		return out;
	}

	function renderChars() {
		const list = chars();
		if (!list.find((c) => c.i === st.ci)) st.ci = list.length ? list[0].i : 0;
		charsEl.innerHTML = list
			.map((c) => `<button data-ci="${c.i}" class="${c.i === st.ci ? 'on' : ''}">${h(c.name)} <small>Nv${c.lvl}</small></button>`)
			.join('');
		charsEl.style.display = st.tab === 'misc' ? 'none' : '';
	}

	function render() {
		root.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
		charsEl.style.display = st.tab === 'misc' ? 'none' : '';
		const fn = { misc: renderMisc, stats: renderStats, psy: renderPsy, djinn: renderDjinn, items: renderItems }[st.tab];
		mainEl.innerHTML = fn();
		bindAfterRender();
	}

	/* ------------------------------ Onglet Misc ------------------------------ */
	function renderMisc() {
		const ctx = st.ctx;
		const frames = M.u32(ctx.G.playtime);
		const tot = Math.floor(frames / 60);
		const H = Math.floor(tot / 3600),
			Mi = Math.floor((tot % 3600) / 60);
		const gold = M.u32(EW + C.gold);
		const flags = M.u8(EW + C.partyFlags);
		const order = Array.from(M.bytes(ctx.cb + C.order, 8));
		// ordre complet : ordre RAM puis persos manquants
		const seen = new Set();
		const ord = [];
		for (const x of order)
			if (x < NB_CHARS && !seen.has(x)) {
				seen.add(x);
				ord.push(x);
			}
		for (let i = 0; i < NB_CHARS; i++) if (!seen.has(i)) ord.push(i);
		st.teamOrder = ord;
		const names = ord.map((i) => readName(charAddr(ctx, i)) || DEFAULT_NAMES[i]);
		const map = M.u16(ctx.cb + C.map),
			door = M.u16(ctx.cb + C.door);
		const here = locName(ctx.game, map, door);
		const summ = ctx.G.summons ? M.u16(EW + C.summons) : 0;
		const locs = D.locs[ctx.game] || [];
		const positions = posAddr(ctx)
			.map((p) => {
				const x = M.s32(p.a),
					y = M.s32(p.a + 4),
					z = M.s32(p.a + 8);
				return `<div class="hint">${p.label} : x=${(x / 65536).toFixed(1)} y=${(y / 65536).toFixed(1)} z=${(z / 65536).toFixed(1)}</div>`;
			})
			.join('');
		return `
<h3>Partie</h3>
<div class="row">
 <label>Heures<input type="number" min="0" max="999" data-f="h" value="${H}"></label>
 <label>Minutes<input type="number" min="0" max="59" data-f="m" value="${Mi}"></label>
 <label>Pièces<input type="number" min="0" max="999999" data-f="gold" value="${gold}"></label>
</div>
<h3>Équipe <span class="tag">cochés = dans l'équipe, dans l'ordre</span></h3>
<div class="list team">${ord
			.map(
				(i, k) => `<div class="li"><input type="checkbox" data-team="${i}" ${flags & (1 << i) ? 'checked' : ''}>
 <span class="t">${h(names[k])}</span>
 <button class="ic" data-act="up" data-k="${k}" ${k === 0 ? 'disabled' : ''}>↑</button>
 <button class="ic" data-act="down" data-k="${k}" ${k === NB_CHARS - 1 ? 'disabled' : ''}>↓</button></div>`
			)
			.join('')}</div>
${
	ctx.G.summons
		? `<h3>Invocations</h3><div class="grid">${D.summons
				.map(
					(s) => `<label class="chk"><input type="checkbox" data-sum="${s[0]}" ${summ & s[0] ? 'checked' : ''}>${h(s[1])}</label>`
				)
				.join('')}<label class="chk"><input type="checkbox" data-act="sumall">Toutes</label></div>`
		: ''
}
<div class="actions" style="margin-top:12px"><button class="pri" data-act="saveMisc">Appliquer</button></div>

<h3>Position</h3>
<div class="hint">Zone actuelle : ${h(here || 'inconnue')} <span class="tag">map ${map} · porte ${door}</span></div>
${positions}
<div class="row" style="margin-top:8px;align-items:center">
 <div class="pad">
  <button data-mv="-1,-1">↖</button><button data-mv="0,-1">↑</button><button data-mv="1,-1">↗</button>
  <button data-mv="-1,0">←</button><button disabled>·</button><button data-mv="1,0">→</button>
  <button data-mv="-1,1">↙</button><button data-mv="0,1">↓</button><button data-mv="1,1">↘</button>
 </div>
 <div style="display:flex;flex-direction:column;gap:6px">
  <label>Pas<select data-f="step"><option value="65536">/10</option><option value="1048576" selected>x1</option><option value="16777216">x10</option></select></label>
  ${ctx.game === 2 ? `<label>Cible<select data-f="postarget"><option value="0">Perso</option><option value="1">Bateau</option></select></label>` : ''}
 </div>
</div>
<h3>Téléportation</h3>
<div class="row">
 <label>Lieu<select data-f="loc">${locs.map((l, k) => `<option value="${k}">${h(l.n)}</option>`).join('')}</select></label>
 <label>Entrée<select data-f="subloc"></select></label>
</div>
<div class="actions" style="margin-top:8px"><button class="pri" data-act="teleport">GO</button></div>
<p class="hint">La destination est prise en compte au prochain changement de zone (comme GSE). Si rien ne se passe, sauvegarde et recharge la partie.</p>`;
	}

	function fillSubloc() {
		const sel = mainEl.querySelector('[data-f=loc]');
		const sub = mainEl.querySelector('[data-f=subloc]');
		if (!sel || !sub) return;
		const l = (D.locs[st.ctx.game] || [])[+sel.value];
		sub.innerHTML = l ? l.s.map((s, k) => `<option value="${k}">${h(s[2])}</option>`).join('') : '';
	}

	function saveMisc() {
		const ctx = st.ctx;
		const v = (k) => mainEl.querySelector(`[data-f=${k}]`).value;
		const H = Math.max(0, Math.min(999, parseInt(v('h'), 10) || 0));
		const Mi = Math.max(0, Math.min(59, parseInt(v('m'), 10) || 0));
		M.w32(ctx.G.playtime, H * 216000 + Mi * 3600);
		M.w32(EW + C.gold, Math.max(0, Math.min(999999, parseInt(v('gold'), 10) || 0)));
		// équipe : membres cochés d'abord (dans l'ordre affiché), puis les autres
		let flags = 0;
		const inT = [],
			out = [];
		for (const i of st.teamOrder) {
			const cb = mainEl.querySelector(`[data-team="${i}"]`);
			if (cb.checked) {
				flags |= 1 << i;
				inT.push(i);
			} else out.push(i);
		}
		if (!inT.length) return setStatus("L'équipe ne peut pas être vide.", 'err');
		M.w8(EW + C.partyFlags, flags);
		M.wbytes(ctx.cb + C.order, inT.concat(out));
		if (ctx.G.summons) {
			let s = M.u16(EW + C.summons) | 0x8000;
			mainEl.querySelectorAll('[data-sum]').forEach((c) => {
				const b = +c.dataset.sum;
				s = c.checked ? s | b : s & ~b;
			});
			M.w16(EW + C.summons, s);
		}
		done('Partie mise à jour.');
	}

	function move(dx, dz) {
		const ctx = st.ctx;
		const step = +mainEl.querySelector('[data-f=step]').value;
		const tgtSel = mainEl.querySelector('[data-f=postarget]');
		const p = posAddr(ctx)[tgtSel ? +tgtSel.value : 0];
		M.w32(p.a, M.s32(p.a) + dx * step);
		M.w32(p.a + 8, M.s32(p.a + 8) + dz * step);
		done('Position déplacée.');
	}

	function teleport() {
		const ctx = st.ctx;
		const l = (D.locs[ctx.game] || [])[+mainEl.querySelector('[data-f=loc]').value];
		const s = l && l.s[+mainEl.querySelector('[data-f=subloc]').value];
		if (!s) return;
		M.w16(ctx.cb + C.map, s[0]);
		M.w16(ctx.cb + C.door, s[1]);
		done(`Destination : ${l.n} — ${s[2]}`);
	}

	/* ------------------------------ Onglet Stats ------------------------------ */
	function renderStats() {
		const ctx = st.ctx;
		const ch = readChar(ctx, st.ci);
		const classes = D.classes.filter((c) => inGame(c[1], ctx.game));
		const hasCls = classes.some((c) => c[0] === ch.cls);
		const row = (lbl, b, c) =>
			`<tr><td>${lbl}</td><td><input type="number" data-base="${b}" value="${ch.base[b]}"></td><td><input type="number" data-cur="${c}" value="${ch.cur[c]}"></td></tr>`;
		return `
<div class="row">
 <label>Nom<input maxlength="14" data-f="name" value="${h(ch.name)}"></label>
 <label style="max-width:80px">Niveau<input type="number" min="1" max="99" data-f="level" value="${ch.level}"></label>
</div>
<div class="row" style="margin-top:8px">
 <label>Expérience<input type="number" min="0" data-f="exp" value="${ch.exp}"></label>
 <label>Classe<select data-f="cls">${hasCls ? '' : `<option value="${ch.cls}" selected>#${ch.cls}</option>`}${classes
			.map((c) => `<option value="${c[0]}" ${c[0] === ch.cls ? 'selected' : ''}>${h(c[2])}</option>`)
			.join('')}</select></label>
</div>
<h3>PV / PP</h3>
<div class="row">
 <label>PV<input type="number" data-cur="hp" value="${ch.cur.hp}"></label>
 <label>PV max<input type="number" data-cur="maxhp" value="${ch.cur.maxhp}"></label>
 <label>PP<input type="number" data-cur="pp" value="${ch.cur.pp}"></label>
 <label>PP max<input type="number" data-cur="maxpp" value="${ch.cur.maxpp}"></label>
</div>
<h3>Caractéristiques</h3>
<table><tr><th></th><th>Base</th><th>Actuel</th></tr>
<tr><td>PV max</td><td><input type="number" data-base="hp" value="${ch.base.hp}"></td><td class="m">${ch.cur.maxhp}</td></tr>
<tr><td>PP max</td><td><input type="number" data-base="pp" value="${ch.base.pp}"></td><td class="m">${ch.cur.maxpp}</td></tr>
${row('Attaque', 'atk', 'atk')}${row('Défense', 'def', 'def')}${row('Agilité', 'agi', 'agi')}${row('Chance', 'luck', 'luck')}
</table>
<p class="hint">« Base » est permanent. « Actuel » est recalculé par le jeu (montée de niveau, équipement, djinns).</p>
<h3>Statut</h3>
<div class="grid">
 <label class="chk"><input type="checkbox" data-f="cursed" ${ch.cursed ? 'checked' : ''}>Maudit</label>
 <label class="chk"><input type="radio" name="gse-poi" value="0" ${ch.poison === 0 ? 'checked' : ''}>Sain</label>
 <label class="chk"><input type="radio" name="gse-poi" value="1" ${ch.poison === 1 ? 'checked' : ''}>Poison</label>
 <label class="chk"><input type="radio" name="gse-poi" value="2" ${ch.poison === 2 ? 'checked' : ''}>Venin</label>
</div>
<div class="actions" style="margin-top:14px"><button class="pri" data-act="saveStats">Appliquer</button></div>`;
	}

	function saveStats() {
		const ctx = st.ctx;
		const a = charAddr(ctx, st.ci);
		const q = (s) => mainEl.querySelector(s);
		const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || 0));
		writeName(a + C.name, q('[data-f=name]').value);
		M.w8(a + C.level, clamp(q('[data-f=level]').value, 1, 99));
		M.w32(a + C.exp, clamp(q('[data-f=exp]').value, 0, 0x7fffffff));
		M.w8(a + C.cls, clamp(q('[data-f=cls]').value, 0, 255));
		mainEl.querySelectorAll('[data-base]').forEach((el) => {
			const k = el.dataset.base;
			if (k === 'luck') M.w8(a + C.base[k], clamp(el.value, 0, 255));
			else M.w16(a + C.base[k], clamp(el.value, 0, 9999));
		});
		mainEl.querySelectorAll('[data-cur]').forEach((el) => {
			const k = el.dataset.cur;
			if (k === 'luck') M.w8(a + C.cur[k], clamp(el.value, 0, 255));
			else M.w16(a + C.cur[k], clamp(el.value, 0, 9999));
		});
		M.w8(a + C.cursed, q('[data-f=cursed]').checked ? 1 : 0);
		M.w8(a + C.poison, +q('input[name=gse-poi]:checked').value);
		done('Stats mises à jour.');
		renderChars();
	}

	/* ------------------------------ Onglet Psynergies ------------------------------ */
	function renderPsy() {
		const ctx = st.ctx;
		const ch = readChar(ctx, st.ci);
		const n = ch.psy.findIndex((v) => (v & 0xffff) === 0);
		const count = n < 0 ? 32 : n;
		const rows = [];
		for (let s = 0; s < Math.min(32, count + 1); s++) {
			const v = ch.psy[s];
			const id = v & 0xffff;
			const p = PSY.get(id & 0x3ff);
			rows.push(`<div class="li ${s === st.sel.psy ? 'sel' : ''} ${id ? '' : 'empty'}" data-psysel="${s}">
 <span class="n">${s + 1}</span><span class="t">${id ? h(p ? p[3] : '#' + id) : '— emplacement libre —'}</span>
 ${p ? `<span class="m">${h(psyCat(p[2]))}</span>` : ''}${v >>> 16 ? `<span class="tag" title="Octets hauts">+${(v >>> 16).toString(16)}</span>` : ''}</div>`);
		}
		const sel = st.sel.psy;
		const cur = sel >= 0 ? ch.psy[sel] & 0xffff : 0;
		return `
<h3>${count}/32 psynergies</h3>
<div class="list">${rows.join('')}</div>
${
	sel >= 0
		? `<div class="editor">
 <div class="row">
  <label>Catégorie<select data-f="psycat"><option value="all">Toutes</option>${[1, 2, 4, 8, 16, 0x21, 0x22, 0x24, 0x28, 0x30]
		.map((c) => `<option value="${c}" ${st.filter.psyCat == c ? 'selected' : ''}>${psyCat(c)}</option>`)
		.join('')}</select></label>
  <label>Rechercher<input data-f="psyq" value="${h(st.filter.psy)}" placeholder="nom…"></label>
 </div>
 <label>Psynergie (emplacement ${sel + 1})<select data-f="psyid" size="6">${psyOptions(cur)}</select></label>
 <div class="actions">${cur ? '<button class="danger" data-act="psyDel">Supprimer</button>' : ''}<button class="pri" data-act="psySet">${cur ? 'Changer' : 'Ajouter'}</button></div>
</div>`
		: '<p class="hint">Touche un emplacement pour le modifier.</p>'
}
<p class="hint">Le jeu reconstruit la liste quand la classe change (djinns, niveau) : les psynergies hors classe peuvent disparaître.</p>`;
	}
	function psyOptions(cur) {
		const g = st.ctx.game,
			q = st.filter.psy.toLowerCase(),
			c = st.filter.psyCat;
		return D.psy
			.filter((p) => inGame(p[1], g) && (c === 'all' || p[2] == c) && (!q || p[3].toLowerCase().includes(q)))
			.map((p) => `<option value="${p[0]}" ${p[0] === cur ? 'selected' : ''}>${h(p[3])} · ${psyCat(p[2])}</option>`)
			.join('');
	}
	function psySet() {
		const a = charAddr(st.ctx, st.ci);
		const id = +mainEl.querySelector('[data-f=psyid]').value;
		if (!id) return setStatus('Choisis une psynergie dans la liste.', 'err');
		M.w16(a + C.psy + st.sel.psy * 4, id);
		done('Psynergie enregistrée.');
	}
	function psyDel() {
		const a = charAddr(st.ctx, st.ci);
		const list = [];
		for (let s = 0; s < 32; s++) list.push(M.u32(a + C.psy + s * 4));
		list.splice(st.sel.psy, 1);
		list.push(0);
		list.forEach((v, s) => M.w32(a + C.psy + s * 4, v));
		st.sel.psy = -1;
		done('Psynergie supprimée.');
	}

	/* ------------------------------ Onglet Djinns ------------------------------ */
	function renderDjinn() {
		const ctx = st.ctx;
		const ch = readChar(ctx, st.ci);
		const list = djinnList(ctx, ch, readQueue(ctx));
		st.djinn = list;
		const sel = st.sel.djinn;
		const stateLbl = (d) =>
			d.state === 'set' ? '<span class="tag set">Assigné</span>' : d.state === 'rest' ? `<span class="tag">Repos ${d.turns}</span>` : '<span class="tag">En attente</span>';
		const rows = list.map(
			(d, k) => `<div class="li ${k === sel ? 'sel' : ''}" data-djsel="${k}"><span class="dot ${ELEM_KEYS[d.e]}"></span>
 <span class="t">${h(djinnName(d.e, d.idx))}</span><span class="m">${ELEMENTS[d.e]}</span>${stateLbl(d)}</div>`
		);
		if (list.length < 9) rows.push(`<div class="li empty ${sel === list.length ? 'sel' : ''}" data-djsel="${list.length}"><span class="dot"></span><span class="t">+ ajouter un djinn</span></div>`);
		const cur = list[sel];
		const elem = cur ? cur.e : st.djElem || 0;
		return `
<h3>${list.length} djinn${list.length > 1 ? 's' : ''}</h3>
<div class="list">${rows.join('')}</div>
${
	sel >= 0
		? `<div class="editor">
 <div class="row">
  <label>Élément<select data-f="djel">${ELEMENTS.map((e, k) => `<option value="${k}" ${k === elem ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
  <label>Djinn<select data-f="djid">${djOptions(elem, cur)}</select></label>
 </div>
 <div class="row">
  <label>État<select data-f="djst">
   <option value="set" ${!cur || cur.state === 'set' ? 'selected' : ''}>Assigné</option>
   <option value="standby" ${cur && cur.state === 'standby' ? 'selected' : ''}>En attente</option>
   <option value="rest" ${cur && cur.state === 'rest' ? 'selected' : ''}>Repos</option></select></label>
  <label style="max-width:90px">Tours<input type="number" min="0" max="99" data-f="djturns" value="${cur && cur.state === 'rest' ? cur.turns : 1}"></label>
 </div>
 <div class="actions">${cur ? '<button class="danger" data-act="djDel">Supprimer</button>' : ''}<button class="pri" data-act="djSet">${cur ? 'Changer' : 'Ajouter'}</button></div>
</div>`
		: '<p class="hint">Touche un djinn pour le modifier (9 max par perso, comme GSE).</p>'
}`;
	}
	function djOptions(e, cur) {
		const g = st.ctx.game;
		return DJINN.filter((d) => d[0] === e && inGame(d[2], g))
			.map((d) => `<option value="${d[1]}" ${cur && cur.e === e && cur.idx === d[1] ? 'selected' : ''}>${h(d[3])}</option>`)
			.join('');
	}
	function djSet() {
		const q = (s) => mainEl.querySelector(s);
		const e = +q('[data-f=djel]').value,
			idx = +q('[data-f=djid]').value;
		const state = q('[data-f=djst]').value;
		const turns = Math.max(0, Math.min(99, parseInt(q('[data-f=djturns]').value, 10) || 0));
		const list = st.djinn.map((d) => ({ ...d }));
		const sel = st.sel.djinn;
		// un djinn ne peut appartenir qu'à un seul perso
		for (let c = 0; c < NB_CHARS; c++) {
			if (c === st.ci) continue;
			if (M.u32(charAddr(st.ctx, c) + C.djOwned + e * 4) & (1 << idx))
				return setStatus(`${djinnName(e, idx)} appartient déjà à ${readName(charAddr(st.ctx, c))}.`, 'err');
		}
		const dup = list.findIndex((d) => d.e === e && d.idx === idx);
		if (dup >= 0 && dup !== sel) return setStatus('Ce perso possède déjà ce djinn.', 'err');
		const nd = { e, idx, state: state === 'rest' && turns === 0 ? 'standby' : state, turns };
		if (sel < list.length) list[sel] = nd;
		else list.push(nd);
		writeDjinn(st.ctx, st.ci, list);
		st.sel.djinn = -1;
		done('Djinns mis à jour.');
	}
	function djDel() {
		const list = st.djinn.filter((_, k) => k !== st.sel.djinn).map((d) => ({ ...d }));
		writeDjinn(st.ctx, st.ci, list);
		st.sel.djinn = -1;
		done('Djinn retiré.');
	}

	/* ------------------------------ Onglet Objets ------------------------------ */
	function renderItems() {
		const ctx = st.ctx;
		const ch = readChar(ctx, st.ci);
		const n = ch.items.findIndex((v) => v === 0);
		const count = n < 0 ? 15 : n;
		const rows = [];
		for (let s = 0; s < Math.min(15, count + 1); s++) {
			const v = ch.items[s];
			const id = v & 0x1ff;
			const it = ITEMS.get(id);
			const tags = [];
			if (v & 0x200) tags.push('<span class="tag set">équipé</span>');
			if (v & 0x400) tags.push('<span class="tag">cassé</span>');
			const qty = (v >> 11) + 1;
			rows.push(`<div class="li ${s === st.sel.item ? 'sel' : ''} ${v ? '' : 'empty'}" data-itsel="${s}">
 <span class="n">${s + 1}</span><span class="t">${v ? h(it ? it[3] : '#' + id) : '— emplacement libre —'}${v && qty > 1 ? ` <span class="m">×${qty}</span>` : ''}</span>${tags.join('')}</div>`);
		}
		const sel = st.sel.item;
		const cur = sel >= 0 ? ch.items[sel] : 0;
		return `
<h3>${count}/15 objets</h3>
<div class="list">${rows.join('')}</div>
${
	sel >= 0
		? `<div class="editor">
 <div class="row">
  <label>Type<select data-f="itkind">${[
		['all', 'Tous'],
		['arme', 'Armes'],
		['def', 'Défense'],
		['obj', 'Autres']
	]
		.map(([k, l]) => `<option value="${k}" ${st.filter.itemKind === k ? 'selected' : ''}>${l}</option>`)
		.join('')}</select></label>
  <label>Rechercher<input data-f="itq" value="${h(st.filter.item)}" placeholder="nom…"></label>
 </div>
 <label>Objet (emplacement ${sel + 1})<select data-f="itid" size="6">${itemOptions(cur & 0x1ff)}</select></label>
 <div class="row">
  <label style="max-width:90px">Quantité<input type="number" min="1" max="30" data-f="itqty" value="${cur ? (cur >> 11) + 1 : 1}"></label>
  <label class="chk"><input type="checkbox" data-f="iteq" ${cur & 0x200 ? 'checked' : ''}>Équipé</label>
  <label class="chk"><input type="checkbox" data-f="itbr" ${cur & 0x400 ? 'checked' : ''}>Cassé</label>
 </div>
 <div class="actions">${cur ? '<button class="danger" data-act="itDel">Supprimer</button>' : ''}<button class="pri" data-act="itSet">${cur ? 'Changer' : 'Ajouter'}</button></div>
</div>`
		: '<p class="hint">Touche un emplacement pour le modifier.</p>'
}`;
	}
	function itemOptions(cur) {
		const g = st.ctx.game,
			q = st.filter.item.toLowerCase(),
			k = st.filter.itemKind;
		return D.items
			.filter((p) => inGame(p[1], g) && (k === 'all' || itemKind(p[2]) === k) && (!q || p[3].toLowerCase().includes(q)))
			.map((p) => `<option value="${p[0]}" ${p[0] === cur ? 'selected' : ''}>${h(p[3])} · ${itemCat(p[2])}</option>`)
			.join('');
	}
	function itSet() {
		const q = (s) => mainEl.querySelector(s);
		const id = +q('[data-f=itid]').value;
		if (!id) return setStatus('Choisis un objet dans la liste.', 'err');
		const qty = Math.max(1, Math.min(30, parseInt(q('[data-f=itqty]').value, 10) || 1));
		let v = id | ((qty - 1) << 11);
		if (q('[data-f=iteq]').checked) v |= 0x200;
		if (q('[data-f=itbr]').checked) v |= 0x400;
		M.w16(charAddr(st.ctx, st.ci) + C.items + st.sel.item * 2, v);
		done('Objet enregistré.');
	}
	function itDel() {
		const a = charAddr(st.ctx, st.ci);
		const list = [];
		for (let s = 0; s < 15; s++) list.push(M.u16(a + C.items + s * 2));
		list.splice(st.sel.item, 1);
		list.push(0);
		list.forEach((v, s) => M.w16(a + C.items + s * 2, v));
		st.sel.item = -1;
		done('Objet supprimé.');
	}

	/* ------------------------------ Événements ------------------------------ */
	function done(msg) {
		const keepTop = mainEl.scrollTop;
		refresh(true);
		mainEl.scrollTop = keepTop;
		setStatus('✓ ' + msg, 'ok');
	}

	function bindAfterRender() {
		const q = (s) => mainEl.querySelector(s);
		if (st.tab === 'misc') {
			const loc = q('[data-f=loc]');
			if (loc) {
				loc.addEventListener('change', fillSubloc);
				fillSubloc();
			}
			const all = q('[data-act=sumall]');
			if (all)
				all.addEventListener('change', () => mainEl.querySelectorAll('[data-sum]').forEach((c) => (c.checked = all.checked)));
		}
		if (st.tab === 'psy') {
			const cat = q('[data-f=psycat]'),
				qq = q('[data-f=psyq]'),
				sel = q('[data-f=psyid]');
			const upd = () => {
				st.filter.psyCat = cat.value;
				st.filter.psy = qq.value;
				const cur = +sel.value;
				sel.innerHTML = psyOptions(cur);
			};
			if (cat) {
				cat.addEventListener('change', upd);
				qq.addEventListener('input', upd);
			}
		}
		if (st.tab === 'items') {
			const k = q('[data-f=itkind]'),
				qq = q('[data-f=itq]'),
				sel = q('[data-f=itid]');
			const upd = () => {
				st.filter.itemKind = k.value;
				st.filter.item = qq.value;
				sel.innerHTML = itemOptions(+sel.value);
			};
			if (k) {
				k.addEventListener('change', upd);
				qq.addEventListener('input', upd);
			}
		}
		if (st.tab === 'djinn') {
			const el = q('[data-f=djel]');
			if (el)
				el.addEventListener('change', () => {
					st.djElem = +el.value;
					q('[data-f=djid]').innerHTML = djOptions(+el.value, null);
				});
		}
	}

	function onClick(e) {
		const t = e.target.closest('button,[data-psysel],[data-itsel],[data-djsel]');
		if (!t || !root.contains(t)) return;
		const ds = t.dataset;
		if (ds.tab) {
			st.tab = ds.tab;
			setStatus('');
			return refresh();
		}
		if (ds.ci !== undefined) {
			st.ci = +ds.ci;
			st.sel = { psy: -1, item: -1, djinn: -1 };
			setStatus('');
			return refresh();
		}
		if (ds.psysel !== undefined) {
			st.sel.psy = +ds.psysel;
			return render();
		}
		if (ds.itsel !== undefined) {
			st.sel.item = +ds.itsel;
			return render();
		}
		if (ds.djsel !== undefined) {
			st.sel.djinn = +ds.djsel;
			return render();
		}
		if (ds.mv) {
			const [dx, dz] = ds.mv.split(',').map(Number);
			return safe(() => move(dx, dz));
		}
		const act = ds.act;
		if (!act) return;
		if (act === 'close') return toggle();
		if (act === 'refresh') return refresh();
		if (act === 'up' || act === 'down') {
			// réordonne sans écrire (l'écriture se fait avec "Appliquer")
			const k = +ds.k,
				j = act === 'up' ? k - 1 : k + 1;
			const rows = [...mainEl.querySelectorAll('.team .li')];
			const checked = rows.map((r) => r.querySelector('input').checked);
			[st.teamOrder[k], st.teamOrder[j]] = [st.teamOrder[j], st.teamOrder[k]];
			[checked[k], checked[j]] = [checked[j], checked[k]];
			const list = mainEl.querySelector('.team');
			const a = rows[k],
				b = rows[j];
			if (act === 'up') list.insertBefore(a, b);
			else list.insertBefore(b, a);
			[...list.querySelectorAll('.li')].forEach((r, i) => {
				r.querySelector('[data-act=up]').dataset.k = i;
				r.querySelector('[data-act=down]').dataset.k = i;
				r.querySelector('[data-act=up]').disabled = i === 0;
				r.querySelector('[data-act=down]').disabled = i === NB_CHARS - 1;
			});
			return;
		}
		const fns = { saveMisc, teleport, saveStats, psySet, psyDel, djSet, djDel, itSet, itDel };
		if (fns[act]) safe(fns[act]);
	}

	function safe(fn) {
		try {
			const ctx = detect();
			if (!ctx.ok || !ctx.loaded) return refresh();
			st.ctx = ctx;
			fn();
		} catch (err) {
			console.error('[GSE]', err);
			setStatus('Erreur : ' + err.message, 'err');
		}
	}

	// API console : GSE.open(), GSE.read(adr,n), GSE.ctx()
	window.GSE = {
		open: () => !st.open && toggle(),
		close: () => st.open && toggle(),
		ctx: detect,
		read: (a, n = 16) => Array.from(M.bytes(a, n), (b) => b.toString(16).padStart(2, '0')).join(' '),
		mem: M,
		offsets: C
	};

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
	else build();
})();
