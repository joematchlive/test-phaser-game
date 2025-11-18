import Phaser from 'phaser';
import { GameSettings, getActiveSettings, getLevelById, LevelSchema } from '../state/settings';
import { Overlay, ScoreState } from '../ui/overlay';

type Player = {
  id: string;
  label: string;
  color: number;
  shape: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.Body;
  score: number;
  wins: number;
  dashKey: Phaser.Input.Keyboard.Key;
  hookKey: Phaser.Input.Keyboard.Key;
  controls: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  speedMultiplier: number;
  speedResetTimer?: Phaser.Time.TimerEvent;
  activeEffect?: PlayerEffect;
  hookCharges: number;
  maxHookCharges: number;
};

type PlayerEffect = {
  type: 'boost' | 'slow' | 'cloak';
  aura?: Phaser.GameObjects.Arc;
  expires: number;
  duration: number;
  color: number;
};

type BehaviorEffect = 'boost' | 'slow' | 'cloak' | 'disrupt';

const PLAYER_SPEED = 220;
const DASH_SPEED = 420;
const DASH_COOLDOWN = 800;
const DASH_DURATION = 180;
const HOOK_RANGE = 280;
const HOOK_DURATION = 320;
const HOOK_PULL_STRENGTH = 140;
const HOOK_PULL_DECAY = 0.7;
const HOOK_BREAK_DISTANCE = 56;
const SHOOTER_RECOIL_FACTOR = 0.82;
const HOOK_COOLDOWN = 1800;
const MAX_HOOK_CHARGES = 3;
const ROPE_PICKUP_LIMIT = 1;
const ROPE_RESPAWN_DELAY = 12000;
const MAX_SPAWN_ATTEMPTS = 30;
const CLOAK_DURATION = 4500;
const DISRUPT_DURATION = 3500;

export class ArenaScene extends Phaser.Scene {
  private overlay?: Overlay;
  private players: Player[] = [];
  private energy?: Phaser.Physics.Arcade.Group;
  private rareEnergy?: Phaser.Physics.Arcade.Group;
  private hazards?: Phaser.Physics.Arcade.Group;
  private behaviorPickups?: Phaser.Physics.Arcade.Group;
  private ropePickups?: Phaser.Physics.Arcade.Group;
  private obstacles?: Phaser.Physics.Arcade.StaticGroup;
  private movingObstacles?: Phaser.Physics.Arcade.Group;
  private lastDash: Record<string, number> = {};
  private dashState: Record<string, { direction: Phaser.Math.Vector2; until: number } | undefined> = {};
  private hookTimers: Record<string, number> = {};
  private activeHooks: Record<
    string,
    { target: Player; tether: Phaser.GameObjects.Line; expires: number } | undefined
  > = {};
  private settings!: GameSettings;
  private level!: LevelSchema;
  private escapeKey?: Phaser.Input.Keyboard.Key;
  private matchWins: Record<string, number> = {};
  private roundOver = false;

  constructor() {
    super('Arena');
  }

  create(): void {
    this.settings = getActiveSettings();
    this.level = getLevelById(this.settings.levelId);

    // Ensure the scene restarts from a clean state by clearing player and dash tracking
    this.players = [];
    this.lastDash = {};
    this.dashState = {};
    this.hookTimers = {};
    this.activeHooks = {};
    this.roundOver = false;
    // Reset group references so we don't access destroyed children during restart
    this.energy = undefined;
    this.rareEnergy = undefined;
    this.hazards = undefined;
    this.behaviorPickups = undefined;
    this.ropePickups = undefined;
    this.obstacles = undefined;
    this.movingObstacles = undefined;

    this.createBackground();
    this.overlay = new Overlay({
      targetScore: this.settings.winningScore,
      negativeLossThreshold: this.settings.negativeLossThreshold
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.overlay?.destroy();
      this.overlay = undefined;
      this.escapeKey?.destroy();
      this.escapeKey = undefined;
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.overlay?.destroy();
      this.overlay = undefined;
      this.escapeKey?.destroy();
      this.escapeKey = undefined;
    });

    this.escapeKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escapeKey?.on('down', () => this.scene.start('Menu'));

    const spawnPoints = this.level.spawnPoints.length
      ? this.level.spawnPoints
      : [
          { x: this.scale.width * 0.25, y: this.scale.height * 0.3 },
          { x: this.scale.width * 0.75, y: this.scale.height * 0.7 }
        ];

    const playerConfigs = [
      {
        id: 'p1',
        label: 'Pilot One',
        color: 0x7f5af0,
        keys: this.createKeys(['W', 'S', 'A', 'D']),
        dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        hook: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)
      },
      {
        id: 'p2',
        label: 'Pilot Two',
        color: 0xff8906,
        keys: this.createKeys(['UP', 'DOWN', 'LEFT', 'RIGHT']),
        dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
        hook: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P)
      }
    ];

    playerConfigs.forEach((config, index) => {
      const spawn = spawnPoints[index % spawnPoints.length] ?? { x: 400, y: 300 };
      if (typeof this.matchWins[config.id] !== 'number') {
        this.matchWins[config.id] = 0;
      }
      this.players.push(
        this.createPlayer({
          ...config,
          x: spawn.x,
          y: spawn.y,
          wins: this.matchWins[config.id]
        })
      );
    });

    this.obstacles = this.physics.add.staticGroup();
    this.createObstacles();

    this.movingObstacles = this.physics.add.group({ immovable: true });
    this.createMovingObstacles();

    this.energy = this.physics.add.group();
    this.rareEnergy = this.physics.add.group();
    this.hazards = this.physics.add.group();
    this.behaviorPickups = this.physics.add.group();
    this.ropePickups = this.physics.add.group();

    this.spawnEnergyOrbs(this.settings.energyCount);
    this.spawnRareEnergy(this.settings.rareEnergyCount);
    this.spawnHazards();
    this.spawnBehaviorPickups(this.settings.behaviorPickupCount);
    this.spawnRopePickups(ROPE_PICKUP_LIMIT);

    const playerShapes = this.players.map((p) => p.shape);
    if (this.obstacles) {
      this.physics.add.collider(playerShapes, this.obstacles);
      if (this.hazards) {
        this.physics.add.collider(this.hazards, this.obstacles);
      }
    }
    if (this.movingObstacles) {
      this.physics.add.collider(playerShapes, this.movingObstacles);
      this.physics.add.collider(this.movingObstacles, this.movingObstacles);
      if (this.hazards) {
        this.physics.add.collider(this.hazards, this.movingObstacles);
      }
    }
    this.physics.add.collider(playerShapes, playerShapes);

    this.physics.add.overlap(playerShapes, this.energy, (_playerShape, energy) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const orb = energy as Phaser.GameObjects.Arc;
      if (!player || !orb.active) {
        return;
      }

      orb.destroy();
      player.score += 1;
      this.evaluateScore(player);
      if (!this.roundOver) {
        this.spawnEnergyOrbs(1);
      }
    });

    this.physics.add.overlap(playerShapes, this.rareEnergy, (_playerShape, energy) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const orb = energy as Phaser.GameObjects.Arc;
      if (!player || !orb.active) return;
      orb.destroy();
      player.score += 3;
      this.evaluateScore(player);
      if (!this.roundOver) {
        this.spawnRareEnergy(1);
      }
    });

    this.physics.add.overlap(playerShapes, this.hazards, (_playerShape, hazard) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const orb = hazard as Phaser.GameObjects.Arc;
      if (!player || !orb.active) return;
      orb.destroy();
      player.score -= 2;
      this.applyHazardPenalty(player);
      this.evaluateScore(player);
      if (!this.roundOver) {
        this.spawnHazards(1);
      }
    });

    this.physics.add.overlap(playerShapes, this.behaviorPickups, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      if (!player) return;
      const item = pickup as Phaser.GameObjects.Shape;
      const effect = (item.getData('effect') as BehaviorEffect | undefined) ?? 'boost';
      item.destroy();
      switch (effect) {
        case 'boost':
          this.applySpeedModifier(player, 1.5, 3500, 'boost');
          break;
        case 'slow':
          this.applySpeedModifier(player, 0.6, 3500, 'slow');
          break;
        case 'cloak':
          this.applyCloak(player, CLOAK_DURATION);
          break;
        case 'disrupt':
          this.applyDisruptEffect(player);
          break;
        default:
          break;
      }
      this.spawnBehaviorPickups(1);
    });

    this.physics.add.overlap(playerShapes, this.ropePickups, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const rope = pickup as Phaser.GameObjects.Shape;
      if (!player || !rope.active) return;
      rope.destroy();
      this.adjustHookCharges(player, 1);
      this.time.delayedCall(ROPE_RESPAWN_DELAY, () => this.spawnRopePickups(1));
    });
  }

  update(): void {
    this.players.forEach((player) => {
      this.updatePlayerMovement(player);
      this.updateEffectAura(player);
    });
    this.updateHooks();
    this.overlay?.update(this.players.map((player) => this.toScoreState(player)));
  }

  private updatePlayerMovement(player: Player): void {
    const body = player.body;
    const { up, down, left, right } = player.controls;

    if (this.roundOver) {
      body.setVelocity(0, 0);
      return;
    }

    const dashInfo = this.dashState[player.id];
    if (dashInfo && dashInfo.until > this.time.now) {
      body.setVelocity(dashInfo.direction.x * DASH_SPEED, dashInfo.direction.y * DASH_SPEED);
      return;
    }
    if (dashInfo && dashInfo.until <= this.time.now) {
      this.dashState[player.id] = undefined;
    }

    const velocity = new Phaser.Math.Vector2(0, 0);
    if (up.isDown) velocity.y -= 1;
    if (down.isDown) velocity.y += 1;
    if (left.isDown) velocity.x -= 1;
    if (right.isDown) velocity.x += 1;

    velocity.normalize();
    body.setVelocity(velocity.x * PLAYER_SPEED * player.speedMultiplier, velocity.y * PLAYER_SPEED * player.speedMultiplier);

    const dashReady = this.time.now - (this.lastDash[player.id] ?? 0) >= DASH_COOLDOWN;
    const hasInput = velocity.lengthSq() > 0;
    if (dashReady && hasInput && Phaser.Input.Keyboard.JustDown(player.dashKey)) {
      const direction = velocity.clone();
      this.dashState[player.id] = { direction, until: this.time.now + DASH_DURATION };
      this.lastDash[player.id] = this.time.now;
      body.setVelocity(direction.x * DASH_SPEED, direction.y * DASH_SPEED);
      this.addDashBurst(player.shape.x, player.shape.y, player.color);
    }

    if (Phaser.Input.Keyboard.JustDown(player.hookKey)) {
      this.attemptHook(player);
    }
  }

  private createBackground(): void {
    const g = this.add.graphics({ fillStyle: { color: 0x242629 } });
    g.fillRect(0, 0, this.scale.width, this.scale.height);

    const grid = this.add.graphics({ lineStyle: { width: 1, color: 0x2cb67d, alpha: 0.2 } });
    for (let x = 0; x < this.scale.width; x += 64) {
      grid.lineBetween(x, 0, x, this.scale.height);
    }
    for (let y = 0; y < this.scale.height; y += 64) {
      grid.lineBetween(0, y, this.scale.width, y);
    }
  }

  private createPlayer(config: {
    id: string;
    label: string;
    color: number;
    x: number;
    y: number;
    keys: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    dash: Phaser.Input.Keyboard.Key;
    hook: Phaser.Input.Keyboard.Key;
    wins: number;
  }): Player {
    const shape = this.add.rectangle(config.x, config.y, 48, 48, config.color, 0.9);
    this.physics.add.existing(shape);
    const body = shape.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);

    return {
      id: config.id,
      label: config.label,
      color: config.color,
      shape,
      body,
      score: 0,
      wins: config.wins,
      controls: config.keys,
      dashKey: config.dash,
      hookKey: config.hook,
      speedMultiplier: 1,
      hookCharges: MAX_HOOK_CHARGES,
      maxHookCharges: MAX_HOOK_CHARGES
    };
  }

  private createKeys(keys: [string, string, string, string]): Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key> {
    return {
      up: this.input.keyboard!.addKey(keys[0]),
      down: this.input.keyboard!.addKey(keys[1]),
      left: this.input.keyboard!.addKey(keys[2]),
      right: this.input.keyboard!.addKey(keys[3])
    } as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  }

  private spawnEnergyOrbs(count?: number): void {
    if (!this.energy) return;
    const amount = count ?? this.settings?.energyCount ?? 5;
    for (let i = 0; i < amount; i += 1) {
      const position = this.findSpawnPosition(12);
      if (!position) continue;
      const orb = this.add.circle(position.x, position.y, 10, 0x2cb67d, 0.8);
      this.physics.add.existing(orb);
      this.energy.add(orb);
    }
  }

  private spawnRareEnergy(count?: number): void {
    if (!this.rareEnergy) return;
    const amount = count ?? this.settings?.rareEnergyCount ?? 1;
    for (let i = 0; i < amount; i += 1) {
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const orb = this.add.star(position.x, position.y, 5, 8, 14, 0xffd803, 0.9);
      this.physics.add.existing(orb);
      this.rareEnergy.add(orb);
    }
  }

  private spawnHazards(count?: number): void {
    if (!this.hazards) return;
    const amount = count ?? this.getHazardTargetCount();
    for (let i = 0; i < amount; i += 1) {
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const orb = this.add.circle(position.x, position.y, 12, 0xff5470, 0.9);
      this.physics.add.existing(orb);
      const body = orb.body as Phaser.Physics.Arcade.Body;
      body.setCircle(12);
      const speed = this.settings.mode === 'minefield' ? 110 : 40;
      body.setVelocity(Phaser.Math.Between(-speed, speed), Phaser.Math.Between(-speed, speed));
      body.setBounce(1, 1);
      body.setCollideWorldBounds(true);
      this.hazards.add(orb);
    }
  }

  private getHazardTargetCount(): number {
    const base = this.settings?.hazardCount ?? 2;
    if (this.settings.mode === 'minefield') {
      return Math.max(base * 3, base + 4);
    }
    return base;
  }

  private spawnBehaviorPickups(count?: number): void {
    if (!this.behaviorPickups) return;
    const effects: BehaviorEffect[] = ['boost', 'slow', 'cloak', 'disrupt'];
    const amount = count ?? this.settings?.behaviorPickupCount ?? 2;
    for (let i = 0; i < amount; i += 1) {
      const position = this.findSpawnPosition(14);
      if (!position) continue;
      const effect = effects[(i + Phaser.Math.Between(0, effects.length - 1)) % effects.length];
      const color = this.getBehaviorColor(effect);
      const sides = effect === 'cloak' ? 4 : effect === 'disrupt' ? 5 : 6;
      const pickup = this.add.polygon(position.x, position.y, this.createRegularPolygonPoints(sides, 16), color, 0.85);
      pickup.setData('effect', effect);
      this.physics.add.existing(pickup);
      this.behaviorPickups.add(pickup);
    }
  }

  private spawnRopePickups(count?: number): void {
    if (!this.ropePickups) return;
    const amount = count ?? 1;
    for (let i = 0; i < amount; i += 1) {
      if (this.ropePickups.countActive(true) >= ROPE_PICKUP_LIMIT) {
        break;
      }
      const position = this.findSpawnPosition(12);
      if (!position) continue;
      const pickup = this.add.star(position.x, position.y, 5, 6, 12, 0xffd803, 0.9);
      pickup.setStrokeStyle(2, 0x0f0e17, 0.8);
      this.physics.add.existing(pickup);
      this.ropePickups.add(pickup);
    }
  }

  private addDashBurst(x: number, y: number, color: number): void {
    const particles = this.add.particles(x, y, undefined, {
      speed: { min: -100, max: 100 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 300,
      tint: color
    });
    this.time.delayedCall(300, () => particles.destroy());
  }

  private applySpeedModifier(player: Player, multiplier: number, duration: number, type: 'boost' | 'slow'): void {
    player.speedMultiplier = multiplier;
    player.speedResetTimer?.remove(false);
    this.setPlayerEffect(player, type, duration);
    player.speedResetTimer = this.time.delayedCall(duration, () => {
      player.speedMultiplier = 1;
      player.speedResetTimer = undefined;
      this.clearPlayerEffect(player);
    });
  }

  private applyCloak(player: Player, duration: number): void {
    this.setPlayerEffect(player, 'cloak', duration, 0xffffff, { showAura: false });
    player.shape.setAlpha(0.05);
    player.shape.setStrokeStyle(1, 0xffffff, 0.2);
    player.shape.setBlendMode(Phaser.BlendModes.ADD);
    this.time.delayedCall(duration, () => {
      if (player.activeEffect?.type === 'cloak') {
        this.clearPlayerEffect(player);
      }
    });
  }

  private applyDisruptEffect(player: Player): void {
    const opponent = this.players.find((p) => p.id !== player.id);
    if (!opponent) return;
    this.applySpeedModifier(opponent, 0.55, DISRUPT_DURATION, 'slow');
    this.addStatusPing(opponent.shape.x, opponent.shape.y, this.getBehaviorColor('disrupt'));
  }

  private addStatusPing(x: number, y: number, color: number): void {
    const pulse = this.add.circle(x, y, 10, color, 0.4);
    this.tweens.add({
      targets: pulse,
      scale: { from: 0.5, to: 2.5 },
      alpha: { from: 0.6, to: 0 },
      duration: 420,
      onComplete: () => pulse.destroy()
    });
  }

  private adjustHookCharges(player: Player, delta: number): void {
    const next = Phaser.Math.Clamp(player.hookCharges + delta, 0, player.maxHookCharges);
    const gained = next > player.hookCharges;
    player.hookCharges = next;
    if (gained) {
      this.addStatusPing(player.shape.x, player.shape.y, 0xffd803);
    }
  }

  private setPlayerEffect(
    player: Player,
    type: PlayerEffect['type'],
    duration: number,
    tint?: number,
    options?: { showAura?: boolean }
  ): void {
    this.clearPlayerEffect(player);
    const color = tint ?? this.getEffectColor(type);
    const shouldShowAura = options?.showAura ?? type !== 'cloak';
    let aura: Phaser.GameObjects.Arc | undefined;
    if (shouldShowAura) {
      aura = this.add.circle(player.shape.x, player.shape.y, 34, color, 0.06);
      aura.setStrokeStyle(3, color, 0.9);
      aura.setDepth(2);
    }
    player.activeEffect = { type, aura, expires: this.time.now + duration, duration, color };
  }

  private clearPlayerEffect(player: Player): void {
    if (player.activeEffect?.type === 'cloak') {
      player.shape.setAlpha(1);
      player.shape.setStrokeStyle();
      player.shape.setBlendMode(Phaser.BlendModes.NORMAL);
    }
    player.activeEffect?.aura?.destroy();
    player.activeEffect = undefined;
  }

  private updateEffectAura(player: Player): void {
    if (!player.activeEffect || !player.activeEffect.aura) return;
    const remaining = player.activeEffect.expires - this.time.now;
    if (remaining <= 0) {
      this.clearPlayerEffect(player);
      return;
    }
    const percent = Phaser.Math.Clamp(remaining / player.activeEffect.duration, 0, 1);
    player.activeEffect.aura.setPosition(player.shape.x, player.shape.y);
    player.activeEffect.aura.setScale(0.9 + percent * 0.35);
    player.activeEffect.aura.setAlpha(0.25 + percent * 0.6);
  }

  private attemptHook(player: Player): void {
    if (this.roundOver) {
      return;
    }
    if (this.time.now - (this.hookTimers[player.id] ?? 0) < HOOK_COOLDOWN) {
      return;
    }
    if (player.hookCharges <= 0) {
      this.addStatusPing(player.shape.x, player.shape.y, 0xff5470);
      return;
    }
    const target = this.players.find((p) => p.id !== player.id);
    if (!target) return;
    const distance = Phaser.Math.Distance.Between(player.shape.x, player.shape.y, target.shape.x, target.shape.y);
    if (distance > HOOK_RANGE) {
      return;
    }

    this.activeHooks[player.id]?.tether.destroy();
    const tether = this.add.line(0, 0, 0, 0, 0, 0, player.color, 0.75);
    tether.setOrigin(0, 0);
    tether.setLineWidth(2, 2);
    tether.setDepth(1);
    tether.setTo(player.shape.x, player.shape.y, target.shape.x, target.shape.y);
    this.activeHooks[player.id] = { target, tether, expires: this.time.now + HOOK_DURATION };
    this.hookTimers[player.id] = this.time.now;
    this.adjustHookCharges(player, -1);
  }

  private updateHooks(): void {
    Object.entries(this.activeHooks).forEach(([playerId, hook]) => {
      if (!hook) return;
      const shooter = this.players.find((p) => p.id === playerId);
      if (!shooter) {
        this.releaseHook(playerId);
        return;
      }
      if (hook.expires <= this.time.now || this.roundOver) {
        this.releaseHook(playerId);
        return;
      }
      hook.tether.setTo(shooter.shape.x, shooter.shape.y, hook.target.shape.x, hook.target.shape.y);
      const pullVector = new Phaser.Math.Vector2(shooter.shape.x - hook.target.shape.x, shooter.shape.y - hook.target.shape.y);
      const distance = pullVector.length();
      if (distance < HOOK_BREAK_DISTANCE) {
        this.releaseHook(playerId);
        return;
      }
      if (pullVector.lengthSq() > 0) {
        const direction = pullVector.normalize();
        const falloff = Phaser.Math.Clamp((hook.expires - this.time.now) / HOOK_DURATION, 0, 1);
        const tug = Phaser.Math.Linear(HOOK_PULL_STRENGTH * 0.4, HOOK_PULL_STRENGTH, falloff);
        const targetBody = hook.target.body;
        const dampenedVelocity = new Phaser.Math.Vector2(targetBody.velocity.x, targetBody.velocity.y).scale(HOOK_PULL_DECAY);
        const nextVelocity = dampenedVelocity.add(direction.scale(tug));
        targetBody.setVelocity(nextVelocity.x, nextVelocity.y);
        shooter.body.setVelocity(shooter.body.velocity.x * SHOOTER_RECOIL_FACTOR, shooter.body.velocity.y * SHOOTER_RECOIL_FACTOR);
      }
    });
  }

  private releaseHook(playerId: string): void {
    const hook = this.activeHooks[playerId];
    if (!hook) return;
    hook.tether.destroy();
    this.activeHooks[playerId] = undefined;
  }

  private findSpawnPosition(radius: number): Phaser.Math.Vector2 | undefined {
    for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i += 1) {
      const x = Phaser.Math.Between(radius, this.scale.width - radius);
      const y = Phaser.Math.Between(radius, this.scale.height - radius);
      const circle = new Phaser.Geom.Circle(x, y, radius);
      if (!this.circleOverlapsShapes(circle)) {
        return new Phaser.Math.Vector2(x, y);
      }
    }
    return undefined;
  }

  private circleOverlapsShapes(circle: Phaser.Geom.Circle): boolean {
    const bounds = new Phaser.Geom.Rectangle(
      circle.x - circle.radius,
      circle.y - circle.radius,
      circle.radius * 2,
      circle.radius * 2
    );
    if (this.players.some((player) => Phaser.Geom.Intersects.RectangleToRectangle(bounds, player.shape.getBounds()))) {
      return true;
    }
    const obstacleOverlap = (this.obstacles?.getChildren() ?? []).some((shape) =>
      Phaser.Geom.Intersects.RectangleToRectangle(bounds, (shape as Phaser.GameObjects.Rectangle).getBounds())
    );
    if (obstacleOverlap) return true;

    const movingObstacleOverlap = (this.movingObstacles?.getChildren() ?? []).some((shape) =>
      Phaser.Geom.Intersects.RectangleToRectangle(bounds, (shape as Phaser.GameObjects.Rectangle).getBounds())
    );
    if (movingObstacleOverlap) return true;

    const overlapsGroup = (group?: Phaser.GameObjects.Group) => {
      if (!group || !group.children) {
        return false;
      }
      return group.getChildren().some((child) => {
        const withBounds = child as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.GetBounds;
        if (!withBounds.getBounds) {
          return false;
        }
        return Phaser.Geom.Intersects.RectangleToRectangle(bounds, withBounds.getBounds());
      });
    };

    return (
      overlapsGroup(this.energy) ||
      overlapsGroup(this.rareEnergy) ||
      overlapsGroup(this.hazards) ||
      overlapsGroup(this.behaviorPickups) ||
      overlapsGroup(this.ropePickups)
    );
  }

  private createRegularPolygonPoints(sides: number, radius: number): number[] {
    const points: number[] = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = (Math.PI * 2 * i) / sides;
      points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    return points;
  }

  private getBehaviorColor(effect: BehaviorEffect): number {
    switch (effect) {
      case 'boost':
        return 0x00f0ff;
      case 'slow':
        return 0xff006e;
      case 'cloak':
        return 0xf4f4f4;
      case 'disrupt':
        return 0xf25f4c;
      default:
        return 0xffffff;
    }
  }

  private getEffectColor(type: PlayerEffect['type']): number {
    switch (type) {
      case 'boost':
        return 0x00f0ff;
      case 'slow':
        return 0xff006e;
      case 'cloak':
        return 0xf4f4f4;
      default:
        return 0xffffff;
    }
  }

  private toScoreState(player: Player): ScoreState {
    const lastDash = this.lastDash[player.id] ?? -Infinity;
    const elapsed = this.time.now - lastDash;
    const remaining = Math.max(0, DASH_COOLDOWN - elapsed);
    const dashReady = remaining <= 0;
    const dashPercent = dashReady ? 1 : 1 - remaining / DASH_COOLDOWN;

    const effects = player.activeEffect
      ? [
          {
            label: this.describeEffect(player.activeEffect.type),
            percent: Phaser.Math.Clamp(
              (player.activeEffect.expires - this.time.now) / player.activeEffect.duration,
              0,
              1
            ),
            color: `#${player.activeEffect.color.toString(16).padStart(6, '0')}`
          }
        ]
      : [];

    return {
      id: player.id,
      label: player.label,
      value: player.score,
      color: `#${player.color.toString(16).padStart(6, '0')}`,
      dashReady,
      dashPercent,
      goal: this.settings.winningScore,
      effects,
      wins: player.wins,
      hookCharges: player.hookCharges,
      maxHookCharges: player.maxHookCharges
    };
  }

  private describeEffect(type: PlayerEffect['type']): string {
    switch (type) {
      case 'boost':
        return 'Speed Surge';
      case 'slow':
        return 'Flux Drag';
      case 'cloak':
        return 'Phase Cloak';
      default:
        return 'Modifier';
    }
  }

  private createObstacles(): void {
    if (!this.obstacles) return;
    const solids = this.level?.solids ?? [];
    solids.forEach((config) => {
      const block = this.add.rectangle(config.x, config.y, config.width, config.height, 0x0f0e17, 0.8);
      this.physics.add.existing(block, true);
      this.obstacles?.add(block);
    });
  }

  private createMovingObstacles(): void {
    if (!this.movingObstacles) return;
    const count = this.settings.mode === 'minefield' ? 4 : 2;
    for (let i = 0; i < count; i += 1) {
      const position = this.findSpawnPosition(28);
      if (!position) continue;
      const width = Phaser.Math.Between(48, 96);
      const height = Phaser.Math.Between(16, 28);
      const block = this.add.rectangle(position.x, position.y, width, height, 0x191724, 0.8);
      this.physics.add.existing(block);
      const body = block.body as Phaser.Physics.Arcade.Body;
      body.setImmovable(true);
      const speed = this.settings.mode === 'minefield' ? 80 : 50;
      body.setVelocity(Phaser.Math.Between(-speed, speed), Phaser.Math.Between(-speed, speed));
      body.setCollideWorldBounds(true);
      body.setBounce(1, 1);
      this.movingObstacles.add(block);
    }
  }

  private applyHazardPenalty(player: Player): void {
    this.cameras.main.shake(120, 0.004);
    this.tweens.add({
      targets: player.shape,
      alpha: { from: 1, to: 0.5 },
      yoyo: true,
      repeat: 3,
      duration: 80
    });
  }

  private evaluateScore(player: Player): void {
    if (this.roundOver) {
      return;
    }
    if (player.score >= this.settings.winningScore) {
      this.recordWin(player, 'score');
      return;
    }
    if (player.score <= this.settings.negativeLossThreshold) {
      const opponent = this.players.find((p) => p.id !== player.id);
      if (opponent) {
        this.recordWin(opponent, 'debt');
      } else {
        this.roundOver = true;
        this.time.delayedCall(600, () => this.scene.restart());
      }
    }
  }

  private recordWin(winner: Player, reason: 'score' | 'debt'): void {
    if (this.roundOver) {
      return;
    }
    this.roundOver = true;
    this.matchWins[winner.id] = (this.matchWins[winner.id] ?? 0) + 1;
    winner.wins = this.matchWins[winner.id];
    const flareColor = reason === 'score' ? 0x2cb67d : 0xff5470;
    this.addStatusPing(winner.shape.x, winner.shape.y, flareColor);
    Object.entries(this.activeHooks).forEach(([id, hook]) => {
      hook?.tether.destroy();
      this.activeHooks[id] = undefined;
    });
    this.time.delayedCall(800, () => this.scene.restart());
  }

  shutdown(): void {
    this.overlay?.destroy();
    Object.values(this.activeHooks).forEach((hook) => hook?.tether.destroy());
    this.activeHooks = {};
  }
}
