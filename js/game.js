import * as end from './end.js';
import * as sound from './sound.js';

import { shipSpriteSheet, AnimatedSpriteController } from './art.js';

let canvasEl;
let ctx;
let CANVAS_WIDTH, CANVAS_HEIGHT;

const BUTTON_SIZE = 50;
const BUTTON_MARGIN = 20;

const DEFAULT_WATER_HEIGHT = 100;
let currentWaterHeight = DEFAULT_WATER_HEIGHT;

const FONT_STACK =  `'Book Antiqua', Palatino, 'Palatino Linotype', 'Palatino LT STD', Georgia, serif`;

const vectorLength = vec => Math.sqrt((vec.x ** 2) + (vec.y ** 2));

const normalizeVector = vec => {
    const l = vectorLength(vec);
    vec.x /= l;
    vec.y /= l;
    return vec;
}

const addVectors = (vecA, vecB) => {
    vecA.x += vecB.x;
    vecA.y += vecB.y;
    return vecA;
}

const scaleVector = (vec, scalar) => {
    vec.x *= scalar;
    vec.y *= scalar;
    return vec;
}

const cloneVector = ({ x, y }) => ({ x, y });

const VECTOR_UP = { x: 0, y: -1 };
const VECTOR_DOWN = { x: 0, y: 1 };

class Entity {
    visible = true;
    updating = true;
    alive = true;
    zIndex = 0;
    canClickWhilePaused = false;

    render(timeSinceLastTick) {}
    tick(now) {}
    // return *entity reference* if this entity should be "clicked" at position x, y
    checkClick(x, y) { return null; }
    // callback for when this entity is clicked
    onClick(x, y) {}

    onMouseOver() {}
    onMouseOut() {}
}

const entities = [];



/* game state */

class State {
    debug = false;
    gameRunning = true;
    paused = false;
    shipDraught = 10;
    timeAfloat = 0;
    distanceTraveled = 0;

    // A higher-resolution version of distanceTraveled.  It won't match exactly though,
    // since it's for rendering the background.  It just has to look reasonably nice.
    bgDistanceTraveled = 0;

    speed = 0;
    cooldown = 0;
    currentCallback = null;
    timeElapsed = 0;

    hoveredEntity = null;

    currentMouseX = -1;
    currentMouseY = -1;
    
    constructor(ship) {
        this.ship = ship;
    }

    get shipHeight() {
        let height = 0;
        for (const row of this.ship.modules) {
            let nonNullModuleSeen = false;
            for (const module of row) {
                if (module.constructor.name != 'NullModule') {
                    nonNullModuleSeen = true;
                    break;
                }
            }

            if (nonNullModuleSeen) {
                height += SHIP_MODULE_HEIGHT;
            }
        }
        return height;
    }

    get difficultyCoefficient() {
        // difficulty doubles for every:
        return Math.max(
            this.distanceTraveled / 1000 / 2,  // 2 kilometers, or
            this.timeElapsed / 1000 / 60 / 2,  // 2 minutes
        );
        // whichever is worse!
    }

    doPlayerAction(delay, callback) {
        this.cooldown = delay;
        this.currentCallback = callback;
        canvasEl.style.cursor = 'wait';
    }

    triggerSyntheticMouseMove() {
        onMouseMove(new MouseEvent('mousemove', {offsetX: this.currentMouseX, offsetY: this.currentMouseY}));
    }
}

let state;

function getWaterBob(offset = 0, magnitude = 5, interval = 250) {
    const timeElapsed = performance.now() - firstFrame;
    return magnitude * Math.sin((timeElapsed + offset) / interval);
}

const isPointInBox = (x, y, box) => !(x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height);

/**************/

function isEntityInteractive(entity) {
    if (state.paused && !entity.canClickWhilePaused) return false;
    if (!entity.updating) return false;
    return true;
}

function onClick(ev) {
    // can't do any buttons while in cooldown
    if (state.cooldown > 0) {
        return;
    }

    const x = ev.offsetX;
    const y = ev.offsetY;


    for (let entity of entities) {
        if (isEntityInteractive(entity)) {
            let res = entity.checkClick(x, y);
            if (res) {
                res.onClick(x, y);
                ev.stopPropagation();
                return;
            }
        }
    }
}

function onMouseMove(ev) {
    const x = ev.offsetX;
    const y = ev.offsetY;

    state.currentMouseX = x;
    state.currentMouseY = y;

    if (state.hoveredEntity && !state.hoveredEntity.alive) {
        state.hoveredEntity = null;
    }
    
    let newHoveredEntity = null;
    for (let entity of entities) {
        if (isEntityInteractive(entity)) {
            let res = entity.checkClick(x, y);
            if (res) {
                newHoveredEntity = res;
                break;
            }
        }
    }

    if (newHoveredEntity != state.hoveredEntity) {
        if (state.hoveredEntity) {
            state.hoveredEntity.onMouseOut();
        }

        state.hoveredEntity = newHoveredEntity;

        if (state.hoveredEntity) {
            state.hoveredEntity.onMouseOver();
        }
    }
}

function drawParallax(img, speed, x_offset, y_offset) {
    var numImages = Math.ceil(CANVAS_WIDTH / (img.width + x_offset)) + 1;
    var xpos = state.bgDistanceTraveled * 100 * speed % img.width;
    ctx.save();
    ctx.translate(-xpos, 0);
    for (var i = 0; i < numImages; i++) {
     ctx.drawImage(img, i * img.width * 1 + x_offset, y_offset);
    }
    ctx.restore();
    const timeSinceLastFrame = Math.min(performance.now() - previousFrame, 1000);
    state.bgDistanceTraveled += timeSinceLastFrame * (state.speed / 1000);
}

class GameController extends Entity {
    tick(timeSinceLastTick) {
        const timeElapsed = performance.now() - firstFrame;
        // lose condition
        if (state.shipHeight < state.shipDraught && state.gameRunning) {
            // TODO: if the top row of modules is all NullModule don't count it
            state.gameRunning = false;
            sound.play('gameover');
            entities.push(new GameOverScreen(state.timeElapsed));
        }

        if (!state.gameRunning) return;

        // TODO just move this logic into the ship entity
        if (!state.ship.updating) return;

        // handle cooldowns and actions
        state.cooldown = Math.max(0, state.cooldown - timeSinceLastTick);
        if (state.cooldown == 0 && state.currentCallback) {
            state.currentCallback();
            state.currentCallback = null;

            canvasEl.style.cursor = 'default';
            state.triggerSyntheticMouseMove();
        }

        const stats = state.ship.getStats();
        state.speed = stats.speed || 0;

        state.timeAfloat += timeSinceLastTick;
        state.distanceTraveled += timeSinceLastTick/100 * state.speed;
        state.shipDraught += timeSinceLastTick/100 * (stats.weight - (stats.buoyancy || 0));
    }

    render(now) {
        // world
        ctx.fillStyle = 'skyblue';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // bg parallax
        drawParallax(window.parallaxBgYellow, .01, 0, -200);
        drawParallax(window.parallaxBgOrange, .03, 0, -400);
        drawParallax(window.parallaxBgRed, .05, 0, -800);

        // TODO move into separate entity
        if (!state.ship.updating) return;
        if (!state.gameRunning) return;

        // distance
        ctx.fillStyle = 'white';
        ctx.font = `32px ${FONT_STACK}`;

        const textMargin = 10;

        const distanceText = `${Math.floor(state.distanceTraveled)}m`;
        const textMetrics = ctx.measureText(distanceText);
        ctx.fillText(distanceText, Math.floor(CANVAS_WIDTH - textMetrics.width) - textMargin, Math.floor(textMetrics.actualBoundingBoxAscent) + textMargin);

        // time
        const secondsAfloat = Math.floor(state.timeAfloat / 1000);
        const timeText = `${secondsAfloat}s`;
        const timeTextMetrics = ctx.measureText(timeText);
        ctx.fillText(timeText, textMargin, timeTextMetrics.actualBoundingBoxAscent + textMargin);

        // pause
        if (state.gameRunning && state.paused) {
            ctx.font = `64px ${FONT_STACK}`;
            const pauseText = 'PAUSED';
            const pauseTextMetrics = ctx.measureText(pauseText);
            ctx.fillText(pauseText, CANVAS_WIDTH/2 - pauseTextMetrics.width/2, 200);
        }
    }
}

const SHIP_MODULE_HEIGHT = 128;
const SHIP_MODULE_WIDTH = 128;

class ShipModule extends Entity {
    static solid = true;
    static canBuildAt(x, y) { return true; }

    get solid() {
        return this.constructor.solid;
    }

    sprite = null;
    icon = null;
    health = 10;
    baseFragility = 0;

    constructor(ship, x, y) {
        super();
        this.ship = ship;
        // x and y here are coordinates in the ship's grid, not relative to canvas!
        this.x = x;
        this.y = y;
        this.damage = 0;

        this.damageLevel = 'normal';
        this.isBeingRepaired = false;
    }

    get weight() {
        return 5;
    }

    get fragility() {
        if (this.baseFragility == 0) return 0;

        for (let i = -1; i < 2; i++) {
            for (let j = -1; j < 2; j++) {
                if (j == 0 || i == 0) { // don't count diagonals
                    if (i == 0 && j == 0) continue; // don't count self
                    const adjacentModule = this.ship.getModule(this.x + i, this.y + j);
                    if (adjacentModule && adjacentModule.constructor.name == 'CastleModule') {
                        return this.baseFragility * .5;
                    }
                }
            }
        }

        return this.baseFragility;
    }

    get percentSubmerged() {
        return Math.max(0, Math.min(1, (state.shipDraught - (this.y * SHIP_MODULE_HEIGHT)) / SHIP_MODULE_HEIGHT));
    }

    get globalX() {
        return this.ship.box.x + (this.x * SHIP_MODULE_WIDTH);
    }

    get globalY() {
        return this.ship.box.y + (this.y * -SHIP_MODULE_HEIGHT);
    }

    getStats() {
        return {};
    }

    updateDisplay() {}

    onDamage() {}
    onBreak() {}
    onStartFix() {
        sound.play('repairing');
    }
    onFixed() {}

    tick(timeSinceLastTick) {
        this.icon = null;

        if (this.percentSubmerged > 0 && Math.random() < (state.speed / 10)) {
            const spriteX = this.globalX + (Math.random() * SHIP_MODULE_WIDTH);
            const spriteY = CANVAS_HEIGHT - currentWaterHeight + getWaterBob();
            emitParticle(SprayParticle, 600, spriteX, spriteY);
        }

        if (this.fragility != 0) {
            if (Math.random() < .05) {
                const boost = this.fragility * state.difficultyCoefficient * (timeSinceLastTick/50) * Math.random();
                this.damage = Math.min(this.health, this.damage + boost);
            }
            
            if (this.damageLevel != 'broken' && this.damage == this.health) {
                this.damageLevel = 'broken';
                this.onBreak();
            } else if (this.damageLevel == 'normal' && this.damage > this.health/2) {
                this.damageLevel = 'damaged';
                this.onDamage();
            } else if (this.damageLevel != 'normal' && this.damage == 0) {
                this.damageLevel = 'normal';
                this.onFixed();
            }
        }

        if (this.damageLevel === 'broken' && isEntityInteractive(this) && this.percentSubmerged < .5) {
            this.icon = shipSpriteSheet.sprites.hammer_icon;
        }
    }

    onMouseOver() {
        if (this.damageLevel == 'broken') {
            canvasEl.style.cursor = 'pointer'; // TODO: wrench
            return true;
        }
        return false;
    }

    onMouseOut() {
        canvasEl.style.cursor = 'default';
    }

    onClick(x, y) {
        if (this.damageLevel == 'broken') {
            this.onStartFix();
            this.isBeingRepaired = true;
            state.doPlayerAction(1000, () => {
                this.damage = 0;
                this.isBeingRepaired = false;
                this.onFixed();
            });
        }
    }

    render() {
        const sprite = this.sprite || this.constructor.sprite;
        if (sprite) {
            sprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT);
        }

        if (this.fragility > 0) {
            if (this.damageLevel == 'damaged') {
                ctx.fillStyle = 'rgba(255, 255, 0, .2)';
                ctx.fillRect(0, -SHIP_MODULE_HEIGHT, SHIP_MODULE_WIDTH, SHIP_MODULE_HEIGHT);
            } else if (this.isBeingRepaired) {
                ctx.fillStyle = 'rgba(255, 255, 0, .2)';
                ctx.fillRect(0, -SHIP_MODULE_HEIGHT, SHIP_MODULE_WIDTH, SHIP_MODULE_HEIGHT);
            }
        }
    }
}

class HullModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.hull;

    static moduleName = 'Hull';
    static description = 'Makes you float';

    sprite = HullModule.sprite;

    defaultSprite = shipSpriteSheet.sprites.hull;
    bustedSprite = shipSpriteSheet.sprites.busted_hull;
    topHullSprite = shipSpriteSheet.sprites.top_hull;
    sideHullSprite = shipSpriteSheet.sprites.side_hull;

    renderTopHull = false;
    renderLeftHull = false;

    floodAmount = 0;
    buoyancy = 20;

    baseFragility = 1;

    constructor(ship, x, y) {
        super(ship, x, y);
        this.updateDisplay();
    }

    static canBuildAt(modX, modY) {
        // we can only be built on top of other hull modules (or at the bottom)
        if (modY == 0) {
            const left = state.ship.getModule(modX - 1, modY);
            if (left && left.solid) return true;

            const right = state.ship.getModule(modX + 1, modY);
            if (right && right.solid) return true;

            return false;
        }

        const moduleBelow = state.ship.getModule(modX, modY - 1);
        return moduleBelow && moduleBelow.solid;
    }

    tick(timeSinceLastTick, now) {
        if (!this.percentSubmerged > 0)
            return;

        super.tick(timeSinceLastTick, now);

        if (this.damageLevel == 'broken') {
            this.floodAmount = Math.min(this.buoyancy, this.floodAmount + timeSinceLastTick/1000 * 2);
        }
    }

    onDamage() {
        sound.play('breaking');
    }

    onFixed() {
        this.floodAmount = 0;
    }

    getStats() {
        const percentSubmerged = this.percentSubmerged;
        return {
            'buoyancy': percentSubmerged > 0 ? this.buoyancy * percentSubmerged - this.floodAmount: 0,
        }
    }

    render() {
        this.sprite = this.damageLevel == 'broken' ? this.bustedSprite : this.defaultSprite;
        super.render();

        // don't show indicator overlays during game over screen
        if (!this.ship.updating) return;

        if (this.renderTopHull) {
            if (this.topHullSprite) {
                this.topHullSprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT);
            }
        }

        if (this.renderLeftHull) {
            if (this.sideHullSprite) {
                this.sideHullSprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT);
            }
        }

        if (this.floodAmount > 0) {
            ctx.fillStyle = 'rgba(0, 0, 255, .5)';
            const percentFlooded = this.floodAmount / this.buoyancy;
            ctx.fillRect(0, Math.ceil(-SHIP_MODULE_HEIGHT * percentFlooded), SHIP_MODULE_WIDTH, Math.ceil(SHIP_MODULE_HEIGHT * percentFlooded));
        }
    }

    updateDisplay() {
        const moduleAbove = this.ship.getModule(this.x, this.y + 1);
        this.renderTopHull = moduleAbove && moduleAbove.solid;
        this.renderLeftHull = !!this.ship.getModule(this.x - 1, this.y, HullModule);
    }
}

class NullModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.square_bg;
    static outlineSprite = shipSpriteSheet.sprites.square_outline;
    static solid = false;
    
    showOutline = false;
    showBackground = false;
    buildOptions = [];

    constructor(ship, x, y) {
        super(ship, x, y);
        this.updateDisplay();
    }

    get weight() {
        return 0;
    }

    updateDisplay() {
        this.buildOptions.length = 0;
        for (const moduleType of moduleTypes) {
            if (this.ship.canBuildModule(this.x, this.y, moduleType)) {
                this.buildOptions.push(moduleType);
            }
        }
        this.showBackground = this.buildOptions.length > 0;
    }

    onMouseOver() {
        if (this.buildOptions.length > 0) {
            canvasEl.style.cursor = 'pointer';
            this.showOutline = true;
        }
    }

    onMouseOut() {
        canvasEl.style.cursor = 'default';
        this.showOutline = false;
    }

    onClick(x, y) {
        if (this.buildOptions.length == 0) {
            return;
        }

        sound.play('confirm');
        const menuEl = document.createElement('div');

        const headerEl = document.createElement('h1');
        headerEl.textContent = 'Construct a module';
        menuEl.appendChild(headerEl);

        menuEl.id = 'module-menu';

        const clickHandler = (ev) => {
            if (ev.target.moduleType) {
                sound.play('building');
                this.ship.addModule(this.x, this.y, ConstructionModule);

                state.doPlayerAction(1000, () => {
                    this.ship.addModule(this.x, this.y, ev.target.moduleType);
                });
            } else if (ev.target.id == 'cancel') {
                sound.play('cancel');
            }

            menuEl.remove();
            document.body.removeEventListener('click', clickHandler);
            state.paused = false;
        };
        document.body.addEventListener('click', clickHandler);

        for (const moduleType of this.buildOptions) {
            const moduleEl = document.createElement('button');
            const sprite = moduleType.sprite;
            moduleEl.moduleType = moduleType;
 
            if (sprite) {
                const div = document.createElement('div');
                div.classList.add('icon');
                div.style.background = `url(${sprite.spriteSheet.src}) no-repeat -${sprite.x}px -${sprite.y}px`;
                div.style.width = sprite.width + 'px';
                div.style.height = sprite.height + 'px';

                moduleEl.innerHTML = `<p class="description"><b>${moduleType.moduleName}</b><br>${moduleType.description}</p>`;

                moduleEl.appendChild(div);
            } else {
                moduleEl.textContent = moduleType.name;
            }

            menuEl.appendChild(moduleEl);
        }

        const cancelEl = document.createElement('button');
        cancelEl.id = 'cancel';
        cancelEl.innerHTML = '<p class="description">Cancel</p>';
        menuEl.appendChild(cancelEl);

        state.paused = true;
        document.body.appendChild(menuEl);
    }

    render() {
        if (!state.ship.updating) return;
        if (!this.showBackground) return;

        super.render();

        if (state.cooldown == 0 && this.showOutline) {
            if (this.showOutline) {
                NullModule.outlineSprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT);
            }
        }

        if (state.debug) {
            ctx.strokeStyle = 'white';
            ctx.strokeRect(0, -SHIP_MODULE_HEIGHT, SHIP_MODULE_HEIGHT, SHIP_MODULE_WIDTH);
        }
    }

    tick() {}
}

class ConstructionModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.scaffolding;
    static solid = false;
}

class SailModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.sail;
    static moduleName = 'Sail';
    static description = 'Makes you go';
    static solid = false;

    get weight() {
        return 1.5;
    }

    static canBuildAt(modX, modY) {
        // TODO: this is just notional stuff for testing the logic, feel free to change how sails work

        // cannot build at the root
        if (modY == 0) {
            return false;
        }

        // must be on top of a solid module
        const moduleBelow = state.ship.getModule(modX, modY-1);
        return moduleBelow && moduleBelow.solid;
    }

    getStats() {
        return {
            speed: this.percentSubmerged < .5 ? 1 : 0,
        }
    }
}

class BoilerModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.boiler;
    static windowSprite = shipSpriteSheet.sprites.boiler_lit_window;

    static moduleName = 'Boiler';
    static description = 'Provides steam for propellors and balloons';

    baseFragility = 1;

    get weight() {
        return 10;
    }

    static canBuildAt(modX, modY) { 
        const moduleBelow = state.ship.getModule(modX, modY - 1);
        return moduleBelow && moduleBelow.solid;
    }
        
    tick(timeSinceLastTick, now) {
        if (this.percentSubmerged >= 1) {
            return;
        }

        super.tick(timeSinceLastTick, now);
            
        if (this.isGeneratingSteam && Math.random() < .5) {
            // emitParticle(BoilerSteamParticle, 1000, this.globalX + 30, this.globalY - (SHIP_MODULE_HEIGHT * 2));
            emitParticle(BoilerSteamParticle, 1000, this.globalX + 30, this.globalY - (SHIP_MODULE_HEIGHT));
        }
    }

    onBreak() {
        sound.play('boiler-break');
    }

    get isGeneratingSteam() {
        if (this.percentSubmerged > .5)
            return false;

        return this.damageLevel != 'broken';
    }

    render() {
        super.render();

        // TODO: show damaged state
        if (this.isGeneratingSteam) {
            let bob = getWaterBob(0, 0.5, 32);
            BoilerModule.sprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT + bob);
            BoilerModule.windowSprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT + bob);
        }
    }
}

class PropellerModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.propeller;
    static moduleName = 'Propellor';
    static description = 'Makes you go <i>fast</i>. Must be attached to a functioning boiler';
    static solid = false;

    static blurSprites = [
        shipSpriteSheet.sprites.propeller_blur_1,
        shipSpriteSheet.sprites.propeller_blur_2,
    ];

    blurSprite = new AnimatedSpriteController(PropellerModule.blurSprites, performance.now());


    get weight() {
        return 2;
    }

    static canBuildAt(modX, modY) {
        const moduleLeft = state.ship.getModule(modX - 1, modY);
        return moduleLeft && moduleLeft.constructor.name == 'BoilerModule';
    }

    get isSpinning() {
        const boilerModule = state.ship.getModule(this.x - 1, this.y);
        return boilerModule && boilerModule.isGeneratingSteam;
    }

    getStats() {
        return {
            speed: this.isSpinning ? 5 : 0,
        }
    }

    render() {
        super.render();
        if (this.isSpinning) {
            this.blurSprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT);
        }
    }
}

class BalloonModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.balloon_top;
    static baseSprite = shipSpriteSheet.sprites.balloon_base;

    static moduleName = 'Balloon';
    static description = 'Makes you go <i>up</i>. Must be attached to a functioning boiler'
    static solid = false;


    get isInflated() {
        const moduleBelow = this.ship.getModule(this.x, this.y - 1);
        return moduleBelow.isGeneratingSteam;
    }

    get weight() {
        return this.isInflated ? -10 : 1;
    }

    static canBuildAt(modX, modY) {
        const moduleBelow = state.ship.getModule(modX, modY - 1);
        return moduleBelow && moduleBelow.constructor.name == 'BoilerModule';
    }

    render() {
        BalloonModule.baseSprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT);
        // TODO should animate up and down
        const inflationOffset = this.isInflated ? getWaterBob(0, 3, 400) : 48;
        BalloonModule.sprite.draw(ctx, 0, -SHIP_MODULE_HEIGHT + inflationOffset);
    }
}

class FinSailModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.fin_sail;
    static solid = false;
    static moduleName = 'Fin sail';
    static description = 'Makes you go';

    get weight() {
        return 2.5;
    }

    static canBuildAt(modX, modY) {
        const moduleRight = state.ship.getModule(modX + 1, modY);
        return moduleRight && moduleRight.solid;
    }

    getStats() {
        return {
            speed: this.percentSubmerged < .5 ? .5 : 0,
        }
    }
}

class CastleModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.castle;

    static moduleName = 'Castle';
    static description = 'Reinforces adjacent modules (and looks really cool)';
    
    weight = 20;

    static canBuildAt(modX, modY) {
        const mod = state.ship.getModule(modX, modY - 1);
        return mod && mod.solid;
    }
}

class SmokeStackModule extends ShipModule {
    static sprite = shipSpriteSheet.sprites.smoke_stack;
    static moduleName = 'Steam Stack';
    static description = 'Must be built above a boiler';
    static solid = false;

    weight = 8;

    static canBuildAt(modX, modY) {
        const mod = state.ship.getModule(modX, modY - 1, BoilerModule);
        return mod && mod.solid;
    }

    tick() {
        super.tick();

        const boiler = this.ship.getModule(this.x, this.y - 1, BoilerModule);
        if (boiler && boiler.isGeneratingSteam && Math.random() < .5) {
            emitParticle(BoilerSteamParticle, 1000, this.globalX + 30, this.globalY - (SHIP_MODULE_HEIGHT * 2));
        }
    }
}

const moduleTypes = [HullModule, SailModule, BoilerModule, PropellerModule, FinSailModule, BalloonModule, CastleModule, SmokeStackModule];


class Ship extends Entity {
    columns = 5;
    rows = 1;

    modules = [];

    constructor() {
        super();
        const ship = this;
        this.box = {
            // position is anchored to the bottom left corner of the ship
            x: SHIP_MODULE_WIDTH / 2,
            get y() { return CANVAS_HEIGHT - currentWaterHeight + state.shipDraught },
            get width() { return ship.columns * SHIP_MODULE_WIDTH },
            get height() { return ship.modules.length * SHIP_MODULE_HEIGHT },
        }
    }

    tick(timeSinceLastTick, now) {
        for (const [modY, row] of this.modules.entries()) {
            for (const module of row) {
                if (module) {
                    module.tick(timeSinceLastTick, now);
                }
            }
        }
    }

    render(now) {
        ctx.save();
        ctx.translate(0, getWaterBob(250, 3));

        const { box } = this;

        let y = this.rows;
        while (y-->0) {
            const row = this.modules[y];
            for (let x = 0; x < this.columns; x++) {
                const translateX = box.x + (x * SHIP_MODULE_WIDTH);
                const translateY = box.y + (y * -SHIP_MODULE_HEIGHT);

                ctx.translate(translateX, translateY);
                
                const module = row ? row[x] : null;
                if (module) {
                    module.render(now);
                }
                if (state.debug) {
                    ctx.fillStyle = 'white';
                    ctx.fillText(`${module.damage.toFixed(2)}`, 0, -SHIP_MODULE_HEIGHT);
                }
                ctx.translate(-translateX, -translateY);
            }
        }

        ctx.restore();
    }

    checkClick(mouseX, mouseY) {
        if (!state.gameRunning) return;
        const { x, y } = this.box;

        const moduleBox = { x: 0, y: 0, width: SHIP_MODULE_WIDTH, height: SHIP_MODULE_HEIGHT };

        for (let modY = 0; modY < this.rows; modY++) {
            const row = this.modules[modY];

            // can't click on stuff that's underwater
            if ((modY+1) * SHIP_MODULE_HEIGHT < state.shipDraught) {
                continue;
            }

            for (let modX = 0; modX < this.columns; modX++) {
                moduleBox.x = x + (modX * SHIP_MODULE_WIDTH);
                moduleBox.y = y + ((modY + 1) * -SHIP_MODULE_HEIGHT);

                if (isPointInBox(mouseX, mouseY, moduleBox)) {
                    const module = row ? row[modX] : null;
                    return module;
                }
            }
        }
    }

    getStats() {
        const stats = {weight: 0};
        for (const [modY, row] of this.modules.entries()) {

            for (const [modX, module] of row.entries()) {
                stats.weight += module.weight;
                const moduleStats = module.getStats();
                for (const key in moduleStats) {
                    stats[key] = (stats[key] || 0) + moduleStats[key];
                }
            }
        }
        return stats;
    }

    canBuildModule(x, y, ModuleClass) {
        if (ModuleClass.solid && (x === 0 || x === this.columns - 1)) {
            return false;
        }
        const res =  ModuleClass.canBuildAt(x, y);
        return res;
    }

    addModule(x, y, ModuleClass) {
        if (y + 1 >= this.rows) this.rows = y + 2;

        for (let yOffset = 0; yOffset < 2; yOffset++) {
            if (!this.modules[y+yOffset]) {
                const newRow = [];
                for (let i = 0; i<this.columns; i++) {
                    newRow.push(new NullModule(this, i, y+yOffset));
                }
                this.modules[y+yOffset] = newRow;
            }
        }
        this.modules[y][x] = new ModuleClass(this, x, y);

        this.updateModule(x - 1, y);
        this.updateModule(x + 1, y);
        this.updateModule(x, y - 1);
        this.updateModule(x, y + 1);

        emitParticle(SteamParticle, 1000, this.globalX, this.globalY);
    }

    updateModule(x, y) {
        const module = this.getModule(x, y);
        if (module) module.updateDisplay();
    }

    get moduleCount() {
        let moduleCount = 0;
        for (const row of this.modules) {
            for (const module of row) {
                if (module.constructor.name != 'NullModule') {
                    moduleCount += 1;
                }
            }
        }
        return moduleCount;
    }

    getModule(x, y, ModuleClass = undefined) {
        if (!this.modules[y]) return;
        const module = this.modules[y][x];
        if (ModuleClass && !(module instanceof ModuleClass)) return;
        return module;
    }
}

class Water extends Entity {
    constructor(height, alpha, parallaxSpeed, x_offset) {
        super();
        this.height = height;
        this.alpha = alpha;
        this.parallaxSpeed = parallaxSpeed;
        this.x_offset = x_offset;
    }

    render(now) {
        ctx.globalAlpha = this.alpha;
        const yPosition = CANVAS_HEIGHT - this.height - 75 - currentWaterHeight + getWaterBob();
        drawParallax(window.wavesImg, this.parallaxSpeed, this.x_offset, yPosition);
        const imgHeight = wavesImg.height;
        if (yPosition + imgHeight < CANVAS_HEIGHT) {
            ctx.fillStyle = '#96b3d1';
            ctx.fillRect(0, Math.max(0, yPosition + imgHeight), CANVAS_WIDTH, CANVAS_HEIGHT);
        }
        ctx.globalAlpha = 1;
    }
}

class DebugDisplay extends Entity {
    constructor() {
        super();
        this.stateKeys = Object.keys(state);
        this.stateKeys.push('shipHeight');
        this.stateKeys.push('difficultyCoefficient');
    }
    render() {
        if (!state.debug) return;
        ctx.fillStyle = 'black';
        ctx.font = '24px sans-serif';

        let offsetY = 75;
        for (let key of this.stateKeys) {
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

class ShipUI extends Entity {
    zIndex = 200;

    constructor(ship) {
        super();
        this.ship = ship;
    }

    render() {
        if (!this.ship.updating || !state.gameRunning) return;

        for (let y = 0; y < this.ship.rows; y++) {
            for (let x = 0; x < this.ship.columns; x++) {
                const shipModule = this.ship.getModule(x, y);
                if (shipModule && shipModule.icon) {
                    const spriteX = shipModule.globalX + (SHIP_MODULE_WIDTH / 2);
                    const spriteY = shipModule.globalY - (SHIP_MODULE_HEIGHT / 2)
                    shipSpriteSheet.sprites.icon_bg.draw(ctx, spriteX, spriteY);
                    shipModule.icon.draw(ctx, spriteX, spriteY);
                }
            }
        }
    }
}

function emitParticle(ParticleClass, life, x, y) {
    entities.push(
        new ParticleClass(performance.now() + life, x, y),
    );
}

class Particle extends Entity {
    speed = 5;
    forceVector = VECTOR_UP;
    direction = cloneVector(VECTOR_UP);
    sprite = null;
    
    constructor(liveUntil, x, y) {
        super();
        this.created = performance.now();
        this.liveUntil = liveUntil;
        this.x = x;
        this.y = y;
    }

    tick(deltaT, t) {
        if (t > this.liveUntil) {
            this.alive = false;
            return;
        }

        const move = scaleVector(this.direction, this.speed);
        addVectors(this, move);

        this.direction = normalizeVector(
            addVectors(
                this.direction,
                this.forceVector,
            ),
        );
    }

    render(t) {
        if (!this.sprite) return;
        if (!this.alive || t > this.liveUntil) return;

        const currentT = t - this.created;
        const targetT = this.liveUntil - this.created;
        ctx.globalAlpha = 1 - (currentT / targetT);
        this.sprite.draw(ctx, this.x, this.y);
        ctx.globalAlpha = 1;
    }
}

class SteamParticle extends Particle {
    sprite = shipSpriteSheet.sprites.steam_puff;

    direction = normalizeVector({
        x: (Math.random() * 2) - 1,
        y: (Math.random() * 2) - 1,
    });

    tick(deltaT, t) {
        super.tick(deltaT, t);
        this.x -= state.speed;
    }
}

class BoilerSteamParticle extends SteamParticle {
    direction = normalizeVector({
        x: (Math.random() * 2) - 1,
        y: -1,
    });
}

class SprayParticle extends Particle {
    sprite = shipSpriteSheet.sprites.water_spray;
    forceVector = VECTOR_DOWN;
    speed = 10;

    direction = normalizeVector({
        x: -Math.random(),
        y: -1,
    });
}

let previousTick;
let tickTimer;

function tick() {
    const now = performance.now();
    const timeSinceLastTick = Math.min(now - previousTick, 1000);

    if (!state.paused) {
        let livingEntities = 0;
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            if (!entity.alive) continue;
            if (entity.updating) entity.tick(timeSinceLastTick, now);
            entities[livingEntities] = entity;
            livingEntities++;
        }
        
        entities.length = livingEntities;
        state.timeElapsed += timeSinceLastTick;
    }

    previousTick = now;
}

let firstFrame;
let previousFrame;

function render(now) {
    entities.sort((a, b) => a.zIndex - b.zIndex);

    for (let entity of entities) {
        if (entity.visible) entity.render(now);
    }

    previousFrame = now;
    requestAnimationFrame(render);
}

function bezier(t)
{
    return 1 - (t * t * (3.0 - 2.0 * t));
}

class TitleScreen extends Entity {
    zIndex = 1000;
    canClickWhilePaused = true;
    fadeStart = 0;
    fadeUntil = 0;

    checkClick(x, y) { return this; }

    onClick(x, y) {
        if (this.fadeStart) return;

        this.fadeStart = performance.now();
        this.fadeUntil = this.fadeStart + 500;
    }

    tick(deltaT, now) {
        if (!this.fadeStart || now < this.fadeUntil) return;

        this.alive = false;

        // Fade out title music, start main music
        var current_t = 0.0;
        var interval = 0.2;
        var fade_time = 3.0;
        var fadeAudio = setInterval(function () {
            if (sound.theme_song.volume > 0.0) {
                sound.theme_song.volume = bezier(current_t);
            }
            current_t += interval / fade_time;
            if (sound.theme_song.volume <= 0.0) {
                sound.theme_song.pause();
                clearInterval(fadeAudio);
                setTimeout(function () {sound.main_song.play();}, 1000)
            }
        }, interval * 1000);

        state.ship.updating = true;

        entities.push(new DebugDisplay());
    }

    render(now) {
        ctx.save();

        if (this.fadeStart) {
            const fadeTime = Math.min(now, this.fadeUntil) - this.fadeStart;
            const fadeProgress = fadeTime / (this.fadeUntil - this.fadeStart);
            ctx.globalAlpha = 1 - fadeProgress;
        }

        ctx.fillStyle = '#242738';
	    ctx.textAlign = "center";
        ctx.font = `87pt ${FONT_STACK}`;
        let text = 'I Sink Not';
        let textMetrics = ctx.measureText(text);
        let yPosition = CANVAS_WIDTH / 5;
	    ctx.fillText(text, CANVAS_WIDTH / 2, yPosition);
        ctx.font = `24pt ${FONT_STACK}`;

        yPosition += textMetrics.actualBoundingBoxAscent + 15;
        text = 'A game for Ludum Dare 50 by';
        textMetrics = ctx.measureText(text);
        ctx.fillText(text, CANVAS_WIDTH / 2, yPosition);
        
        yPosition += textMetrics.actualBoundingBoxAscent + 15;
        text = 'Dan Ellis, Matt Lee, and Neil Williams';
        ctx.fillText(text, CANVAS_WIDTH / 2, yPosition);
        
        yPosition += textMetrics.actualBoundingBoxAscent + 15;
        ctx.font = `italic 24pt ${FONT_STACK}`;
        text = '“Delay the inevitable”';
        ctx.fillText(text, CANVAS_WIDTH / 2, yPosition);

        yPosition += (textMetrics.actualBoundingBoxAscent + 15) * 2;
        ctx.font = `24pt ${FONT_STACK}`;
        ctx.fillText('Click anywhere to start', CANVAS_WIDTH / 2, yPosition);

        ctx.restore();
    }
}

class GameOverScreen extends Entity {
    zIndex = 1000;
    canClickWhilePaused = true;

    constructor(timeElapsed) {
        super();
        this.timeElapsed = timeElapsed;
        state.cooldown = 0;
    }

    checkClick(x, y) { return this; }

    render(now) {
        const timeSinceLastFrame = now - previousFrame;
        currentWaterHeight += timeSinceLastFrame / 10;

        ctx.font = `36pt ${FONT_STACK}`;
        ctx.fillStyle = '#242738';

        let yPos = 100;
        const margin = 10;

        const titleText = 'It was bound to happen'
        const titleMetrics = ctx.measureText(titleText);
        const leftEdge = CANVAS_WIDTH - titleMetrics.width - 25;
        ctx.fillText(titleText, leftEdge, yPos);
        yPos += titleMetrics.actualBoundingBoxAscent + margin;
        ctx.font = `24pt ${FONT_STACK}`;

        yPos += margin * 4;

        const timeText = `Time: ${Math.floor(this.timeElapsed / 1000)}s`;
        const timeMetrics = ctx.measureText(timeText);
        ctx.fillText(timeText, leftEdge, yPos);
        yPos += timeMetrics.actualBoundingBoxAscent + margin;

        const distanceText = `Distance: ${Math.floor(state.distanceTraveled)}m`;
        const distanceMetrics = ctx.measureText(distanceText);
        ctx.fillText(distanceText, leftEdge, yPos);
        yPos += distanceMetrics.actualBoundingBoxAscent + margin;

        const modulesText = `Modules: ${state.ship.moduleCount}`;
        const modulesMetrics = ctx.measureText(modulesText);
        ctx.fillText(modulesText, leftEdge, yPos);
        yPos += modulesMetrics.actualBoundingBoxAscent + margin;

        yPos += margin * 4;

        ctx.fillText('Click anywhere to try again', leftEdge, yPos);
    }

    onClick() {
        this.alive = false;
        currentWaterHeight = DEFAULT_WATER_HEIGHT;
        setUp(canvasEl);
    }
}

/**************/

export function setUp(canvasEl_) {
    canvasEl = canvasEl_;
    CANVAS_WIDTH = canvasEl.width;
    CANVAS_HEIGHT = canvasEl.height;

    const ship = new Ship();

    ship.updating = false;

    state = new State(ship);

    ctx = canvasEl.getContext('2d');

    entities.length = 0;

    entities.push(new GameController());
    entities.push(new TitleScreen());

    document.addEventListener('keydown', ev => {
        if (ev.code == 'Space') {
            state.paused = !state.paused;
        } else if (ev.code == 'KeyD') {
            state.debug = !state.debug;
        }
    });

    ship.addModule(2, 0, HullModule);

    entities.push(new Water(10, 1, .1, 0));

    entities.push(ship);
    entities.push(new ShipUI(ship));

    const foregroundWater = new Water(0, .5, .15, -150);
    foregroundWater.zIndex = 100;
    entities.push(foregroundWater);

    const now = performance.now();
    previousTick = now;
    tickTimer = setInterval(tick, 100);

    firstFrame = now;
    previousFrame = firstFrame;
    render(firstFrame);

    canvasEl.onclick = onClick;
    canvasEl.onmousemove = onMouseMove;
}

function tearDown(canvasEl) {
    clearInterval(tickTimer);
    canvasEl.onclick = null;
    canvasEl.onmousemove = null;
}

window._debug = {
    get state() { return state },
    entities,
}

export function pause() {
    state.paused = true;
}

export function play() {
    state.paused = false;
}
