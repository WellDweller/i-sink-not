import * as end from './end.js';

let canvasEl;
let ctx;
let CANVAS_WIDTH, CANVAS_HEIGHT;

const BUTTON_SIZE = 50;
const BUTTON_MARGIN = 20;

class Entity {
    render(timeSinceLastTick) {}
    tick(now) {}
    // return *entity reference* if this entity should be "clicked" at position x, y
    checkClick(x, y) { return null; }
    // callback for when this entity is clicked
    onClick(x, y) {}
}

const entities = [];

function loadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.addEventListener('load', () => {
            resolve(img);
        });
        img.src = url;
    });
}
const shipImage = await loadImage('art/ship-hull.png');

/* game state */

class State {
    gameRunning = true;
    floodRate = 1;
    floodAmount = 0;
    shipDraught = 10;
    shipHeight = shipImage.height;
    distanceTraveled = 0;
    speed = 0;
    cooldown = 0;
    currentCallback = null;
}

let state;

const isPointInBox = (x, y, box) => !(x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height);

class Button extends Entity {
    static SIZE = 50;
    static MARGIN = 20;

    constructor(index, icon, cost, callback) {
        super();
        this.icon = icon;
        this.cost = cost;
        this.callback = callback;

        this.box = {
            x: Button.MARGIN,
            y: Button.MARGIN + index * (Button.SIZE + Button.MARGIN),
            height: Button.SIZE,
            width: Button.SIZE,
        };
    }

    checkClick(x, y) {
        const { box } = this;
        if (isPointInBox(x, y, box)) {
            return this;
        }
    }

    onClick(x, y) {
        state.cooldown = this.cost;
        state.currentCallback = this.callback;
    }

    render() {
        const { x, y, width, height } = this.box;
        ctx.fillStyle = state.cooldown > 0 ? 'grey' : 'cornsilk';
        ctx.fillRect(x, y, width, height);
        ctx.strokeText(this.icon, x + 10, y + 36);
    }
}

/**************/

function onClick(ev) {
    // can't do any buttons while in cooldown
    if (state.cooldown > 0) {
        return;
    }

    const x = ev.offsetX;
    const y = ev.offsetY;

    for (let entity of entities) {
        let res = entity.checkClick(x, y);
        if (res) {
            entity.onClick(x, y);
            break;
        }
    }
}

class GameController extends Entity {
    tick(timeSinceLastTick) {
        // lose condition
        // TODO: don't hard code the water height here
        if (state.shipHeight - 100 < state.shipDraught) {
            state.gameRunning = false;
            tearDown(canvasEl);
            end.setUp(canvasEl, state.distanceTraveled);
            return;
        }

        // handle cooldowns and actions
        state.cooldown = Math.max(0, state.cooldown - timeSinceLastTick);
        if (state.cooldown == 0 && state.currentCallback) {
            state.currentCallback();
            state.currentCallback = null;
        }

        state.distanceTraveled += timeSinceLastTick * (state.speed / 100);
        state.speed = Math.max(0, state.speed - .1); // TODO: make this a function of draught
        state.floodAmount += timeSinceLastTick * (state.floodRate / 100);
        state.shipDraught = state.floodAmount + 10; // TODO: smarter
    }

    render(now) {
        // world
        ctx.fillStyle = 'skyblue';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // distance
        ctx.fillStyle = 'white';
        ctx.font = '32px sans-serif';
        const distanceText = `${Math.floor(state.distanceTraveled)}m`;
        const textMetrics = ctx.measureText(distanceText);
        ctx.fillText(distanceText, Math.floor(CANVAS_WIDTH - textMetrics.width) - 10, Math.floor(textMetrics.actualBoundingBoxAscent) + 10);
    }
}

const SHIP_MODULE_HEIGHT = 100;
const SHIP_MODULE_WIDTH = 100;

class ShipModule extends Entity {
    image = shipImage;

    render() {
        ctx.drawImage(this.image, 0, -SHIP_MODULE_HEIGHT, SHIP_MODULE_HEIGHT, SHIP_MODULE_WIDTH);
    }
}

class Ship extends Entity {
    columns = 4;

    modules = [[]];

    constructor() {
        super();
        const ship = this;
        this.box = {
            // position is anchored to the bottom left corner of the ship
            x: SHIP_MODULE_WIDTH,
            get y() { return CANVAS_HEIGHT - SHIP_MODULE_HEIGHT + state.shipDraught },
            get width() { return ship.columns * SHIP_MODULE_WIDTH },
            get height() { return ship.modules.length * SHIP_MODULE_HEIGHT },
        }
    }

    tick(timeSinceLastTick) {
    }

    render(now) {
        ctx.save();

        const { box } = this;

        ctx.translate(box.x, box.y);
        ctx.strokeStyle = 'red';
        ctx.strokeRect(0, -box.height, box.width, box.height);

        for (let y = 0; y < this.modules.length; y++) {
            const row = this.modules[y];

            for (let x = 0; x < row.length; x++) {
                ctx.translate(x * SHIP_MODULE_WIDTH, 0);
                const module = row[x];
                // debug
                ctx.fillText(`${x}, ${y}`, 0, -SHIP_MODULE_HEIGHT);
                if (module) {
                    module.render(now);
                } else {
                    // debug
                    ctx.strokeStyle = 'white';
                    ctx.strokeRect(0, -SHIP_MODULE_HEIGHT, SHIP_MODULE_HEIGHT, SHIP_MODULE_WIDTH);
                }
                }
            ctx.translate((row.length - 1) * -SHIP_MODULE_WIDTH, -SHIP_MODULE_HEIGHT);
        }

        ctx.restore();
    }

    checkClick(mouseX, mouseY) {
        const { x, y } = this.box;

        console.log(`checking click at ${mouseX} ${mouseY}`);

        const moduleBox = { x: 0, y: 0, width: SHIP_MODULE_WIDTH, height: SHIP_MODULE_HEIGHT };

        for (let modY = 0; modY < this.modules.length; modY++) {
            const row = this.modules[modY];
            for (let modX = 0; modX < row.length; modX++) {
                const module = row[modX];
                if (!module) continue;

                moduleBox.x =  x + (modX * SHIP_MODULE_WIDTH);
                moduleBox.y = y + ((modY + 1) * -SHIP_MODULE_HEIGHT);

                // TODO - i would move the logic for individual modules to the module class, but they don't currently
                // know their position in the ship or have a reference to the ship, so i'll just do it here
                // let res = module.checkClick(x, y);
                if (isPointInBox(mouseX, mouseY, moduleBox)) {
                    console.log(`clicked on module in position ${modX}, ${modY}`);
                    return module;
                }
            }
        }
    }
}

class Water extends Entity {
    render(now) {
        // water
        ctx.fillStyle = 'rgba(0, 0, 128, .7)';
        ctx.fillRect(0, CANVAS_HEIGHT - 100 - 5 * Math.sin((now - firstFrame) / 250), CANVAS_WIDTH, CANVAS_HEIGHT);
    }
}

class DebugDisplay extends Entity {
    render() {
        ctx.fillStyle = 'black';
        ctx.font = '24px sans-serif';

        let offsetY = 50;
        for (let key in state) {
            let val = state[key];
            if (typeof val === 'number') val = val.toFixed(2);
            if (typeof val === 'function') val = '<callback>';
            const text = `${key} = ${val}`;
            const textMetrics = ctx.measureText(text);
            offsetY += Math.floor(textMetrics.actualBoundingBoxAscent);
            ctx.fillText(text, Math.floor(CANVAS_WIDTH - textMetrics.width) - 10, offsetY);
        }
    }
}

let previousTick = performance.now();
let tickTimer;

function tick() {
    const now = performance.now();
    const timeSinceLastTick = now - previousTick;

    for (let entity of entities) {
        entity.tick(timeSinceLastTick);
    }

    previousTick = now;
}

const firstFrame = performance.now();
let previousFrame = firstFrame;

function render(now) {
    if (!state.gameRunning) 
        return;

    for (let entity of entities) {
        entity.render(now);
    }

    previousFrame = now;
    requestAnimationFrame(render);
}

/**************/

export function setUp(canvasEl_) {
    canvasEl = canvasEl_;
    CANVAS_WIDTH = canvasEl.width;
    CANVAS_HEIGHT = canvasEl.height;

    ctx = canvasEl.getContext('2d');

    entities.length = 0;

    entities.push(new GameController());
    entities.push(new DebugDisplay());

    entities.push(
        new Button(0, '🪣', 1000, () => {state.floodAmount = Math.max(0, state.floodAmount - 1)}),
        new Button(1, '🧹', 1000, () => {state.speed = Math.min(state.speed + 1, 5)}),
    );

    const ship = new Ship();
    ship.modules = [
        [new ShipModule(), null],
        [null, new ShipModule()],
        [new ShipModule(), null],
    ];

    entities.push(ship);

    entities.push(new Water());

    state = new State;

    tickTimer = setInterval(tick, 100);
    render(performance.now());
    canvasEl.onclick = onClick;
}

function tearDown(canvasEl) {
    clearInterval(tickTimer);
    canvasEl.onclick = null;
}