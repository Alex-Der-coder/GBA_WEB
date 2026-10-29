/*!
 * PKE Web — éditeur "live" Pokémon Rubis / Saphir / Émeraude / Rouge Feu / Vert Feuille pour gbajs / gbajs2
 * Même principe que GSE Web : lecture/écriture directe de la RAM de l'émulateur via gba.mmu.
 * Les noms (Pokémon, attaques, objets, talents) et les données (stats de base, PP, n° Pokédex)
 * sont lus dans la ROM chargée → fonctionne en FR, EN, etc. sans fichier de données.
 *
 * Installation : charger APRÈS la création de `gba` (indépendant de GSE).
 *   <script src="js/pke/pke-web.js"></script>
 * Ouverture : bouton "PKE" (visible seulement avec une ROM Pokémon GBA compatible) ou touche F3.
 */
(function () {
	'use strict';

	/* ------------------------------------------------------------------ *
	 *  Carte mémoire (décompilations pokeruby / pokeemerald)              *
	 * ------------------------------------------------------------------ */
	const EW = 0x02000000, EW_END = 0x02040000, IW = 0x03000000, IW_END = 0x03008000;
	const SHEDINJA = 303, UNOWN = 201;

	const GAMES = { AXV: { v: 'rs', label: 'Rubis' }, AXP: { v: 'rs', label: 'Saphir' }, BPE: { v: 'e', label: 'Émeraude' },
		BPR: { v: 'frlg', label: 'Rouge Feu' }, BPG: { v: 'frlg', label: 'Vert Feuille' } };
	const TITLES = { 'POKEMON RUBY': 'AXV', 'POKEMON SAPP': 'AXP', 'POKEMON EMER': 'BPE', 'POKEMON FIRE': 'BPR', 'POKEMON LEAF': 'BPG' };
	const pk = (k, n, off, size, pocket, pc) => ({ k, n, off, size, pocket, pc: !!pc });
	const LAYOUT = {
		// Rubis/Saphir : SaveBlocks à adresse fixe, rien n'est chiffré (équipe : 0x03004370 en FR, 0x03004360 en US)
		rs: {
			party: [0x03004370, 0x03004360], sb2: [0x02024ea4], sb1Delta: 0x890, enc: false, seen1: 0x938, seen2: 0x3a8c,
			pockets: [pk('items', 'Objets', 0x560, 20, 1), pk('balls', 'Balls', 0x600, 16, 2), pk('tm', 'CT/CS', 0x640, 64, 3),
				pk('berries', 'Baies', 0x740, 46, 4), pk('key', 'Obj. rares', 0x5b0, 20, 5), pk('pc', 'PC', 0x498, 50, 0, true)]
		},
		// Émeraude : SaveBlocks déplacés aléatoirement (pointeurs en IWRAM), argent/quantités XOR clé
		e: {
			party: [0x020244ec], sbPtr: [0x03005d8c], enc: true, seen1: 0x988, seen2: 0x3b24,
			pockets: [pk('items', 'Objets', 0x560, 30, 1), pk('balls', 'Balls', 0x650, 16, 2), pk('tm', 'CT/CS', 0x690, 64, 3),
				pk('berries', 'Baies', 0x790, 46, 4), pk('key', 'Obj. rares', 0x5d8, 30, 5), pk('pc', 'PC', 0x498, 50, 0, true)]
		},
		// Rouge Feu/Vert Feuille : même moteur qu'Émeraude, offsets et numéros de poche différents
		// (pointeurs SaveBlock : 0x03004F58/5C en version FR, 0x03005008/0C en US)
		frlg: {
			party: [0x02024284], sbPtr: [0x03004f58, 0x03005008], enc: true, keyOff: 0xf20, money: 0x290, coins: 0x294,
			seen1: 0x5f8, seen2: 0x3a18, pocketNames: ['?', 'Objets', 'Obj. rares', 'Balls', 'CT/CS', 'Baies'],
			pockets: [pk('items', 'Objets', 0x310, 42, 1), pk('balls', 'Balls', 0x430, 13, 3), pk('tm', 'CT/CS', 0x464, 58, 4),
				pk('berries', 'Baies', 0x54c, 43, 5), pk('key', 'Obj. rares', 0x3b8, 30, 2), pk('pc', 'PC', 0x298, 30, 0, true)]
		}
	};
	const S2 = { gender: 0x08, tid: 0x0a, hours: 0x0e, minutes: 0x10, seconds: 0x11, owned: 0x28, seen: 0x5c, key: 0xac };
	const S1 = { x: 0x00, y: 0x02, group: 0x04, map: 0x05, money: 0x490, coins: 0x494 };
	const STATS = ['PV', 'Att', 'Déf', 'Vit', 'Att.Spé', 'Déf.Spé'];
	const NATURES = ['Hardi', 'Solo', 'Brave', 'Rigide', 'Mauvais', 'Assuré', 'Docile', 'Relax', 'Malin', 'Lâche', 'Timide', 'Pressé', 'Sérieux',
		'Jovial', 'Naïf', 'Modeste', 'Doux', 'Discret', 'Pudique', 'Foufou', 'Calme', 'Gentil', 'Malpoli', 'Prudent', 'Bizarre'];
	const STATUS = [[0, 'Aucun'], [3, 'Sommeil'], [8, 'Poison'], [16, 'Brûlure'], [32, 'Gel'], [64, 'Paralysie'], [128, 'Poison grave']];
	const POCKET_NAMES = ['?', 'Objets', 'Balls', 'CT/CS', 'Baies', 'Obj. rares'];
	const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
		'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

	/* ------------------------------ Table de caractères Gen 3 ------------------------------ */
	const CH = new Array(256).fill(null);
	const ENC = new Map();
	(function () {
		const map = {
			0x00: ' ', 0x01: 'À', 0x02: 'Á', 0x03: 'Â', 0x04: 'Ç', 0x05: 'È', 0x06: 'É', 0x07: 'Ê', 0x08: 'Ë', 0x09: 'Ì', 0x0b: 'Î', 0x0c: 'Ï',
			0x0d: 'Ò', 0x0e: 'Ó', 0x0f: 'Ô', 0x10: 'Œ', 0x11: 'Ù', 0x12: 'Ú', 0x13: 'Û', 0x14: 'Ñ', 0x15: 'ß', 0x16: 'à', 0x17: 'á', 0x19: 'ç',
			0x1a: 'è', 0x1b: 'é', 0x1c: 'ê', 0x1d: 'ë', 0x1e: 'ì', 0x20: 'î', 0x21: 'ï', 0x22: 'ò', 0x23: 'ó', 0x24: 'ô', 0x25: 'œ', 0x26: 'ù',
			0x27: 'ú', 0x28: 'û', 0x29: 'ñ', 0x2a: 'º', 0x2b: 'ª', 0x2d: '&', 0x2e: '+', 0x35: '=', 0x36: ';', 0x51: '¿', 0x52: '¡', 0x5a: 'Í',
			0x5b: '%', 0x5c: '(', 0x5d: ')', 0x68: 'â', 0x6f: 'í', 0x84: 'ᵉ', 0x85: '<', 0x86: '>', 0xab: '!', 0xac: '?', 0xad: '.', 0xae: '-',
			0xaf: '·', 0xb0: '…', 0xb1: '“', 0xb2: '”', 0xb3: '‘', 0xb4: '’', 0xb5: '♂', 0xb6: '♀', 0xb7: '$', 0xb8: ',', 0xb9: '×', 0xba: '/',
			0xf0: ':', 0xf1: 'Ä', 0xf2: 'Ö', 0xf3: 'Ü', 0xf4: 'ä', 0xf5: 'ö', 0xf6: 'ü'
		};
		for (const k in map) CH[+k] = map[k];
		for (let i = 0; i < 10; i++) CH[0xa1 + i] = String(i);
		for (let i = 0; i < 26; i++) {
			CH[0xbb + i] = String.fromCharCode(65 + i);
			CH[0xd5 + i] = String.fromCharCode(97 + i);
		}
		const glyph = { 0x34: 'Nv', 0x53: 'PK', 0x54: 'MN', 0x55: 'PO', 0x56: 'Ké', 0x57: 'BL', 0x58: 'OC', 0x59: 'K' };
		for (const k in glyph) CH[+k] = glyph[k];
		for (let i = 0; i < 256; i++) if (CH[i] !== null && CH[i].length === 1 && !ENC.has(CH[i])) ENC.set(CH[i], i);
		ENC.set("'", 0xb4);
		ENC.set('"', 0xb1);
	})();
	function decodeStr(b) {
		let s = '';
		for (let i = 0; i < b.length; i++) {
			const c = b[i];
			if (c === 0xff) break;
			s += CH[c] === null ? '?' : CH[c];
		}
		return s;
	}
	function encodeStr(s, size, maxChars = size) {
		const out = new Uint8Array(size).fill(0xff);
		Array.from(s)
			.slice(0, maxChars)
			.forEach((ch, i) => {
				out[i] = ENC.has(ch) ? ENC.get(ch) : ENC.has(ch.toUpperCase()) ? ENC.get(ch.toUpperCase()) : 0xac;
			});
		return out;
	}
	// chaîne valide : ≥1 caractère connu puis 0xFF dans les `max` octets
	function validStr(b, i, max) {
		for (let k = 0; k < max; k++) {
			const c = b[i + k];
			if (c === 0xff) return k > 0;
			if (c === undefined || CH[c] === null) return false;
		}
		return false;
	}

	/* ------------------------------ Accès RAM ------------------------------ */
	function getGBA() {
		try {
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
		s16: (a) => (M.mmu.loadU16(a) << 16) >> 16,
		u32: (a) => M.mmu.load32(a) >>> 0,
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

	/* ------------------------------ Analyse de la ROM ------------------------------ */
	function romBytes(g) {
		const isAB = (x) => Object.prototype.toString.call(x) === '[object ArrayBuffer]';
		const m = g.mmu.cart && g.mmu.cart.memory;
		if (isAB(m)) return new Uint8Array(m);
		if (m && isAB(m.buffer) && typeof m.byteLength === 'number') return new Uint8Array(m.buffer, m.byteOffset || 0, m.byteLength);
		const r = g.mmu.memory && g.mmu.memory[8];
		if (r && isAB(r.buffer)) return new Uint8Array(r.buffer);
		return null;
	}
	function strTable(rom, base, stride, n) {
		const out = [];
		for (let k = 0; k < n; k++) {
			const a = base + k * stride;
			if (!validStr(rom, a, stride)) break;
			out.push(decodeStr(rom.subarray(a, a + stride)));
		}
		return out;
	}
	// Noms d'espèces : 11 octets, entrée 0 = "??????????"
	function findSpeciesNames(rom) {
		for (let i = 0, L = rom.length - 11 * 412; i < L; i++) {
			if (rom[i] !== 0xac || rom[i + 10] !== 0xff) continue;
			let ok = true;
			for (let k = 1; k < 10; k++) if (rom[i + k] !== 0xac) { ok = false; break; }
			if (!ok) continue;
			const t = strTable(rom, i, 11, 412);
			if (t.length >= 400) return t;
		}
		return [];
	}
	// Noms d'attaques : 13 octets, entrée 0 = "-"
	function findMoveNames(rom) {
		for (let i = 0, L = rom.length - 13 * 355; i < L; i++) {
			if (rom[i] !== 0xae || rom[i + 1] !== 0xff) continue;
			// entrée 0 = "-" (US) ou "--" (FR) : on remonte au début des tirets
			let b = i;
			while (b > 0 && rom[b - 1] === 0xae && i - b < 11) b--;
			const t = strTable(rom, b, 13, 355);
			if (t.length >= 355) return t;
		}
		return [];
	}
	// Noms de talents : 13 octets, entrée 0 = "-------"
	function findAbilityNames(rom) {
		for (let i = 0, L = rom.length - 13 * 78; i < L; i++) {
			if (rom[i] !== 0xae || rom[i + 7] !== 0xff) continue;
			let ok = true;
			for (let k = 1; k < 7; k++) if (rom[i + k] !== 0xae) { ok = false; break; }
			if (!ok) continue;
			const t = strTable(rom, i, 13, 78);
			if (t.length >= 78) return t;
		}
		return [];
	}
	// gItems : 44 octets/entrée, itemId (u16) à +14 = index, poche à +26
	function findItems(rom) {
		// Repérage par la structure (itemId = index, poche 0..5), pas par le texte :
		// un nom avec un caractère spécial inconnu ne doit pas faire échouer la table.
		const u16 = (i) => rom[i] | (rom[i + 1] << 8);
		const hasEnd = (a) => {
			if (rom[a] === 0x00 || rom[a] === 0xff) return false; // nom vide / zone vierge
			for (let k = 0; k < 14; k++) if (rom[a + k] === 0xff) return k > 0;
			return true; // nom de 14 caractères sans terminateur
		};
		for (let i = 0, L = rom.length - 44 * 380; i < L; i += 4) {
			if (u16(i + 14) !== 0 || u16(i + 58) !== 1 || u16(i + 102) !== 2 || u16(i + 146) !== 3 || u16(i + 190) !== 4) continue;
			if (rom[i + 70] > 5 || rom[i + 114] > 5 || !hasEnd(i + 44) || !hasEnd(i + 88)) continue;
			const out = [];
			for (let k = 0; k < 400; k++) {
				const a = i + k * 44;
				const id = u16(a + 14);
				// les objets inutilisés ("????????") ont itemId = 0 au lieu de leur index
				if ((id !== k && id !== 0) || rom[a + 26] > 5 || !hasEnd(a)) break;
				out.push({ id: k, name: decodeStr(rom.subarray(a, a + 14)).trim(), pocket: rom[a + 26] });
			}
			if (out.length > 300) return out;
		}
		return [];
	}
	// gBaseStats : 28 octets/entrée, repérée par Bulbizarre (45/49/49/45/65/65, Plante/Poison, 45, 64)
	function findBaseStats(rom) {
		const P = [45, 49, 49, 45, 65, 65, 12, 3, 45, 64];
		for (let i = 28, L = rom.length - 28 * 412; i < L; i++) {
			if (rom[i] !== 45) continue;
			let ok = true;
			for (let k = 1; k < P.length; k++) if (rom[i + k] !== P[k]) { ok = false; break; }
			if (!ok) continue;
			for (let k = 1; k <= 28; k++) if (rom[i - k] !== 0) { ok = false; break; }
			if (ok) return i - 28;
		}
		return -1;
	}
	// gBattleMoves : 12 octets/entrée, Écras'Face (40/Normal/100/35 PP) puis Poing Karaté (50/Combat/100/25 PP)
	function findMovesData(rom) {
		for (let i = 0, L = rom.length - 12 * 355; i < L; i++) {
			const a = i + 12, b = i + 24;
			if (rom[a + 1] !== 40 || rom[a + 2] !== 0 || rom[a + 3] !== 100 || rom[a + 4] !== 35) continue;
			if (rom[b + 1] !== 50 || rom[b + 2] !== 1 || rom[b + 3] !== 100 || rom[b + 4] !== 25) continue;
			return i;
		}
		return -1;
	}
	// gSpeciesToNationalPokedexNum : u16[411], 1..251 puis Arcko (espèce 277) → 252
	function findNatDex(rom) {
		const v = (i, k) => rom[i + k * 2] | (rom[i + k * 2 + 1] << 8);
		for (let i = 0, L = rom.length - 822; i < L; i += 2) {
			if (rom[i] !== 1 || rom[i + 1] !== 0 || rom[i + 2] !== 2 || rom[i + 3] !== 0) continue;
			let ok = true;
			for (let k = 2; k < 251; k++) if (v(i, k) !== k + 1) { ok = false; break; }
			if (!ok || v(i, 276) !== 252) continue;
			const t = [0];
			for (let k = 0; k < 411; k++) t.push(v(i, k));
			return t;
		}
		return null;
	}

	let RD = null;
	function romKey() {
		const g = getGBA();
		const cart = g && g.mmu && g.mmu.cart;
		return cart ? `${cart.code || cart.title}:${cart.memory && cart.memory.byteLength}` : null;
	}
	function rd() {
		const key = romKey();
		if (RD && RD.key === key) return RD;
		const g = getGBA();
		const rom = g ? romBytes(g) : null;
		RD = { key, rom, species: [], moves: [], abilities: [], items: [], base: -1, mdata: -1, natdex: null, natFound: false };
		if (rom) {
			const t0 = performance.now();
			try {
				RD.species = findSpeciesNames(rom);
				RD.moves = findMoveNames(rom);
				RD.abilities = findAbilityNames(rom);
				RD.items = findItems(rom);
				RD.base = findBaseStats(rom);
				RD.mdata = findMovesData(rom);
				RD.natdex = findNatDex(rom);
			} catch (e) {
				console.warn('[PKE] analyse ROM', e);
			}
			RD.ms = Math.round(performance.now() - t0);
		}
		RD.natFound = !!RD.natdex;
		if (!RD.natdex) {
			RD.natdex = [0];
			for (let s = 1; s < 412; s++) RD.natdex.push(s <= 251 ? s : 0);
		}
		RD.fromNat = [];
		RD.natdex.forEach((n, s) => {
			if (n && n <= 386 && !RD.fromNat[n]) RD.fromNat[n] = s;
		});
		RD.opts = {};
		return RD;
	}
	const romReady = () => RD && RD.key === romKey();

	const spName = (s) => rd().species[s] || `#${s}`;
	const moveName = (m) => (m ? rd().moves[m] || `Attaque #${m}` : '—');
	const itemName = (i) => (i ? (rd().items[i] && rd().items[i].name) || `Objet #${i}` : '—');
	const abName = (a) => rd().abilities[a] || `Talent #${a}`;
	function base(s) {
		const r = rd();
		if (r.base < 0 || !s || s > 411) return null;
		const o = r.base + s * 28, b = r.rom;
		return { st: [b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5]], gender: b[o + 16], growth: b[o + 19], ab: [b[o + 22], b[o + 23]] };
	}
	const basePP = (m) => (rd().mdata < 0 || !m ? 0 : rd().rom[rd().mdata + m * 12 + 4]);
	const maxPP = (m, up) => Math.floor((basePP(m) * (5 + up)) / 5);

	/* ------------------------------ Formules ------------------------------ */
	function expAt(g, n) {
		if (n <= 1) return 0;
		const n3 = n * n * n;
		switch (g) {
			case 1: // Erratique
				if (n <= 50) return Math.floor((n3 * (100 - n)) / 50);
				if (n <= 68) return Math.floor((n3 * (150 - n)) / 100);
				if (n <= 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
				return Math.floor((n3 * (160 - n)) / 100);
			case 2: // Fluctuante
				if (n <= 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
				if (n <= 36) return Math.floor((n3 * (n + 14)) / 50);
				return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
			case 3: // Parabolique
				return Math.floor((6 * n3) / 5) - 15 * n * n + 100 * n - 140;
			case 4: // Rapide
				return Math.floor((4 * n3) / 5);
			case 5: // Lente
				return Math.floor((5 * n3) / 4);
			default: // Moyenne
				return n3;
		}
	}
	function levelFor(g, exp) {
		let L = 1;
		while (L < 100 && exp >= expAt(g, L + 1)) L++;
		return L;
	}
	function calcStats(b, iv, ev, L, nature, species) {
		const out = [species === SHEDINJA ? 1 : Math.floor(((2 * b[0] + iv[0] + Math.floor(ev[0] / 4)) * L) / 100) + L + 10];
		const up = Math.floor(nature / 5) + 1, dn = (nature % 5) + 1;
		for (let k = 1; k < 6; k++) {
			let v = Math.floor(((2 * b[k] + iv[k] + Math.floor(ev[k] / 4)) * L) / 100) + 5;
			if (up !== dn && k === up) v = Math.floor((v * 110) / 100);
			if (up !== dn && k === dn) v = Math.floor((v * 90) / 100);
			out.push(v);
		}
		return out;
	}
	const isShiny = (pid, otid) => ((otid & 0xffff) ^ (otid >>> 16) ^ (pid & 0xffff) ^ (pid >>> 16)) < 8;
	function genderOf(pid, gr) {
		if (gr === 255) return '';
		if (gr === 254) return '♀';
		if (gr === 0) return '♂';
		return (pid & 0xff) < gr ? '♀' : '♂';
	}
	// Nouvelle personnalité : nature + chromatique voulues, même sexe
	function newPid(oldPid, otid, nature, shiny, gr) {
		const tid = otid & 0xffff, sid = otid >>> 16;
		const female = gr > 0 && gr < 254 ? (oldPid & 0xff) < gr : null;
		for (let t = 0; t < 1e6; t++) {
			const lo = (Math.random() * 0x10000) | 0;
			const hi = shiny ? (tid ^ sid ^ lo ^ ((Math.random() * 8) | 0)) & 0xffff : (Math.random() * 0x10000) | 0;
			const pid = ((hi << 16) | lo) >>> 0;
			if (pid % 25 !== nature) continue;
			if (!shiny && isShiny(pid, otid)) continue;
			if (female !== null && (pid & 0xff) < gr !== female) continue;
			return pid;
		}
		return null;
	}

	/* ------------------------------ Structure Pokémon (100 octets) ------------------------------ */
	function parseMon(raw) {
		const dv = new DataView(raw.buffer, raw.byteOffset, 100);
		const pid = dv.getUint32(0, true), otid = dv.getUint32(4, true), key = (pid ^ otid) >>> 0;
		const sec = new Uint8Array(48), sv = new DataView(sec.buffer);
		for (let k = 0; k < 12; k++) sv.setUint32(k * 4, (dv.getUint32(32 + k * 4, true) ^ key) >>> 0, true);
		let sum = 0;
		for (let k = 0; k < 24; k++) sum = (sum + sv.getUint16(k * 2, true)) & 0xffff;
		const o = ORDERS[pid % 24], at = (c) => o.indexOf(c) * 12;
		const G = at('G'), A = at('A'), E = at('E'), X = at('M');
		const ivw = sv.getUint32(X + 4, true);
		const four = (f) => [0, 1, 2, 3].map(f), six = (f) => [0, 1, 2, 3, 4, 5].map(f);
		const nick = decodeStr(raw.subarray(8, 18));
		return {
			ok: sum === dv.getUint16(28, true),
			pid, otid, nick, lang: raw[18], flags: raw[19],
			otName: decodeStr(raw.subarray(20, 27)),
			species: sv.getUint16(G, true), item: sv.getUint16(G + 2, true), exp: sv.getUint32(G + 4, true),
			ppUp: sec[G + 8], friendship: sec[G + 9],
			moves: four((k) => sv.getUint16(A + k * 2, true)), pp: four((k) => sec[A + 8 + k]),
			ev: six((k) => sec[E + k]),
			ivs: six((k) => (ivw >>> (k * 5)) & 31), egg: (ivw >>> 30) & 1, abil: ivw >>> 31,
			origins: sv.getUint16(X + 2, true),
			status: dv.getUint32(80, true), level: raw[84], hp: dv.getUint16(86, true),
			stats: six((k) => dv.getUint16(88 + k * 2, true)),
			_raw: raw, _sec: sec, _pid0: pid, _nick0: nick
		};
	}
	function buildMon(m) {
		const raw = new Uint8Array(m._raw);
		const dv = new DataView(raw.buffer);
		// sous-structures déchiffrées (dans l'ancien ordre) → on garde les champs non édités
		const oo = ORDERS[m._pid0 % 24], ch = {};
		for (const c of 'GAEM') {
			const i = oo.indexOf(c) * 12;
			ch[c] = m._sec.slice(i, i + 12);
		}
		const g = new DataView(ch.G.buffer), a = new DataView(ch.A.buffer), x = new DataView(ch.M.buffer);
		g.setUint16(0, m.species, true);
		g.setUint16(2, m.item, true);
		g.setUint32(4, m.exp >>> 0, true);
		ch.G[8] = m.ppUp;
		ch.G[9] = m.friendship;
		for (let k = 0; k < 4; k++) {
			a.setUint16(k * 2, m.moves[k], true);
			ch.A[8 + k] = m.pp[k];
		}
		for (let k = 0; k < 6; k++) ch.E[k] = m.ev[k];
		x.setUint16(2, m.origins, true);
		let iw = 0;
		for (let k = 0; k < 6; k++) iw |= (m.ivs[k] & 31) << (k * 5);
		iw = (iw | ((m.egg & 1) << 30) | ((m.abil & 1) << 31)) >>> 0;
		x.setUint32(4, iw, true);
		// réassemblage dans l'ordre de la (nouvelle) personnalité
		const no = ORDERS[m.pid % 24], sec = new Uint8Array(48), sv = new DataView(sec.buffer);
		for (let k = 0; k < 4; k++) sec.set(ch[no[k]], k * 12);
		let sum = 0;
		for (let k = 0; k < 24; k++) sum = (sum + sv.getUint16(k * 2, true)) & 0xffff;
		dv.setUint32(0, m.pid, true);
		dv.setUint32(4, m.otid, true);
		if (m.nick !== m._nick0) raw.set(encodeStr(m.nick, 10), 8);
		if (m.species) raw[19] = (raw[19] | 2) & ~1;
		dv.setUint16(28, sum, true);
		const key = (m.pid ^ m.otid) >>> 0;
		for (let k = 0; k < 12; k++) dv.setUint32(32 + k * 4, (sv.getUint32(k * 4, true) ^ key) >>> 0, true);
		dv.setUint32(80, m.status >>> 0, true);
		raw[84] = m.level;
		dv.setUint16(86, m.hp, true);
		for (let k = 0; k < 6; k++) dv.setUint16(88 + k * 2, m.stats[k], true);
		return raw;
	}

	/* ------------------------------ Détection ------------------------------ */
	function quickMon(a) {
		const f = M.u8(a + 19);
		if ((f & 3) !== 2) return null; // hasSpecies sans badEgg
		const lvl = M.u8(a + 84);
		if (lvl < 1 || lvl > 100) return null;
		const maxhp = M.u16(a + 88);
		if (!maxhp || M.u16(a + 86) > maxhp) return null;
		const m = parseMon(M.bytes(a, 100));
		return m.ok && m.species > 0 && m.species < 412 ? m : null;
	}
	function partyLen(a) {
		let n = 0;
		while (n < 6 && quickMon(a + n * 100)) n++;
		return n;
	}
	function findParty(L) {
		for (const a of L.party) {
			const n = partyLen(a);
			if (n) return { addr: a, n, scanned: false };
		}
		for (const [lo, hi] of [[IW, IW_END], [EW, EW_END]])
			for (let a = lo; a + 600 <= hi; a += 4)
				if (quickMon(a)) return { addr: a, n: partyLen(a), scanned: true };
		return null;
	}
	function validSB2(a, otids) {
		if (a < EW || a + 0x100 > EW_END || a & 3) return false;
		if (M.u8(a + S2.gender) > 1 || M.u8(a + S2.minutes) > 59 || M.u8(a + S2.seconds) > 59) return false;
		const tid = (M.u8(a + 0xa) | (M.u8(a + 0xb) << 8) | (M.u8(a + 0xc) << 16) | (M.u8(a + 0xd) << 24)) >>> 0;
		if (otids.length ? !otids.includes(tid) : !tid) return false;
		return validStr(M.bytes(a, 8), 0, 8);
	}
	function findSB(L, otids) {
		const inEW = (v) => v >= EW && v < EW_END;
		if (L.sbPtr) {
			const cands = L.sbPtr.slice();
			for (let p = IW; p < IW_END - 8; p += 4) cands.push(p);
			for (const p of cands) {
				const s1 = M.u32(p), s2 = M.u32(p + 4);
				if (inEW(s1) && validSB2(s2, otids)) return { sb1: s1, sb2: s2, ptr: p };
			}
			return null;
		}
		for (const a of L.sb2) if (validSB2(a, otids)) return { sb1: a + L.sb1Delta, sb2: a };
		for (let a = EW; a < EW_END - 0x100; a += 4) if (validSB2(a, otids)) return { sb1: a + L.sb1Delta, sb2: a };
		return null;
	}
	function gameOf(cart) {
		const code = String(cart.code || '').trim();
		if (GAMES[code.slice(0, 3)]) return code.slice(0, 3);
		const t = String(cart.title || '').trim();
		for (const k in TITLES) if (t.startsWith(k)) return TITLES[k];
		return null;
	}
	function detect() {
		const g = getGBA();
		if (!g) return { ok: false, err: 'Émulateur introuvable (variable gba).' };
		const cart = g.mmu && g.mmu.cart;
		if (!cart || !cart.title) return { ok: false, err: 'Aucune ROM chargée.' };
		const pre = gameOf(cart);
		if (!pre) return { ok: false, err: `ROM « ${String(cart.title).trim()} » : pas un Pokémon Rubis/Saphir/Émeraude/Rouge Feu/Vert Feuille.` };
		const G = GAMES[pre], L = LAYOUT[G.v];
		const ctx = { ok: true, code: String(cart.code || pre), label: G.label, v: G.v, L };
		ctx.party = findParty(L);
		const otids = [];
		if (ctx.party)
			for (let i = 0; i < ctx.party.n; i++) {
				const o = M.u32(ctx.party.addr + i * 100 + 4);
				if (!otids.includes(o)) otids.push(o);
			}
		ctx.sb = findSB(L, otids);
		ctx.key = ctx.sb && L.enc ? M.u32(ctx.sb.sb2 + (L.keyOff || S2.key)) : 0;
		ctx.loaded = !!(ctx.party || ctx.sb);
		return ctx;
	}

	/* ------------------------------ Sac / Pokédex ------------------------------ */
	function readPocket(c, p) {
		const a = c.sb.sb1 + p.off, k = p.pc || !c.L.enc ? 0 : c.key & 0xffff, out = [];
		for (let s = 0; s < p.size; s++) out.push({ id: M.u16(a + s * 4), qty: (M.u16(a + s * 4 + 2) ^ k) & 0xffff });
		return out;
	}
	function writePocket(c, p, list) {
		const a = c.sb.sb1 + p.off, k = p.pc || !c.L.enc ? 0 : c.key & 0xffff;
		const items = list.filter((x) => x.id).slice(0, p.size);
		while (items.length < p.size) items.push({ id: 0, qty: 0 });
		items.forEach((x, s) => {
			M.w16(a + s * 4, x.id);
			M.w16(a + s * 4 + 2, (x.id ? x.qty : 0) ^ k);
		});
	}
	function dexAddrs(c) {
		return { owned: c.sb.sb2 + S2.owned, seen: [c.sb.sb2 + S2.seen, c.sb.sb1 + c.L.seen1, c.sb.sb1 + c.L.seen2] };
	}
	function dexGet(c, n) {
		const i = n - 1, by = i >> 3, bit = 1 << (i & 7), d = dexAddrs(c);
		return { seen: !!(M.u8(d.seen[0] + by) & bit), owned: !!(M.u8(d.owned + by) & bit) };
	}
	function dexSet(c, n, seen, owned) {
		if (owned) seen = true;
		const i = n - 1, by = i >> 3, bit = 1 << (i & 7), d = dexAddrs(c);
		const put = (a, on) => M.w8(a + by, on ? M.u8(a + by) | bit : M.u8(a + by) & ~bit);
		d.seen.forEach((a) => put(a, seen));
		put(d.owned, owned);
	}

	/* ------------------------------ UI ------------------------------ */
	const CSS = `
#pke-fab{position:fixed;right:16px;bottom:16px;z-index:99998;font:700 13px/1 ui-monospace,Menlo,Consolas,monospace;
 letter-spacing:.12em;color:#fff;background:linear-gradient(160deg,#ff7a7a,#c62f2f);border:0;border-radius:999px;
 padding:12px 16px;box-shadow:0 6px 20px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.4);cursor:pointer}
#pke-fab:active{transform:translateY(1px)}
#pke{--bg:#0f1114;--bg2:#171a1f;--bg3:#20242b;--line:#2c313a;--tx:#e6e1d6;--mut:#8d8a83;--acc:#ff6b6b;--acc2:#a83a3a;--ok:#7bd88f;--err:#ffb347;
 position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:99999;background:var(--bg);color:var(--tx);
 font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;text-align:left;display:flex;flex-direction:column;border-left:1px solid var(--line);
 box-shadow:-12px 0 40px rgba(0,0,0,.5);transform:translateX(105%);transition:transform .22s ease}
#pke.open{transform:none}
#pke *{box-sizing:border-box}
#pke header{padding:12px 14px 10px;border-bottom:1px solid var(--line);background:var(--bg2)}
#pke .top{display:flex;align-items:center;gap:8px}
#pke .brand{font-weight:700;color:var(--acc);letter-spacing:.14em}
#pke .badge{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
#pke .sp{flex:1}
#pke button{font:inherit;color:var(--tx);background:var(--bg3);border:1px solid var(--line);border-radius:6px;padding:6px 10px;cursor:pointer}
#pke button:hover{border-color:var(--acc2)}
#pke button:disabled{opacity:.4;cursor:default}
#pke button.pri{background:var(--acc);color:#1a0606;border-color:var(--acc);font-weight:700}
#pke button.danger{color:var(--err)}
#pke button.ic{padding:4px 8px}
#pke .status{margin-top:6px;font-size:12px;color:var(--mut);min-height:1.45em}
#pke .status.err{color:var(--err)} #pke .status.ok{color:var(--ok)}
#pke .sub{display:flex;gap:6px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid var(--line);scrollbar-width:none}
#pke .sub button{white-space:nowrap;padding:5px 10px;border-radius:999px}
#pke .sub button.on{background:var(--acc);color:#1a0606;border-color:var(--acc);font-weight:700}
#pke nav{display:flex;border-bottom:1px solid var(--line)}
#pke nav button{flex:1;border:0;border-radius:0;background:none;padding:10px 0;color:var(--mut);border-bottom:2px solid transparent}
#pke nav button.on{color:var(--acc);border-bottom-color:var(--acc)}
#pke main{flex:1;overflow:auto;padding:14px}
#pke h3{margin:16px 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);font-weight:600;display:flex;gap:8px;align-items:center}
#pke h3:first-child{margin-top:0}
#pke label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--mut);min-width:0}
#pke input,#pke select{font:inherit;font-size:14px;color:var(--tx);background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:6px 8px;width:100%;min-width:0}
#pke input:focus,#pke select:focus{outline:none;border-color:var(--acc)}
#pke input[type=checkbox]{width:auto;accent-color:var(--acc)}
#pke .row{display:flex;gap:8px;align-items:end}
#pke .row+.row{margin-top:8px}
#pke .row>*{flex:1}
#pke .six{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#pke .chk{flex-direction:row;align-items:center;gap:6px;color:var(--tx);font-size:13px}
#pke table{width:100%;border-collapse:collapse}
#pke td{font-size:13px;padding:3px 3px;vertical-align:middle}
#pke .list{border:1px solid var(--line);border-radius:8px;overflow:hidden}
#pke .li{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--line)}
#pke .li:last-child{border-bottom:0}
#pke .list.pick .li{cursor:pointer}
#pke .list.pick .li:hover{background:var(--bg2)}
#pke .li.sel{background:var(--bg3);box-shadow:inset 3px 0 0 var(--acc)}
#pke .li .n{color:var(--mut);min-width:30px;font-size:11px}
#pke .li .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pke .m{font-size:11px;color:var(--mut)}
#pke .li.empty .t{color:var(--mut);font-style:italic}
#pke .editor{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg2);display:flex;flex-direction:column;gap:8px}
#pke .actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
#pke .hint{font-size:11px;color:var(--mut);margin:6px 0 0}
#pke .tag{font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid var(--line);color:var(--mut);letter-spacing:0;text-transform:none}
#pke .up{color:var(--ok)} #pke .dn{color:var(--err)}
#pke .stat{background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12px}
#pke .stat b{display:block;font-size:15px}
#pke footer{padding:10px 14px;border-top:1px solid var(--line);background:var(--bg2)}
#pke .blocker{padding:30px 10px;text-align:center;color:var(--mut)}
#pke .dbg{font-size:11px;color:var(--mut);word-break:break-all}
@media (max-width:640px){
 #pke{top:auto;width:100vw;height:82vh;border-left:0;border-top:1px solid var(--line);border-radius:14px 14px 0 0;transform:translateY(105%)}
 #pke.open{transform:none}
}`;

	const h = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || 0));
	const hex = (a) => '0x' + (a >>> 0).toString(16).padStart(8, '0');
	const pad = (n, w) => String(n).padStart(w, '0');
	const blocker = (html) => `<div class="blocker">${html}</div>`;
	const sel = (cond) => (cond ? 'selected' : '');

	const st = {
		open: false, tab: 'party', mi: 0, pocket: 0, bagSel: -1, ctx: null,
		pauseWhileOpen: true, wasRunning: false,
		filter: { item: '', dex: '', dexMode: 'all' }
	};
	try {
		const p = localStorage.getItem('pke.pause');
		if (p !== null) st.pauseWhileOpen = p === '1';
	} catch (e) {}

	let root, fab, mainEl, statusEl, subEl, badgeEl;
	const q = (s) => mainEl.querySelector(s);

	function setStatus(msg, cls) {
		if (!statusEl) return;
		statusEl.textContent = msg || '';
		statusEl.className = 'status' + (cls ? ' ' + cls : '');
	}

	/* ---- listes d'options (mises en cache par ROM) ---- */
	function speciesList() {
		const r = rd();
		if (r.opts.species) return r.opts.species;
		const out = [];
		for (let s = 1; s < 412; s++) {
			if (s >= 252 && s <= 276) continue; // anciens Zarbi inutilisés
			const n = r.natdex[s];
			if (r.natFound ? n > 0 && n <= 386 : true) out.push({ s, n: n || 0, name: spName(s) });
		}
		out.sort((a, b) => (a.n || 999 + a.s) - (b.n || 999 + b.s));
		return (r.opts.species = out);
	}
	function speciesOptions(cur) {
		const list = speciesList();
		const opts = list.map((x) => `<option value="${x.s}" ${sel(x.s === cur)}>${x.n ? '#' + pad(x.n, 3) + ' ' : ''}${h(x.name)}</option>`);
		if (!list.some((x) => x.s === cur)) opts.unshift(`<option value="${cur}" selected>#${cur}</option>`);
		return opts.join('');
	}
	function moveOptions(cur) {
		const r = rd();
		if (!r.opts.moves) {
			const n = r.moves.length ? r.moves.length - 1 : 354;
			const l = [];
			for (let m = 1; m <= n; m++) l.push({ m, name: moveName(m) });
			l.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
			r.opts.moves = l;
		}
		return `<option value="0" ${sel(!cur)}>—</option>` + r.opts.moves.map((x) => `<option value="${x.m}" ${sel(x.m === cur)}>${h(x.name)}</option>`).join('');
	}
	function itemList() {
		const r = rd();
		if (r.opts.items) return r.opts.items;
		let l = r.items.filter((x) => x.id && !/^\?+$/.test(x.name));
		if (!l.length) {
			l = [];
			for (let i = 1; i < 377; i++) l.push({ id: i, name: `Objet #${i}`, pocket: 0 });
		}
		return (r.opts.items = l);
	}
	function itemOptions(cur, pocket, query) {
		const qq = (query || '').toLowerCase();
		const l = itemList().filter((x) => (!pocket || !x.pocket || x.pocket === pocket) && (!qq || x.name.toLowerCase().includes(qq)));
		if (pocket) return l.map((x) => `<option value="${x.id}" ${sel(x.id === cur)}>${h(x.name)}</option>`).join('');
		// objet tenu : regroupé par poche
		let out = `<option value="0" ${sel(!cur)}>— aucun —</option>`;
		for (let p = 1; p <= 5; p++) {
			const g = l.filter((x) => x.pocket === p);
			if (g.length) out += `<optgroup label="${(st.ctx.L.pocketNames || POCKET_NAMES)[p]}">${g.map((x) => `<option value="${x.id}" ${sel(x.id === cur)}>${h(x.name)}</option>`).join('')}</optgroup>`;
		}
		const rest = l.filter((x) => !(x.pocket >= 1 && x.pocket <= 5));
		out += rest.map((x) => `<option value="${x.id}" ${sel(x.id === cur)}>${h(x.name)}</option>`).join('');
		return out;
	}

	function build() {
		const style = document.createElement('style');
		style.textContent = CSS;
		document.head.appendChild(style);

		fab = document.createElement('button');
		fab.id = 'pke-fab';
		fab.textContent = 'PKE';
		fab.title = 'Pokémon Editor (F3)';
		fab.style.display = 'none';
		fab.addEventListener('click', toggle);
		document.body.appendChild(fab);

		root = document.createElement('aside');
		root.id = 'pke';
		root.innerHTML = `
<header>
 <div class="top"><span class="brand">PKE</span><span class="badge" data-k="game">—</span><span class="sp"></span>
  <button class="ic" data-act="refresh" title="Relire la RAM">⟳</button>
  <button class="ic" data-act="close" title="Fermer">✕</button></div>
 <div class="status" data-k="status"></div>
</header>
<div class="sub" data-k="sub"></div>
<nav>
 <button data-tab="trainer">Dresseur</button><button data-tab="party">Équipe</button>
 <button data-tab="bag">Sac</button><button data-tab="dex">Pokédex</button>
</nav>
<main data-k="main"></main>
<footer><label class="chk"><input type="checkbox" data-k="pause"> Pause pendant l'édition</label></footer>`;
		document.body.appendChild(root);
		mainEl = root.querySelector('[data-k=main]');
		statusEl = root.querySelector('[data-k=status]');
		subEl = root.querySelector('[data-k=sub]');
		badgeEl = root.querySelector('[data-k=game]');
		const pauseEl = root.querySelector('[data-k=pause]');
		pauseEl.checked = st.pauseWhileOpen;
		pauseEl.addEventListener('change', () => {
			st.pauseWhileOpen = pauseEl.checked;
			try {
				localStorage.setItem('pke.pause', st.pauseWhileOpen ? '1' : '0');
			} catch (e) {}
			applyPause();
		});
		root.addEventListener('click', onClick);
		root.addEventListener('change', onChange);
		// Empêche le keypad de gbajs de "manger" les touches tapées dans les champs
		root.addEventListener('focusin', (e) => {
			const g = getGBA();
			if (g && g.keypad && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) {
				if (root._eat === undefined) root._eat = g.keypad.eatInput;
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
			if (e.key === 'F3' && fab.style.display !== 'none') {
				e.preventDefault();
				toggle();
			}
		});
		// le bouton n'apparaît qu'avec une ROM Rubis/Saphir/Émeraude
		const poll = () => {
			const g = getGBA();
			const cart = g && g.mmu && g.mmu.cart;
			const on = !!(cart && cart.title && gameOf(cart));
			fab.style.display = on ? '' : 'none';
			if (on) fab.style.bottom = document.getElementById('gse-fab') ? '64px' : '';
			if (!on && st.open) toggle();
		};
		poll();
		setInterval(poll, 1500);
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
		if (!st.open) return;
		if (romReady()) return refresh();
		setStatus('Analyse de la ROM…');
		setTimeout(() => refresh(), 30);
	}

	function refresh(keepMsg) {
		const ctx = detect();
		st.ctx = ctx;
		badgeEl.textContent = ctx.ok ? `${ctx.label} · ${ctx.code}` : '—';
		if (!keepMsg) setStatus('');
		if (!ctx.ok || !ctx.loaded) {
			subEl.innerHTML = '';
			subEl.style.display = 'none';
			mainEl.innerHTML = blocker(
				ctx.ok ? `Pokémon ${h(ctx.label)} détecté.<br>Charge ta sauvegarde (Continuer), puis ⟳.` : h(ctx.err)
			);
			return;
		}
		rd();
		if (!ctx.party || st.mi >= ctx.party.n) st.mi = 0;
		if (!keepMsg && rd().rom && !rd().species.length) setStatus('Noms introuvables dans la ROM (ROM modifiée ?) : affichage par numéro.', 'err');
		else if (!keepMsg && rd().rom && !rd().items.length) setStatus('Table des objets introuvable : envoie le résultat de PKE.diag() (console).', 'err');
		render();
	}

	function renderSub() {
		const c = st.ctx;
		let html = '';
		if (st.tab === 'party' && c.party) {
			for (let i = 0; i < c.party.n; i++) {
				const m = parseMon(M.bytes(c.party.addr + i * 100, 100));
				html += `<button data-mi="${i}" class="${i === st.mi ? 'on' : ''}">${h(monLabel(m))} <small>Nv${m.level}</small></button>`;
			}
			html += `<button data-act="healAll" title="Soigner toute l'équipe">♥ Soigner</button>`;
		} else if (st.tab === 'bag' && c.sb) {
			html = c.L.pockets.map((p, k) => `<button data-pk="${k}" class="${k === st.pocket ? 'on' : ''}">${h(p.n)}</button>`).join('');
		}
		subEl.innerHTML = html;
		subEl.style.display = html ? '' : 'none';
	}
	const monLabel = (m) => (m.egg ? 'Œuf' : m.nick || spName(m.species)) + (isShiny(m.pid, m.otid) ? ' ★' : '');

	function render() {
		root.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
		renderSub();
		mainEl.innerHTML = { trainer: renderTrainer, party: renderParty, bag: renderBag, dex: renderDex }[st.tab]();
		bindAfterRender();
	}

	/* ------------------------------ Onglet Dresseur ------------------------------ */
	function renderTrainer() {
		const c = st.ctx;
		if (!c.sb) return blocker('Données dresseur introuvables.<br>Charge une sauvegarde puis ⟳.');
		const s2 = c.sb.sb2, s1 = c.sb.sb1;
		const name = decodeStr(M.bytes(s2, 8));
		const g = M.u8(s2 + S2.gender);
		const tid = M.u16(s2 + S2.tid), sid = M.u16(s2 + S2.tid + 2);
		const money = (M.u32(s1 + (c.L.money || S1.money)) ^ c.key) >>> 0;
		const coins = (M.u16(s1 + (c.L.coins || S1.coins)) ^ c.key) & 0xffff;
		const r = rd();
		return `
<h3>Dresseur</h3>
<div class="row">
 <label>Nom<input maxlength="7" data-f="tname" value="${h(name)}"></label>
 <label style="max-width:120px">Sexe<select data-f="tgender"><option value="0" ${sel(g === 0)}>Garçon</option><option value="1" ${sel(g === 1)}>Fille</option></select></label>
</div>
<p class="hint">ID ${pad(tid, 5)} · ID secret ${pad(sid, 5)} <span class="tag">lecture seule : ils signent tes Pokémon</span></p>
<h3>Partie</h3>
<div class="row">
 <label>Argent<input type="number" min="0" max="999999" data-f="money" value="${money}"></label>
 <label>Jetons<input type="number" min="0" max="9999" data-f="coins" value="${coins}"></label>
</div>
<div class="row">
 <label>Heures<input type="number" min="0" max="999" data-f="hours" value="${M.u16(s2 + S2.hours)}"></label>
 <label>Minutes<input type="number" min="0" max="59" data-f="mins" value="${M.u8(s2 + S2.minutes)}"></label>
</div>
<div class="actions" style="margin-top:12px"><button class="pri" data-act="saveTrainer">Appliquer</button></div>
<h3>Position</h3>
<div class="hint">Carte ${M.u8(s1 + S1.group)}.${M.u8(s1 + S1.map)} · x=${M.s16(s1 + S1.x)} y=${M.s16(s1 + S1.y)}</div>
<h3>Détection</h3>
<div class="dbg">Équipe ${c.party ? hex(c.party.addr) + (c.party.scanned ? ' (scan)' : '') : '—'} · SB1 ${hex(s1)} · SB2 ${hex(s2)}${c.L.enc ? ' · clé ' + hex(c.key) : ''}<br>
ROM : ${r.species.length} espèces · ${r.moves.length} attaques · ${r.items.length} objets${r.items[4] ? ' (n°4 = ' + h(r.items[4].name) + ')' : ''} · ${r.abilities.length} talents · stats ${r.base >= 0 ? 'ok' : '—'} · PP ${r.mdata >= 0 ? 'ok' : '—'} · Pokédex ${r.natFound ? 'ok' : '—'}${r.ms !== undefined ? ` (${r.ms} ms)` : ''}</div>`;
	}
	function saveTrainer() {
		const c = st.ctx, s2 = c.sb.sb2, s1 = c.sb.sb1, v = (k) => q(`[data-f=${k}]`).value;
		const name = v('tname').trim();
		if (!name) return setStatus('Le nom ne peut pas être vide.', 'err');
		M.wbytes(s2, encodeStr(name, 8, 7));
		M.w8(s2 + S2.gender, +v('tgender') ? 1 : 0);
		M.w32(s1 + (c.L.money || S1.money), (clamp(v('money'), 0, 999999) ^ c.key) >>> 0);
		M.w16(s1 + (c.L.coins || S1.coins), (clamp(v('coins'), 0, 9999) ^ c.key) & 0xffff);
		M.w16(s2 + S2.hours, clamp(v('hours'), 0, 999));
		M.w8(s2 + S2.minutes, clamp(v('mins'), 0, 59));
		done('Dresseur mis à jour.');
	}

	/* ------------------------------ Onglet Équipe ------------------------------ */
	function renderParty() {
		const c = st.ctx;
		if (!c.party) return blocker("Aucune équipe trouvée en RAM.<br>Obtiens ton premier Pokémon puis ⟳.");
		const m = parseMon(M.bytes(c.party.addr + st.mi * 100, 100));
		if (!m.ok) return blocker('Données corrompues (checksum invalide).');
		const b = base(m.species);
		const nat = m.pid % 25, up = Math.floor(nat / 5) + 1, dn = (nat % 5) + 1;
		const shiny = isShiny(m.pid, m.otid);
		const gender = b ? genderOf(m.pid, b.gender) : '';
		const ball = (m.origins >> 11) & 15;
		const stCur = m.status & 7 ? 3 : m.status & 128 ? 128 : m.status & 8 ? 8 : m.status & 16 ? 16 : m.status & 32 ? 32 : m.status & 64 ? 64 : 0;
		const evTot = m.ev.reduce((a, x) => a + x, 0);
		const abOpts = b
			? [0, 1].filter((k) => k === 0 || b.ab[1]).map((k) => `<option value="${k}" ${sel(m.abil === k)}>${h(abName(b.ab[k]))}</option>`).join('')
			: `<option value="0" ${sel(!m.abil)}>Talent 1</option><option value="1" ${sel(m.abil)}>Talent 2</option>`;
		let balls = '';
		for (let i = 1; i <= 12; i++) balls += `<option value="${i}" ${sel(i === ball)}>${h(itemName(i))}</option>`;
		const moves = [0, 1, 2, 3]
			.map((k) => {
				const mv = m.moves[k], u = (m.ppUp >> (k * 2)) & 3, mx = maxPP(mv, u);
				return `<tr><td><select data-mv="${k}">${moveOptions(mv)}</select></td>
<td style="width:62px"><input type="number" min="0" max="64" data-pp="${k}" value="${m.pp[k]}" title="PP"></td>
<td style="width:62px"><select data-ppup="${k}" title="PP Plus">${[0, 1, 2, 3].map((x) => `<option value="${x}" ${sel(x === u)}>+${x}</option>`).join('')}</select></td>
<td class="m" style="width:32px">${mx ? '/' + mx : ''}</td></tr>`;
			})
			.join('');
		const six = (attr, vals, max) =>
			vals.map((x, k) => `<label>${STATS[k]}<input type="number" min="0" max="${max}" data-${attr}="${k}" value="${x}"></label>`).join('');
		return `
${m.egg ? '<p class="hint"><span class="tag">Œuf</span> le bonheur sert de compteur de cycles avant éclosion.</p>' : ''}
<div class="row">
 <label>Espèce<select data-f="species">${speciesOptions(m.species)}</select></label>
 <label style="max-width:76px">Niveau<input type="number" min="1" max="100" data-f="level" value="${m.level}"></label>
</div>
<div class="row">
 <label>Surnom<input maxlength="10" data-f="nick" value="${h(m.nick)}"></label>
 <label>Nature<select data-f="nature">${NATURES.map((n, k) => `<option value="${k}" ${sel(k === nat)}>${n}</option>`).join('')}</select></label>
</div>
<div class="row">
 <label>Objet tenu<select data-f="item">${itemOptions(m.item, 0)}</select></label>
 <label style="max-width:84px">Bonheur<input type="number" min="0" max="255" data-f="friend" value="${m.friendship}"></label>
</div>
<div class="row">
 <label>Talent<select data-f="abil">${abOpts}</select></label>
 <label>Ball<select data-f="ball">${balls}</select></label>
</div>
<div class="row" style="align-items:center">
 <label class="chk"><input type="checkbox" data-f="shiny" ${shiny ? 'checked' : ''}>Chromatique ★</label>
 <span class="m">${gender ? 'Sexe ' + gender + ' · ' : ''}Exp ${m.exp} · DO ${h(m.otName)}</span>
</div>
<h3>PV / Statut</h3>
<div class="row">
 <label>PV (max ${m.stats[0]})<input type="number" min="0" max="999" data-f="hp" value="${m.hp}"></label>
 <label>Statut<select data-f="status">${STATUS.map(([v, l]) => `<option value="${v}" ${sel(v === stCur)}>${l}</option>`).join('')}</select></label>
</div>
<h3>Attaques</h3>
<table>${moves}</table>
<h3>IV <button class="ic" data-act="ivMax">tout à 31</button></h3>
<div class="six">${six('iv', m.ivs, 31)}</div>
<h3>EV <span class="tag ${evTot > 510 ? 'dn' : ''}">total ${evTot}/510</span></h3>
<div class="six">${six('ev', m.ev, 255)}</div>
<h3>Stats actuelles</h3>
<div class="six">${m.stats
			.map((x, k) => `<div class="stat"><span class="m">${STATS[k]}</span><b class="${up !== dn && k === up ? 'up' : up !== dn && k === dn ? 'dn' : ''}">${x}</b></div>`)
			.join('')}</div>
<div class="actions" style="margin-top:14px"><button data-act="heal">Soigner</button><button class="pri" data-act="saveMon">Appliquer</button></div>
<p class="hint">Les stats sont recalculées à l'application (niveau, nature, IV, EV). Changer nature/chromatique génère une nouvelle personnalité (même sexe). En combat, les modifs ne se voient qu'après le combat.</p>`;
	}

	function saveMon() {
		const c = st.ctx, a = c.party.addr + st.mi * 100;
		const m = parseMon(M.bytes(a, 100));
		if (!m.ok) return setStatus('Checksum invalide : écriture annulée.', 'err');
		const v = (k) => q(`[data-f=${k}]`).value;
		const oldSpecies = m.species, oldHpMax = m.stats[0];
		const sp = clamp(v('species'), 1, 411);
		let nick = v('nick').trim();
		if (sp !== oldSpecies && nick.toUpperCase() === spName(oldSpecies).toUpperCase()) nick = spName(sp);
		m.species = sp;
		m.nick = nick || spName(sp);
		const b = base(sp);
		// personnalité
		const nature = clamp(v('nature'), 0, 24), shiny = q('[data-f=shiny]').checked;
		if (nature !== m.pid % 25 || shiny !== isShiny(m.pid, m.otid)) {
			if (sp === UNOWN) return setStatus('Zarbi : changer nature/chromatique changerait sa lettre — non géré.', 'err');
			const p = newPid(m.pid, m.otid, nature, shiny, b ? b.gender : 255);
			if (p === null) return setStatus('Impossible de générer une personnalité compatible.', 'err');
			m.pid = p;
		}
		m.item = +v('item') || 0;
		m.friendship = clamp(v('friend'), 0, 255);
		m.abil = +v('abil') ? 1 : 0;
		if (b && !b.ab[1]) m.abil = 0;
		m.origins = (m.origins & ~(0xf << 11)) | (clamp(v('ball'), 1, 12) << 11);
		for (let k = 0; k < 6; k++) {
			m.ivs[k] = clamp(q(`[data-iv="${k}"]`).value, 0, 31);
			m.ev[k] = clamp(q(`[data-ev="${k}"]`).value, 0, 255);
		}
		const evTot = m.ev.reduce((x, y) => x + y, 0);
		if (evTot > 510) return setStatus(`EV : total ${evTot} > 510.`, 'err');
		// attaques (les emplacements vides sont tassés à la fin)
		const mv = [];
		for (let k = 0; k < 4; k++) {
			const id = +q(`[data-mv="${k}"]`).value, up = +q(`[data-ppup="${k}"]`).value & 3;
			if (!id) continue;
			const mx = maxPP(id, up);
			let pp = clamp(q(`[data-pp="${k}"]`).value, 0, 99);
			if (mx) pp = id !== m.moves[k] ? mx : Math.min(pp, mx);
			mv.push({ id, pp, up });
		}
		if (!mv.length) return setStatus('Il faut au moins une attaque.', 'err');
		while (mv.length < 4) mv.push({ id: 0, pp: 0, up: 0 });
		m.moves = mv.map((x) => x.id);
		m.pp = mv.map((x) => x.pp);
		m.ppUp = mv.reduce((acc, x, k) => acc | (x.up << (k * 2)), 0);
		// niveau / expérience / stats
		const lvl = clamp(v('level'), 1, 100);
		if (b && levelFor(b.growth, m.exp) !== lvl) m.exp = expAt(b.growth, lvl);
		m.level = lvl;
		if (b) m.stats = calcStats(b.st, m.ivs, m.ev, lvl, m.pid % 25, sp);
		const hpIn = clamp(v('hp'), 0, 999);
		m.hp = hpIn === oldHpMax ? m.stats[0] : Math.min(hpIn, m.stats[0]);
		m.status = +v('status') || 0;
		M.wbytes(a, buildMon(m));
		if (c.sb && sp !== oldSpecies && rd().natdex[sp]) dexSet(c, rd().natdex[sp], true, true);
		done('Pokémon mis à jour.');
	}
	function healMon(addr) {
		const m = parseMon(M.bytes(addr, 100));
		if (!m.ok || m.egg) return;
		m.hp = m.stats[0];
		m.status = 0;
		m.moves.forEach((id, k) => {
			const mx = maxPP(id, (m.ppUp >> (k * 2)) & 3);
			if (mx) m.pp[k] = mx;
		});
		M.wbytes(addr, buildMon(m));
	}

	/* ------------------------------ Onglet Sac ------------------------------ */
	function renderBag() {
		const c = st.ctx;
		if (!c.sb) return blocker('Sac introuvable.<br>Charge une sauvegarde puis ⟳.');
		const p = c.L.pockets[st.pocket];
		const list = readPocket(c, p);
		const n = list.findIndex((x) => !x.id);
		const count = n < 0 ? p.size : n;
		const rows = [];
		for (let s = 0; s < Math.min(p.size, count + 1); s++) {
			const x = list[s];
			rows.push(`<div class="li ${s === st.bagSel ? 'sel' : ''} ${x.id ? '' : 'empty'}" data-bagsel="${s}">
 <span class="n">${s + 1}</span><span class="t">${x.id ? h(itemName(x.id)) : '+ ajouter un objet'}</span>${x.id ? `<span class="m">×${x.qty}</span>` : ''}</div>`);
		}
		const cur = st.bagSel >= 0 ? list[st.bagSel] : null;
		const fillable = ['items', 'balls', 'tm', 'berries'].includes(p.k);
		return `
<h3>${h(p.n)} <span class="tag">${count}/${p.size}</span></h3>
<div class="list pick">${rows.join('')}</div>
${
	cur
		? `<div class="editor">
 <label>Rechercher<input data-f="itq" value="${h(st.filter.item)}" placeholder="nom…"></label>
 <label>Objet (emplacement ${st.bagSel + 1})<select data-f="itid" size="6">${itemOptions(cur.id, p.pocket, st.filter.item)}</select></label>
 <div class="row">
  <label style="max-width:110px">Quantité<input type="number" min="1" max="999" data-f="itqty" value="${cur.id ? cur.qty : p.k === 'key' ? 1 : 99}"></label>
  <div class="actions">${cur.id ? '<button class="danger" data-act="bagDel">Supprimer</button>' : ''}<button class="pri" data-act="bagSet">${cur.id ? 'Changer' : 'Ajouter'}</button></div>
 </div>
</div>`
		: '<p class="hint">Touche un emplacement pour le modifier.</p>'
}
${fillable ? `<div class="actions" style="margin-top:12px"><button data-act="bagFill">Remplir la poche</button></div>` : ''}
<p class="hint">Quantité max conseillée : 99 dans le sac, 999 au PC.</p>`;
	}
	function bagSet() {
		const c = st.ctx, p = c.L.pockets[st.pocket], list = readPocket(c, p);
		const id = +q('[data-f=itid]').value;
		if (!id) return setStatus('Choisis un objet dans la liste.', 'err');
		const dup = list.findIndex((x) => x.id === id);
		if (dup >= 0 && dup !== st.bagSel) return setStatus(`Déjà présent (emplacement ${dup + 1}).`, 'err');
		const qty = clamp(q('[data-f=itqty]').value, 1, 999);
		if (st.bagSel < list.length) list[st.bagSel] = { id, qty };
		writePocket(c, p, list);
		st.bagSel = -1;
		done('Sac mis à jour.');
	}
	function bagDel() {
		const c = st.ctx, p = c.L.pockets[st.pocket], list = readPocket(c, p);
		list.splice(st.bagSel, 1);
		writePocket(c, p, list);
		st.bagSel = -1;
		done('Objet retiré.');
	}
	function bagFill() {
		const c = st.ctx, p = c.L.pockets[st.pocket];
		const list = readPocket(c, p).filter((x) => x.id);
		const have = new Set(list.map((x) => x.id));
		for (const it of itemList()) {
			if (list.length >= p.size) break;
			if (it.pocket !== p.pocket || have.has(it.id)) continue;
			list.push({ id: it.id, qty: p.k === 'tm' && it.id >= 339 ? 1 : 99 });
		}
		writePocket(c, p, list);
		done('Poche remplie.');
	}

	/* ------------------------------ Onglet Pokédex ------------------------------ */
	function renderDex() {
		const c = st.ctx;
		if (!c.sb) return blocker('Pokédex introuvable.<br>Charge une sauvegarde puis ⟳.');
		const r = rd(), mode = st.filter.dexMode;
		let seen = 0, owned = 0;
		const rows = [];
		for (let n = 1; n <= 386; n++) {
			const s = r.fromNat[n], name = s ? spName(s) : `#${n}`, d = dexGet(c, n);
			if (d.seen) seen++;
			if (d.owned) owned++;
			if ((mode === 'seen' && !d.seen) || (mode === 'owned' && !d.owned) || (mode === 'missing' && d.owned)) continue;
			rows.push(`<div class="li" data-name="${h(name.toLowerCase())}"><span class="n">#${pad(n, 3)}</span><span class="t">${h(name)}</span>
<label class="chk"><input type="checkbox" data-dex="${n}" data-k="seen" ${d.seen ? 'checked' : ''}>Vu</label>
<label class="chk"><input type="checkbox" data-dex="${n}" data-k="owned" ${d.owned ? 'checked' : ''}>Pris</label></div>`);
		}
		return `
<h3>Pokédex <span class="tag">vus ${seen}/386</span><span class="tag">pris ${owned}/386</span></h3>
<div class="actions"><button data-act="dexAll" data-v="seen">Tout vu</button><button data-act="dexAll" data-v="owned">Tout pris</button><button class="danger" data-act="dexAll" data-v="none">Tout effacer</button></div>
<div class="row" style="margin-top:10px">
 <label style="max-width:150px">Afficher<select data-f="dexmode">${[['all', 'Tous'], ['seen', 'Vus'], ['owned', 'Pris'], ['missing', 'Manquants']]
		.map(([k, l]) => `<option value="${k}" ${sel(k === mode)}>${l}</option>`)
		.join('')}</select></label>
 <label>Rechercher<input data-f="dexq" value="${h(st.filter.dex)}" placeholder="nom…"></label>
</div>
<div class="list" style="margin-top:10px">${rows.join('') || '<div class="li empty"><span class="t">rien à afficher</span></div>'}</div>
<p class="hint">Les n° 252+ ne s'affichent en jeu qu'avec le Pokédex National débloqué.</p>`;
	}
	function dexAll(v) {
		const c = st.ctx;
		for (let n = 1; n <= 386; n++) dexSet(c, n, v !== 'none', v === 'owned');
		done(v === 'none' ? 'Pokédex effacé.' : 'Pokédex mis à jour.');
	}

	/* ------------------------------ Événements ------------------------------ */
	function done(msg) {
		const keepTop = mainEl.scrollTop;
		refresh(true);
		mainEl.scrollTop = keepTop;
		setStatus('✓ ' + msg, 'ok');
	}

	function filterDexRows() {
		const qq = st.filter.dex.toLowerCase();
		mainEl.querySelectorAll('.li[data-name]').forEach((r) => (r.style.display = !qq || r.dataset.name.includes(qq) ? '' : 'none'));
	}

	function bindAfterRender() {
		if (st.tab === 'bag') {
			const qq = q('[data-f=itq]'), s = q('[data-f=itid]');
			if (qq)
				qq.addEventListener('input', () => {
					st.filter.item = qq.value;
					s.innerHTML = itemOptions(+s.value, st.ctx.L.pockets[st.pocket].pocket, qq.value);
				});
		}
		if (st.tab === 'dex') {
			const qq = q('[data-f=dexq]');
			if (qq) {
				qq.addEventListener('input', () => {
					st.filter.dex = qq.value;
					filterDexRows();
				});
				filterDexRows();
			}
		}
	}

	function onChange(e) {
		const t = e.target;
		if (t.dataset.f === 'dexmode') {
			st.filter.dexMode = t.value;
			return render();
		}
		if (t.dataset.dex) {
			const n = +t.dataset.dex;
			return safe(() => {
				const d = dexGet(st.ctx, n);
				if (t.dataset.k === 'owned') dexSet(st.ctx, n, t.checked || d.seen, t.checked);
				else dexSet(st.ctx, n, t.checked, t.checked && d.owned);
				done(`#${pad(n, 3)} mis à jour.`);
			});
		}
	}

	function onClick(e) {
		const t = e.target.closest('button,[data-bagsel]');
		if (!t || !root.contains(t) || t.disabled) return;
		const ds = t.dataset;
		if (ds.tab) {
			st.tab = ds.tab;
			st.bagSel = -1;
			setStatus('');
			return refresh();
		}
		if (ds.mi !== undefined) {
			st.mi = +ds.mi;
			setStatus('');
			return refresh();
		}
		if (ds.pk !== undefined) {
			st.pocket = +ds.pk;
			st.bagSel = -1;
			st.filter.item = '';
			setStatus('');
			return render();
		}
		if (ds.bagsel !== undefined) {
			st.bagSel = +ds.bagsel;
			return render();
		}
		const act = ds.act;
		if (!act) return;
		if (act === 'close') return toggle();
		if (act === 'refresh') return refresh();
		if (act === 'ivMax') return mainEl.querySelectorAll('[data-iv]').forEach((i) => (i.value = 31));
		if (act === 'dexAll') return safe(() => dexAll(ds.v));
		if (act === 'heal') return safe(() => (healMon(st.ctx.party.addr + st.mi * 100), done('Pokémon soigné.')));
		if (act === 'healAll')
			return safe(() => {
				for (let i = 0; i < st.ctx.party.n; i++) healMon(st.ctx.party.addr + i * 100);
				done('Équipe soignée.');
			});
		const fns = { saveTrainer, saveMon, bagSet, bagDel, bagFill };
		if (fns[act]) safe(fns[act]);
	}

	function safe(fn) {
		try {
			const ctx = detect();
			if (!ctx.ok || !ctx.loaded) return refresh();
			st.ctx = ctx;
			fn();
		} catch (err) {
			console.error('[PKE]', err);
			setStatus('Erreur : ' + err.message, 'err');
		}
	}

	// API console : PKE.open(), PKE.ctx(), PKE.rom(), PKE.mon(i)
	window.PKE = {
		open: () => !st.open && toggle(),
		close: () => st.open && toggle(),
		ctx: detect,
		rom: rd,
		mon: (i = 0) => {
			const c = detect();
			return c.party ? parseMon(M.bytes(c.party.addr + i * 100, 100)) : null;
		},
		diag: () => {
			const r = rd();
			return { code: romKey(), especes: r.species.length, attaques: r.moves.length, objets: r.items.length, objet4: r.items[4] && r.items[4].name, talents: r.abilities.length, stats: r.base, pp: r.mdata, pokedex: r.natFound };
		},
		read: (a, n = 16) => Array.from(M.bytes(a, n), (b) => b.toString(16).padStart(2, '0')).join(' '),
		_: { parseMon, buildMon, encodeStr, decodeStr, calcStats, expAt, levelFor, newPid, isShiny },
		mem: M
	};

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
	else build();
})();
