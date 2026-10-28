function GameBoyAdvanceKeypad() {
	this.KEYCODE_LEFT = 37;
	this.KEYCODE_UP = 38;
	this.KEYCODE_RIGHT = 39;
	this.KEYCODE_DOWN = 40;
	this.KEYCODE_START = 13;
	this.KEYCODE_SELECT = 220;
	this.KEYCODE_A = 90;
	this.KEYCODE_B = 88;
	this.KEYCODE_L = 65;
	this.KEYCODE_R = 83;

	this.GAMEPAD_LEFT = 14;
	this.GAMEPAD_UP = 12;
	this.GAMEPAD_RIGHT = 15;
	this.GAMEPAD_DOWN = 13;
	this.GAMEPAD_START = 9;
	this.GAMEPAD_SELECT = 8;
	// A et B inversés par rapport à gbajs d'origine
	this.GAMEPAD_A = 0;
	this.GAMEPAD_B = 1;
	this.GAMEPAD_L = 4;
	this.GAMEPAD_R = 5;
	this.GAMEPAD_THRESHOLD = 0.2;

	this.A = 0;
	this.B = 1;
	this.SELECT = 2;
	this.START = 3;
	this.RIGHT = 4;
	this.LEFT = 5;
	this.UP = 6;
	this.DOWN = 7;
	this.R = 8;
	this.L = 9;

	this.currentDown = 0x03FF;
	this.eatInput = false;

	this.gamepads = [];
};

GameBoyAdvanceKeypad.prototype.keyboardHandler = function(e) {
	var toggle = 0;
	switch (e.keyCode) {
	case this.KEYCODE_START:
		toggle = this.START;
		break;
	case this.KEYCODE_SELECT:
		toggle = this.SELECT;
		break;
	case this.KEYCODE_A:
		toggle = this.A;
		break;
	case this.KEYCODE_B:
		toggle = this.B;
		break;
	case this.KEYCODE_L:
		toggle = this.L;
		break;
	case this.KEYCODE_R:
		toggle = this.R;
		break;
	case this.KEYCODE_UP:
		toggle = this.UP;
		break;
	case this.KEYCODE_RIGHT:
		toggle = this.RIGHT;
		break;
	case this.KEYCODE_DOWN:
		toggle = this.DOWN;
		break;
	case this.KEYCODE_LEFT:
		toggle = this.LEFT;
		break;
	default:
		return;
	}

	toggle = 1 << toggle;
	if (e.type == "keydown") {
		this.currentDown &= ~toggle;
	} else {
		this.currentDown |= toggle;
	}

	if (this.eatInput) {
		e.preventDefault();
	}
};

// Boutons : objets {pressed, value} (API moderne) ou nombres (anciens navigateurs)
GameBoyAdvanceKeypad.prototype.isGamepadButtonDown = function(gamepad, index) {
	var b = gamepad.buttons[index];
	if (b === undefined || b === null) {
		return false;
	}
	if (typeof b === "object") {
		return b.pressed || b.value > this.GAMEPAD_THRESHOLD;
	}
	return b > this.GAMEPAD_THRESHOLD;
};

GameBoyAdvanceKeypad.prototype.gamepadHandler = function(gamepad) {
	var map = [
		[this.GAMEPAD_LEFT, this.LEFT], [this.GAMEPAD_UP, this.UP],
		[this.GAMEPAD_RIGHT, this.RIGHT], [this.GAMEPAD_DOWN, this.DOWN],
		[this.GAMEPAD_START, this.START], [this.GAMEPAD_SELECT, this.SELECT],
		[this.GAMEPAD_A, this.A], [this.GAMEPAD_B, this.B],
		[this.GAMEPAD_L, this.L], [this.GAMEPAD_R, this.R]
	];
	var value = 0;
	for (var i = 0; i < map.length; ++i) {
		if (this.isGamepadButtonDown(gamepad, map[i][0])) {
			value |= 1 << map[i][1];
		}
	}
	// Stick gauche
	if (gamepad.axes && gamepad.axes.length >= 2) {
		if (gamepad.axes[0] < -0.5) value |= 1 << this.LEFT;
		if (gamepad.axes[0] > 0.5) value |= 1 << this.RIGHT;
		if (gamepad.axes[1] < -0.5) value |= 1 << this.UP;
		if (gamepad.axes[1] > 0.5) value |= 1 << this.DOWN;
	}
	// La manette n'écrase pas le clavier ni le tactile
	var prev = this._gpMask || 0;
	this.currentDown = ((this.currentDown | prev) & ~value) & 0x3FF;
	this._gpMask = value;
};

GameBoyAdvanceKeypad.prototype.gamepadConnectHandler = function(e) {
	var gamepad = e && e.gamepad ? e.gamepad : e;
	if (!this.gamepads) {
		this.gamepads = [];
	}
	if (gamepad && this.gamepads.indexOf(gamepad) === -1) {
		this.gamepads.push(gamepad);
	}
};

GameBoyAdvanceKeypad.prototype.gamepadDisconnectHandler = function(e) {
	var gamepad = e && e.gamepad ? e.gamepad : e;
	this.gamepads = (this.gamepads || []).filter(function(other) {
		return other !== gamepad && (!gamepad || other.index !== gamepad.index);
	});
	// Relâche les touches tenues par la manette débranchée
	if (this._gpMask) {
		this.currentDown |= this._gpMask;
		this._gpMask = 0;
	}
};

GameBoyAdvanceKeypad.prototype.pollGamepads = function() {
	var navigatorList = [];
	try {
		if (navigator.getGamepads) {
			navigatorList = navigator.getGamepads();
		} else if (navigator.webkitGetGamepads) {
			navigatorList = navigator.webkitGetGamepads();
		}
	} catch (e) {}

	var gamepad = null;
	for (var i = 0; navigatorList && i < navigatorList.length; ++i) {
		if (navigatorList[i]) {
			gamepad = navigatorList[i];
			break;
		}
	}
	if (gamepad) {
		this.gamepadHandler(gamepad);
	} else if (this._gpMask) {
		this.currentDown |= this._gpMask;
		this._gpMask = 0;
	}
};

GameBoyAdvanceKeypad.prototype.registerHandlers = function() {
	window.addEventListener("keydown", this.keyboardHandler.bind(this), true);
	window.addEventListener("keyup", this.keyboardHandler.bind(this), true);

	window.addEventListener("gamepadconnected", this.gamepadConnectHandler.bind(this), true);
	window.addEventListener("mozgamepadconnected", this.gamepadConnectHandler.bind(this), true);
	window.addEventListener("webkitgamepadconnected", this.gamepadConnectHandler.bind(this), true);

	window.addEventListener("gamepaddisconnected", this.gamepadDisconnectHandler.bind(this), true);
	window.addEventListener("mozgamepaddisconnected", this.gamepadDisconnectHandler.bind(this), true);
	window.addEventListener("webkitgamepaddisconnected", this.gamepadDisconnectHandler.bind(this), true);
};
