/* GBA.js SP — ajoute les couleurs de coque supplémentaires dans un menu déroulant.
   Doit être chargé AVANT resources/sp.js (les deux en defer) pour que sp.js
   prenne en compte les nouvelles pastilles. */
(function () {
	'use strict';

	var EXTRA = [
		['graphite', 'Graphite'],
		['perle-bleu', 'Perle bleu'],
		['vert', 'Vert'],
		['orange', 'Orange'],
		['jaune', 'Jaune'],
		['violet', 'Violet'],
		['turquoise', 'Turquoise'],
		['blanc', 'Blanc'],
		['bordeaux', 'Bordeaux'],
		['kaki', 'Kaki']
	];

	var main = document.getElementById('swatches');
	if (!main || document.querySelector('.coque-plus')) return;

	var details = document.createElement('details');
	details.className = 'coque-plus';

	var summary = document.createElement('summary');
	summary.textContent = 'Plus de couleurs';
	details.appendChild(summary);

	var grid = document.createElement('div');
	grid.className = 'swatches';
	grid.setAttribute('role', 'radiogroup');
	grid.setAttribute('aria-label', 'Autres couleurs de coque');

	EXTRA.forEach(function (c) {
		var b = document.createElement('button');
		b.type = 'button';
		b.className = 'swatch';
		b.dataset.shell = c[0];
		b.title = c[1];
		b.setAttribute('aria-label', c[1]);
		grid.appendChild(b);
	});
	details.appendChild(grid);
	main.insertAdjacentElement('afterend', details);

	// Ouvre le menu si la couleur enregistrée est dedans
	try {
		var prefs = JSON.parse(localStorage.getItem('gbajs-sp.prefs') || '{}');
		if (prefs.shell && EXTRA.some(function (c) { return c[0] === prefs.shell; })) {
			details.open = true;
		}
	} catch (e) {}
})();
