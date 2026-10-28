/* ==========================================================================
   GBA.js SP — interface : contrôles tactiles, menu, états de la console
   S'appuie sur l'instance globale `gba` créée dans index.html.
   Le cœur de l'émulateur (js/) n'est pas modifié.
   ========================================================================== */
(function () {
	'use strict';

	var $ = function (id) { return document.getElementById(id); };

	// Bits du registre KEYINPUT (actif bas) — cf. js/keypad.js
	var BITS = { A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 };

	/* ---------- Préférences (localStorage, tolérant aux erreurs) ---------- */
	var PREFS_KEY = 'gbajs-sp.prefs';
	var prefs = { shell: 'cobalt', pixel: true, haptic: true, light: true, sound: true, volume: 1 };
	try {
		var stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
		for (var k in stored) { if (k in prefs) prefs[k] = stored[k]; }
	} catch (e) {}
	function savePrefs() {
		try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
	}

	/* ---------- Éléments ---------- */
	var sp = $('sp');
	var canvas = $('screen');
	var screenWrap = $('screenWrap');
	var insert = $('insert');
	var insertText = $('insertText');
	var toastEl = $('toast');
	var ledPower = $('ledPower');
	var dpad = $('dpad');
	var panel = $('panel');
	var scrim = $('scrim');
	var menuBtn = $('menuBtn');
	var loader = $('loader');
	var saveloader = $('saveloader');
	var keyEls = Array.prototype.slice.call(document.querySelectorAll('[data-key]'));

	/* ---------- État ---------- */
	var state = {
		romBuffer: null,
		romName: '',
		hasRom: false,
		paused: false,
		crashed: false,
		autoPaused: false,
		pendingSave: null
	};

	/* ---------- Utilitaires ---------- */
	var toastTimer = null;
	function toast(msg, ms) {
		toastEl.textContent = msg;
		toastEl.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 1800);
	}

	function haptic(ms) {
		if (prefs.haptic && navigator.vibrate) {
			try { navigator.vibrate(ms || 10); } catch (e) {}
		}
	}

	function download(blob, filename) {
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
	}

	function safeName() {
		var base = (gba && gba.rom && gba.rom.title) ? gba.rom.title.trim() : '';
		if (!base) base = state.romName.replace(/\.[^.]+$/, '') || 'gba';
		return base.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'gba';
	}

	/* ==========================================================================
	   Navigateur non compatible
	   ========================================================================== */
	if (!window.gba) {
		insertText.textContent = 'Navigateur non compatible';
		insert.disabled = true;
		return;
	}

	/* ==========================================================================
	   Initialisation de l'émulateur
	   (les correctifs clavier/manette sont maintenant directement dans js/keypad.js)
	   ========================================================================== */
	// Le canvas reste en 240×160 natif ; la mise à l'échelle est faite en CSS.
	gba.setCanvasDirect(canvas);
	gba.logLevel = gba.LOG_ERROR;

	loadRom('resources/bios.bin', function (bios) {
		gba.setBios(bios);
	});

	gba.setLogger(function (level, error) {
		console.log(error);
		if (state.crashed) return;
		state.crashed = true;
		gba.pause();
		var crash = document.createElement('img');
		crash.id = 'crash';
		crash.src = 'resources/crash.png';
		crash.alt = 'Le jeu a planté';
		screenWrap.appendChild(crash);
		refreshUI();
	});

	if (!gba.audio.context) {
		$('soundRow').hidden = true;
		$('optVolume').hidden = true;
	}

	/* ==========================================================================
	   Cycle de vie de la cartouche
	   ========================================================================== */
	function clearScreen() {
		var ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	function removeCrash() {
		var crash = $('crash');
		if (crash) crash.remove();
		state.crashed = false;
	}

	function startGame() {
		removeCrash();
		screenWrap.classList.remove('off-anim');
		screenWrap.classList.add('on');
		insert.hidden = true;
		state.hasRom = true;
		state.paused = false;
		gba.runStable();
		refreshUI();
	}

	function bootFromBuffer(buffer, then) {
		gba.pause();
		var ok = false;
		try {
			ok = gba.setRom(buffer);
		} catch (e) {
			console.error(e);
			ok = false;
		}
		if (!ok) {
			toast('ROM invalide');
			if (!state.hasRom) showInsert();
			return;
		}
		if (then) then(); else startGame();
	}

	function loadRomFile(file) {
		if (!file) return;
		insertText.textContent = 'Chargement…';
		var reader = new FileReader();
		reader.onload = function (e) {
			state.romBuffer = e.target.result;
			state.romName = file.name;
			bootFromBuffer(state.romBuffer, function () {
				toast(gba.rom && gba.rom.title ? gba.rom.title.trim() : file.name);
				// Priorité : sauvegarde reçue par lien, puis fichier .sav en attente
				applyLinkSave(function () {
					if (state.pendingSave) {
						var save = state.pendingSave;
						state.pendingSave = null;
						applySaveFile(save, startGame);
					} else {
						startGame();
					}
				});
			});
		};
		reader.onerror = function () { toast('Lecture impossible'); showInsert(); };
		reader.readAsArrayBuffer(file);
	}

	function applySaveFile(file, then) {
		var reader = new FileReader();
		reader.onload = function (e) {
			try {
				gba.setSavedata(e.target.result);
				toast('Sauvegarde importée');
			} catch (err) {
				console.error(err);
				toast('Sauvegarde invalide');
			}
			if (then) then();
		};
		reader.readAsArrayBuffer(file);
	}

	function showInsert() {
		insertText.textContent = 'Touchez pour insérer une cartouche';
		insert.hidden = false;
	}

	function powerOff(after) {
		screenWrap.classList.add('off-anim');
		setTimeout(function () {
			screenWrap.classList.remove('on', 'off-anim');
			clearScreen();
			if (after) after();
		}, 460);
	}

	function resetGame() {
		if (!state.romBuffer) return;
		gba.pause();
		removeCrash();
		powerOff(function () {
			bootFromBuffer(state.romBuffer);
		});
	}

	function ejectGame() {
		gba.pause();
		removeCrash();
		state.hasRom = false;
		state.paused = false;
		state.romBuffer = null;
		refreshUI();
		powerOff(showInsert);
	}

	function setPaused(paused) {
		if (!state.hasRom || state.crashed) return;
		var con = debug && debug.gbaCon;
		if (paused) {
			if (con) con.pause(); else gba.pause();
		} else {
			if (con) con.run(); else gba.runStable();
		}
		state.paused = paused;
		refreshUI();
	}

	function refreshUI() {
		var live = state.hasRom && !state.crashed;
		ledPower.classList.toggle('on', live && !state.paused);
		ledPower.classList.toggle('paused', live && state.paused);
		$('btnPause').disabled = !live;
		$('btnPause').textContent = state.paused ? 'Reprendre' : 'Pause';
		$('btnReset').disabled = !state.hasRom;
		$('btnEject').disabled = !state.hasRom;
		$('btnShot').disabled = !live;
		$('btnShare').disabled = !state.hasRom;
	}

	/* ---------- Pause auto quand l'onglet passe en arrière-plan ---------- */
	document.addEventListener('visibilitychange', function () {
		if (document.hidden) {
			if (state.hasRom && !state.paused && !state.crashed) {
				state.autoPaused = true;
				setPaused(true);
			}
		} else if (state.autoPaused) {
			state.autoPaused = false;
			setPaused(false);
		}
	});

	/* ---------- Déblocage audio (exigé par les navigateurs mobiles) ---------- */
	function unlockAudio() {
		var ctx = gba.audio && gba.audio.context;
		if (ctx && ctx.state === 'suspended' && ctx.resume) {
			ctx.resume().catch(function () {});
		}
	}
	window.addEventListener('pointerdown', unlockAudio, true);
	window.addEventListener('keydown', unlockAudio, true);

	/* ==========================================================================
	   Contrôles tactiles / souris (multi-touch, glisser entre les boutons)
	   ========================================================================== */
	var pointers = new Map();   // pointerId -> { kind: 'dpad' | 'btn', mask }
	var touchMask = 0;

	// Croix : 8 directions, zone morte au centre, cardinales légèrement favorisées
	function dpadMaskAt(x, y) {
		var r = dpad.getBoundingClientRect();
		var dx = x - (r.left + r.width / 2);
		var dy = y - (r.top + r.height / 2);
		var dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < r.width * 0.12) return 0;
		var cx = dx / dist, cy = dy / dist;
		var T = 0.42; // ~65° pour les cardinales, ~25° pour les diagonales
		var m = 0;
		if (cx > T) m |= 1 << BITS.RIGHT;
		else if (cx < -T) m |= 1 << BITS.LEFT;
		if (cy > T) m |= 1 << BITS.DOWN;
		else if (cy < -T) m |= 1 << BITS.UP;
		return m;
	}

	function btnMaskAt(x, y) {
		var el = document.elementFromPoint(x, y);
		var key = el && el.closest ? el.closest('[data-key]') : null;
		if (!key || !sp.contains(key)) return 0;
		return 1 << BITS[key.dataset.key];
	}

	function computeMask(p, x, y) {
		return p.kind === 'dpad' ? dpadMaskAt(x, y) : btnMaskAt(x, y);
	}

	function applyTouch() {
		var next = 0;
		pointers.forEach(function (p) { next |= p.mask; });
		var changed = next ^ touchMask;
		if (!changed) return;
		var pressed = changed & next;
		var released = changed & ~next;
		var kp = gba.keypad;
		kp.currentDown = ((kp.currentDown & ~pressed) | released) & 0x3FF;
		if (pressed) haptic(9);
		touchMask = next;
	}

	sp.addEventListener('pointerdown', function (e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		var target = e.target;
		var kind = null;
		if (target.closest('.dpad')) kind = 'dpad';
		else if (target.closest('[data-key]')) kind = 'btn';
		if (!kind) return;
		e.preventDefault();
		try { sp.setPointerCapture(e.pointerId); } catch (err) {}
		var p = { kind: kind, mask: 0 };
		p.mask = computeMask(p, e.clientX, e.clientY);
		pointers.set(e.pointerId, p);
		applyTouch();
	});

	sp.addEventListener('pointermove', function (e) {
		var p = pointers.get(e.pointerId);
		if (!p) return;
		e.preventDefault();
		var m = computeMask(p, e.clientX, e.clientY);
		if (m !== p.mask) {
			p.mask = m;
			applyTouch();
		}
	});

	function endPointer(e) {
		if (!pointers.has(e.pointerId)) return;
		pointers.delete(e.pointerId);
		applyTouch();
	}
	sp.addEventListener('pointerup', endPointer);
	sp.addEventListener('pointercancel', endPointer);
	sp.addEventListener('lostpointercapture', endPointer);
	sp.addEventListener('contextmenu', function (e) { e.preventDefault(); });

	// Relâche tout si la fenêtre perd le focus (évite les touches "collées")
	window.addEventListener('blur', function () {
		pointers.clear();
		applyTouch();
	});

	/* ---------- Retour visuel unifié (tactile + clavier + manette) ---------- */
	var lastDown = -1;
	function syncPressed() {
		var down = ~gba.keypad.currentDown & 0x3FF;
		if (down !== lastDown) {
			for (var i = 0; i < keyEls.length; ++i) {
				var el = keyEls[i];
				el.classList.toggle('pressed', !!(down & (1 << BITS[el.dataset.key])));
			}
			dpad.classList.toggle('up', !!(down & (1 << BITS.UP)));
			dpad.classList.toggle('down', !!(down & (1 << BITS.DOWN)));
			dpad.classList.toggle('left', !!(down & (1 << BITS.LEFT)));
			dpad.classList.toggle('right', !!(down & (1 << BITS.RIGHT)));
			lastDown = down;
		}
		requestAnimationFrame(syncPressed);
	}
	requestAnimationFrame(syncPressed);

	/* ==========================================================================
	   Menu / panneau
	   ========================================================================== */
	var desktopMQ = window.matchMedia('(min-width: 1000px) and (min-height: 620px)');

	function openPanel() {
		if (desktopMQ.matches) return;
		panel.classList.add('open');
		scrim.hidden = false;
		menuBtn.setAttribute('aria-expanded', 'true');
	}
	function closePanel() {
		panel.classList.remove('open');
		scrim.hidden = true;
		menuBtn.setAttribute('aria-expanded', 'false');
	}
	menuBtn.addEventListener('click', function () {
		haptic(6);
		if (panel.classList.contains('open')) closePanel(); else openPanel();
	});
	$('panelClose').addEventListener('click', closePanel);
	scrim.addEventListener('click', closePanel);
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') closePanel();
	});
	(desktopMQ.addEventListener ? desktopMQ.addEventListener.bind(desktopMQ, 'change') : desktopMQ.addListener.bind(desktopMQ))(function () {
		closePanel();
	});

	/* ---------- Actions ---------- */
	function pickRom() { loader.click(); }

	insert.addEventListener('click', pickRom);
	$('btnLoad').addEventListener('click', function () { closePanel(); pickRom(); });

	loader.addEventListener('change', function () {
		var file = loader.files[0];
		loader.value = '';
		loadRomFile(file);
	});

	$('btnSaveUp').addEventListener('click', function () { saveloader.click(); });
	saveloader.addEventListener('change', function () {
		var file = saveloader.files[0];
		saveloader.value = '';
		if (!file) return;
		if (state.hasRom && state.romBuffer) {
			// Redémarre la partie avec la sauvegarde importée
			closePanel();
			gba.pause();
			removeCrash();
			bootFromBuffer(state.romBuffer, function () {
				applySaveFile(file, startGame);
			});
		} else {
			state.pendingSave = file;
			toast('Sauvegarde prête : chargez la ROM');
		}
	});

	/* ==========================================================================
	   Sauvegarde portable dans l'URL
	   Format du fragment (jamais envoyé au serveur) :
	     #v=1&game=CODE&title=TITRE&size=N&crc=HEX&save=<z|r><base64url>
	   z = compressé (deflate-raw), r = brut (navigateur sans CompressionStream)
	   ========================================================================== */
	var LINK_VERSION = '1';
	var linkSave = null; // { game, title, bytes }
	var canCompress = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

	var CRC_TABLE = (function () {
		var t = new Uint32Array(256);
		for (var n = 0; n < 256; ++n) {
			var c = n;
			for (var k = 0; k < 8; ++k) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
			t[n] = c >>> 0;
		}
		return t;
	})();
	function crc32(bytes) {
		var c = 0xFFFFFFFF;
		for (var i = 0; i < bytes.length; ++i) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
		return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
	}

	function bytesToB64url(bytes) {
		var bin = '';
		for (var i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}
	function b64urlToBytes(str) {
		str = str.replace(/-/g, '+').replace(/_/g, '/');
		while (str.length % 4) str += '=';
		var bin = atob(str);
		var out = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
		return out;
	}
	function pipeBytes(bytes, transform) {
		var stream = new Blob([bytes]).stream().pipeThrough(transform);
		return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
	}
	function encodeSave(bytes) {
		if (canCompress) {
			return pipeBytes(bytes, new CompressionStream('deflate-raw'))
				.then(function (z) { return 'z' + bytesToB64url(z); });
		}
		return Promise.resolve('r' + bytesToB64url(bytes));
	}
	function decodeSave(payload) {
		var mode = payload.charAt(0);
		var data = b64urlToBytes(payload.slice(1));
		if (mode === 'r') return Promise.resolve(data);
		if (mode === 'z') {
			if (!canCompress) return Promise.reject(new Error('Navigateur trop ancien pour ce lien'));
			return pipeBytes(data, new DecompressionStream('deflate-raw'));
		}
		return Promise.reject(new Error('Format de lien inconnu'));
	}

	function clearLinkFromUrl() {
		linkSave = null;
		try {
			history.replaceState(null, '', location.pathname + location.search);
		} catch (e) {}
	}

	// Lecture du lien à l'ouverture (et si on colle un nouveau lien dans l'onglet)
	function readLinkFromHash() {
		if (!location.hash || location.hash.length < 2) return;
		var p = new URLSearchParams(location.hash.slice(1));
		var payload = p.get('save');
		if (!payload) return;
		var meta = {
			game: p.get('game') || '',
			title: p.get('title') || '',
			size: parseInt(p.get('size'), 10) || 0,
			crc: (p.get('crc') || '').toLowerCase()
		};
		decodeSave(payload).then(function (bytes) {
			if ((meta.size && bytes.length !== meta.size) || (meta.crc && crc32(bytes) !== meta.crc)) {
				throw new Error('Lien incomplet');
			}
			linkSave = { game: meta.game, title: meta.title, bytes: bytes };
			var name = meta.title || meta.game || 'ce jeu';
			if (state.hasRom && state.romBuffer) {
				// Un jeu tourne déjà : on relance avec la sauvegarde du lien
				gba.pause();
				removeCrash();
				bootFromBuffer(state.romBuffer, function () { applyLinkSave(startGame); });
			} else {
				insertText.textContent = 'Sauvegarde reçue (' + name + ') — touchez pour insérer la cartouche';
				toast('Sauvegarde reçue : ' + name, 3200);
			}
		}).catch(function (err) {
			console.error(err);
			clearLinkFromUrl();
			toast('Lien de sauvegarde invalide ou tronqué', 3200);
		});
	}

	// Applique la sauvegarde du lien au jeu qui vient d'être chargé
	function applyLinkSave(next) {
		if (!linkSave) return next();
		var code = gba.rom && gba.rom.code ? gba.rom.code : '';
		var label = linkSave.title || linkSave.game;
		if (linkSave.game && code && linkSave.game !== code) {
			var force = confirm('Ce lien contient une sauvegarde pour un autre jeu (' + label + ').\nL’appliquer quand même ?');
			if (!force) {
				// On la garde : l'utilisateur peut encore insérer la bonne cartouche
				return next();
			}
		}
		var hasLocal = false;
		try { hasLocal = !!localStorage.getItem(gba.SYS_ID + '.' + code); } catch (e) {}
		if (hasLocal && !confirm('Une sauvegarde existe déjà sur cet appareil pour ce jeu.\nLa remplacer par celle du lien ?')) {
			clearLinkFromUrl();
			toast('Sauvegarde locale conservée');
			return next();
		}
		try {
			gba.setSavedata(linkSave.bytes.slice().buffer);
			gba.storeSavedata(); // persiste tout de suite sur cet appareil
			toast('Sauvegarde du lien chargée', 2600);
		} catch (err) {
			console.error(err);
			toast('Sauvegarde incompatible avec ce jeu');
		}
		// Retire la sauvegarde de l'URL : recharger la page ne doit pas écraser la progression
		clearLinkFromUrl();
		next();
	}

	window.addEventListener('hashchange', readLinkFromHash);
	readLinkFromHash();

	/* ---------- Création du lien de partage ---------- */
	var shareDialog = $('shareDialog');
	var shareUrl = $('shareUrl');
	var shareMeta = $('shareMeta');
	var shareNative = $('shareNative');
	var currentShare = null;

	function isBlankSave(bytes) {
		var first = bytes[0];
		if (first !== 0x00 && first !== 0xFF) return false;
		for (var i = 1; i < bytes.length; ++i) if (bytes[i] !== first) return false;
		return true;
	}

	$('btnShare').addEventListener('click', function () {
		var sram = gba.mmu && gba.mmu.save;
		if (!sram || !sram.buffer) {
			toast('Aucune sauvegarde pour ce jeu');
			return;
		}
		var bytes = new Uint8Array(sram.buffer.slice(0));
		if (isBlankSave(bytes)) {
			toast('Pas encore de progression sauvegardée en jeu');
			return;
		}
		encodeSave(bytes).then(function (payload) {
			var p = new URLSearchParams();
			p.set('v', LINK_VERSION);
			p.set('game', (gba.rom && gba.rom.code) || '');
			p.set('title', (gba.rom && gba.rom.title ? gba.rom.title.trim() : ''));
			p.set('size', String(bytes.length));
			p.set('crc', crc32(bytes));
			p.set('save', payload);
			var url = location.origin + location.pathname + '#' + p.toString();
			currentShare = { url: url, title: 'Sauvegarde ' + safeName().replace(/_/g, ' ') };

			shareUrl.value = url;
			var kb = (bytes.length / 1024).toFixed(0);
			var meta = 'Sauvegarde de ' + kb + ' Ko → lien de ' + url.length.toLocaleString('fr-FR') + ' caractères.';
			var long = url.length > 30000;
			if (long) meta += ' Certaines messageries peuvent couper un lien aussi long : préfère un mail ou une note.';
			shareMeta.textContent = meta;
			shareMeta.classList.toggle('warn', long);
			shareNative.hidden = !(navigator.share && window.isSecureContext);

			closePanel();
			if (shareDialog.showModal) shareDialog.showModal(); else shareDialog.setAttribute('open', '');
			shareUrl.focus();
			shareUrl.select();
		}).catch(function (err) {
			console.error(err);
			toast('Impossible de créer le lien');
		});
	});

	$('shareCopy').addEventListener('click', function () {
		if (!currentShare) return;
		var done = function () { toast('Lien copié'); $('shareCopy').textContent = 'Copié ✓'; setTimeout(function () { $('shareCopy').textContent = 'Copier le lien'; }, 1500); };
		if (navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(currentShare.url).then(done, fallbackCopy);
		} else {
			fallbackCopy();
		}
		function fallbackCopy() {
			// HTTP simple (ex. Raspberry Pi en réseau local) : l'API presse-papiers est indisponible
			shareUrl.focus();
			shareUrl.select();
			var ok = false;
			try { ok = document.execCommand('copy'); } catch (e) {}
			if (ok) done(); else toast('Sélectionne le lien et copie-le manuellement');
		}
	});

	shareNative.addEventListener('click', function () {
		if (!currentShare || !navigator.share) return;
		navigator.share({ title: currentShare.title, url: currentShare.url }).catch(function () {});
	});

	$('btnPause').addEventListener('click', function () {
		setPaused(!state.paused);
		closePanel();
	});
	$('btnReset').addEventListener('click', function () { closePanel(); resetGame(); });
	$('btnEject').addEventListener('click', function () { closePanel(); ejectGame(); });

	$('btnShot').addEventListener('click', function () {
		canvas.toBlob(function (blob) {
			if (blob) download(blob, safeName() + '-' + Date.now() + '.png');
		}, 'image/png');
	});

	$('btnFull').addEventListener('click', function () {
		var doc = document;
		var el = doc.documentElement;
		var isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
		if (isFull) {
			(doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
		} else if (el.requestFullscreen || el.webkitRequestFullscreen) {
			var p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
			if (p && p.catch) p.catch(function () { toast('Plein écran refusé'); });
			closePanel();
		} else {
			toast('Ajoutez la page à l’écran d’accueil pour le plein écran');
		}
	});

	// Bouton éclairage sur la console
	$('lightBtn').addEventListener('click', function () {
		prefs.light = !prefs.light;
		applyLight();
		savePrefs();
		haptic(6);
	});
	function applyLight() {
		screenWrap.classList.toggle('dim', !prefs.light);
		$('lightBtn').setAttribute('aria-pressed', String(prefs.light));
	}

	/* ---------- Options ---------- */
	var optPixel = $('optPixel');
	optPixel.checked = prefs.pixel;
	canvas.classList.toggle('crisp', prefs.pixel);
	optPixel.addEventListener('change', function () {
		prefs.pixel = optPixel.checked;
		canvas.classList.toggle('crisp', prefs.pixel);
		savePrefs();
	});

	var optHaptic = $('optHaptic');
	optHaptic.checked = prefs.haptic;
	if (!navigator.vibrate) optHaptic.closest('.toggle').hidden = true;
	optHaptic.addEventListener('change', function () {
		prefs.haptic = optHaptic.checked;
		savePrefs();
	});

	var optSound = $('optSound');
	var optVolume = $('optVolume');
	function applySound() {
		gba.audio.masterEnable = prefs.sound;
		gba.audio.masterVolume = Math.pow(2, prefs.volume) - 1;
		optVolume.disabled = !prefs.sound;
	}
	optSound.checked = prefs.sound;
	optVolume.value = prefs.volume;
	optSound.addEventListener('change', function () {
		prefs.sound = optSound.checked;
		applySound();
		savePrefs();
	});
	optVolume.addEventListener('input', function () {
		prefs.volume = parseFloat(optVolume.value);
		applySound();
	});
	optVolume.addEventListener('change', savePrefs);

	/* ---------- Couleur de coque ---------- */
	var swatches = Array.prototype.slice.call(document.querySelectorAll('.swatch'));
	function applyShell(name) {
		document.body.dataset.shell = name;
		swatches.forEach(function (s) {
			s.setAttribute('role', 'radio');
			s.setAttribute('aria-checked', String(s.dataset.shell === name));
		});
	}
	swatches.forEach(function (s) {
		s.addEventListener('click', function () {
			prefs.shell = s.dataset.shell;
			applyShell(prefs.shell);
			savePrefs();
		});
	});

	/* ---------- Debugger (fenêtre séparée, protocole d'origine) ---------- */
	$('openDebug').addEventListener('click', function (e) {
		e.preventDefault();
		enableDebug();
	});

	function enableDebug() {
		window.onmessage = function (message) {
			if (message.origin != document.domain && (message.origin != 'file://' || document.domain)) {
				console.log('Failed XSS');
				return;
			}
			switch (message.data) {
			case 'connect':
				if (message.source == debug) {
					debug.postMessage('connect', document.domain || '*');
				}
				break;
			case 'connected':
				break;
			case 'disconnect':
				if (message.source == debug) {
					debug = null;
				}
			}
		};
		window.onunload = function () {
			if (debug && debug.postMessage) {
				debug.postMessage('disconnect', document.domain || '*');
			}
		};
		if (!debug || !debug.postMessage) {
			debug = window.open('debugger.html', 'debug');
		} else {
			debug.postMessage('connect', document.domain || '*');
		}
	}
	window.enableDebug = enableDebug;

	/* ---------- Application des préférences ---------- */
	applyShell(prefs.shell);
	applyLight();
	applySound();
	refreshUI();
})();
