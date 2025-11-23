import Phaser from 'phaser';
import { GameSettings, SurfaceSchema, getActiveSettings, getLevelById, getModeMetadata, LevelSchema } from '../state/settings';
import { awardCurrency, getCurrency, pullQueuedUpgrades, resetRecentEarnings, UpgradeId } from '../state/currency';
import { OVERLAY_POWER_EVENT, Overlay, ScoreState } from '../ui/overlay';
import { UpgradeModal } from '../ui/upgradeModal';

type PlayerRole = 'collector' | 'chaser';

type Player = {
  id: string;
  label: string;
  color: number;
  shape: Phaser.GameObjects.Arc;
  body: Phaser.Physics.Arcade.Body;
  facing: Phaser.Math.Vector2;
  score: number;
  health: number;
  maxHealth: number;
  wins: number;
  dashKey: Phaser.Input.Keyboard.Key;
  hookKey: Phaser.Input.Keyboard.Key;
  shootKey: Phaser.Input.Keyboard.Key;
  powerKey: Phaser.Input.Keyboard.Key;
  powerKeyLabel: string;
  role: PlayerRole;
  roleSpeedMultiplier: number;
  controls: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  speedMultiplier: number;
  surfaceMultiplier: number;
  speedResetTimer?: Phaser.Time.TimerEvent;
  activeEffect?: PlayerEffect;
  hookCharges: number;
  maxHookCharges: number;
  projectileCooldownUntil?: number;
  carriedPower?: PlayerPowerType;
  currentSurfaceId?: string;
  currentSurfaceLabel?: string;
};

type PlayerEffect = {
  type: 'boost' | 'slow' | 'cloak';
  aura?: Phaser.GameObjects.Arc;
  expires: number;
  duration: number;
  color: number;
};

type BehaviorEffect = 'boost' | 'slow' | 'cloak' | 'disrupt';

type SurfaceZone = SurfaceSchema & { shape: Phaser.GameObjects.Rectangle; expiresAt?: number };

type PlayerPowerType = 'glue';

type PowerDefinition = {
  id: PlayerPowerType;
  label: string;
  pickupColor: number;
};

type PlayerBindingDefinition = {
  id: string;
  label: string;
  color: number;
  movementKeys: [string, string, string, string];
  dashKey: string | number;
  hookKey: string | number;
  shootKey: { code: string | number; label: string };
  powerKey: { code: string | number; label: string };
};

const PLAYER_SPEED = 260;
const DASH_SPEED = 500;
const DASH_COOLDOWN = 800;
const DASH_DURATION = 180;
const HOOK_RANGE = 280;
const HOOK_DURATION = 320;
const HOOK_PULL_STRENGTH = 140;
const HOOK_PULL_DECAY = 0.7;
const HOOK_BREAK_DISTANCE = 56;
const SHOOTER_RECOIL_FACTOR = 0.82;
const SHOOT_RECOIL_DAMPENING = 0.9;
const HOOK_COOLDOWN = 1800;
const MAX_HOOK_CHARGES = 3;
const ROPE_PICKUP_LIMIT = 1;
const ROPE_RESPAWN_DELAY = 12000;
const MAX_SPAWN_ATTEMPTS = 30;
const CLOAK_DURATION = 4500;
const DISRUPT_DURATION = 3500;
const POWER_RESPAWN_DELAY = 10000;
const POWER_PICKUP_LIMIT = 2;
const GLUE_DURATION = 6000;
const GLUE_MULTIPLIER = 0.45;
const GLUE_SIZE = 140;
const TELEPORT_PICKUP_LIMIT = 2;
const TELEPORT_RESPAWN_DELAY = 9000;
const TELEPORT_MIN_DISTANCE = 140;
const SKULL_PICKUP_LIMIT = 2;

const SKULL_RESPAWN_DELAY = 11000;

const PROJECTILE_RADIUS = 6;
const PROJECTILE_HIT_FLASH = 0xfff3cd;

const POWER_DEFINITIONS: Record<PlayerPowerType, PowerDefinition> = {
  glue: {
    id: 'glue',
    label: 'Glue Drop',
    pickupColor: 0xffc8dd
  }
};

export class ArenaScene extends Phaser.Scene {
  private overlay?: Overlay;
  private players: Player[] = [];
  private energy?: Phaser.Physics.Arcade.Group;
  private rareEnergy?: Phaser.Physics.Arcade.Group;
  private hazards?: Phaser.Physics.Arcade.Group;
  private behaviorPickups?: Phaser.Physics.Arcade.Group;
  private ropePickups?: Phaser.Physics.Arcade.Group;
  private powerPickups?: Phaser.Physics.Arcade.Group;
  private teleportPickups?: Phaser.Physics.Arcade.Group;
  private skullPickups?: Phaser.Physics.Arcade.Group;
  private projectiles?: Phaser.Physics.Arcade.Group;
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
  private surfaceZones: SurfaceZone[] = [];
  private overlayPowerHandler?: (event: Event) => void;
  private lastChaserId?: string;
  private tagCooldowns: Record<string, number> = {};
  private modeTimer?: Phaser.Time.TimerEvent;
  private modeTimerExpiresAt?: number;
  private lastRoundEarnings: Record<string, number> = {};
  private upgradeModal?: UpgradeModal;
  private projectileCooldowns: Record<string, number> = {};

  constructor() {
    super('Arena');
  }

  create(): void {
    this.settings = getActiveSettings();
    this.level = getLevelById(this.settings.levelId);
    resetRecentEarnings();
    this.lastRoundEarnings = {};

    // Ensure the scene restarts from a clean state by clearing player and dash tracking
    this.players = [];
    this.lastDash = {};
    this.dashState = {};
    this.hookTimers = {};
    this.activeHooks = {};
    this.tagCooldowns = {};
    this.roundOver = false;
    this.modeTimer?.remove(false);
    this.modeTimer = undefined;
    this.modeTimerExpiresAt = undefined;
    // Reset group references so we don't access destroyed children during restart
    this.destroyGroup(this.energy);
    this.destroyGroup(this.rareEnergy);
    this.destroyGroup(this.hazards);
    this.destroyGroup(this.behaviorPickups);
    this.destroyGroup(this.ropePickups);
    this.destroyGroup(this.powerPickups);
    this.destroyGroup(this.obstacles);
    this.destroyGroup(this.movingObstacles);
    this.destroyGroup(this.teleportPickups);
    this.destroyGroup(this.skullPickups);
    this.destroyGroup(this.projectiles);
    this.energy = undefined;
    this.rareEnergy = undefined;
    this.hazards = undefined;
    this.behaviorPickups = undefined;
    this.ropePickups = undefined;
    this.obstacles = undefined;
    this.movingObstacles = undefined;
    this.powerPickups = undefined;
    this.teleportPickups = undefined;
    this.skullPickups = undefined;
    this.projectiles = undefined;
    this.projectileCooldowns = {};
    this.surfaceZones.forEach((zone) => zone.shape.destroy());
    this.surfaceZones = [];

    this.createBackground();
    const modeMeta = getModeMetadata(this.settings.mode);
    const pursuitMode = this.isPursuitMode();
    const shootingMode = this.isShootingMode();
    this.overlay = new Overlay({
      targetScore: shootingMode ? this.settings.shootingHealth : this.settings.winningScore,
      negativeLossThreshold: shootingMode ? undefined : this.settings.negativeLossThreshold,
      modeLabel: modeMeta.label,
      modeDescription: modeMeta.description,
      timerSeconds: pursuitMode ? this.settings.modeTimerSeconds : undefined,
      roleDescriptors: pursuitMode
        ? [
            {
              id: 'collector',
              label: 'Collector',
              detail: `Grab energy to ${this.settings.winningScore} before you get tagged.`,
              color: '#2cb67d'
            },
            {
              id: 'chaser',
              label: 'Chaser',
              detail: `Tag the collector ${this.settings.chaserTagGoal} times before time runs out.`,
              color: '#ff5470'
            }
          ]
        : shootingMode
        ? [
            {
              id: 'shields',
              label: 'Shields',
              detail: `Each pilot spawns with ${this.settings.shootingHealth} shield points—lose them all and you explode.`,
              color: '#2cb67d'
            },
            {
              id: 'blaster',
              label: 'Blaster volley',
              detail: 'Aim your grapples to fire plasma bolts that chip rival shields.',
              color: '#ff8906'
            }
          ]
        : undefined
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.overlay?.destroy();
      this.overlay = undefined;
      this.escapeKey?.destroy();
      this.escapeKey = undefined;
      this.upgradeModal?.destroy();
      this.upgradeModal = undefined;
      if (typeof window !== 'undefined' && this.overlayPowerHandler) {
        window.removeEventListener(OVERLAY_POWER_EVENT, this.overlayPowerHandler as EventListener);
        this.overlayPowerHandler = undefined;
      }
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.overlay?.destroy();
      this.overlay = undefined;
      this.escapeKey?.destroy();
      this.escapeKey = undefined;
      this.upgradeModal?.destroy();
      this.upgradeModal = undefined;
      if (typeof window !== 'undefined' && this.overlayPowerHandler) {
        window.removeEventListener(OVERLAY_POWER_EVENT, this.overlayPowerHandler as EventListener);
        this.overlayPowerHandler = undefined;
      }
    });

    this.escapeKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escapeKey?.on('down', () => this.scene.start('Menu'));

    if (typeof window !== 'undefined' && !this.overlayPowerHandler) {
      this.overlayPowerHandler = (event: Event) => {
        const payload = event as CustomEvent<{ playerId: string }>;
        const player = this.players.find((p) => p.id === payload.detail.playerId);
        if (player) {
          this.consumePlayerPower(player);
        }
      };
      window.addEventListener(OVERLAY_POWER_EVENT, this.overlayPowerHandler as EventListener);
    }

    const spawnPoints = this.level.spawnPoints.length
      ? this.level.spawnPoints
      : [
          { x: this.scale.width * 0.25, y: this.scale.height * 0.3 },
          { x: this.scale.width * 0.75, y: this.scale.height * 0.7 }
        ];

    const playerBindings = this.getPlayerBindings();
    const playerConfigs = playerBindings.map((binding) => ({
      id: binding.id,
      label: binding.label,
      color: binding.color,
      keys: this.createKeys(binding.movementKeys),
      dash: this.input.keyboard!.addKey(binding.dashKey),
      hook: this.input.keyboard!.addKey(binding.hookKey),
      shoot: { key: this.input.keyboard!.addKey(binding.shootKey.code), label: binding.shootKey.label },
      power: {
        key: this.input.keyboard!.addKey(binding.powerKey.code),
        label: binding.powerKey.label
      }
    }));

    const chaserId = pursuitMode ? this.chooseChaserId(playerConfigs.map((config) => config.id)) : undefined;

    playerConfigs.forEach((config, index) => {
      const spawn = spawnPoints[index % spawnPoints.length] ?? { x: 400, y: 300 };
      if (typeof this.matchWins[config.id] !== 'number') {
        this.matchWins[config.id] = 0;
      }
      const role: PlayerRole = pursuitMode && config.id === chaserId ? 'chaser' : 'collector';
      const roleSpeedMultiplier = pursuitMode ? (role === 'chaser' ? 1.12 : 0.96) : 1;
      const maxHookCharges = shootingMode ? 0 : role === 'chaser' ? MAX_HOOK_CHARGES + 1 : MAX_HOOK_CHARGES;
      this.players.push(
        this.createPlayer({
          ...config,
          x: spawn.x,
          y: spawn.y,
          wins: this.matchWins[config.id],
          role,
          roleSpeedMultiplier,
          maxHookCharges,
          maxHealth: this.settings.shootingHealth
        })
      );
    });

    this.obstacles = this.physics.add.staticGroup();
    this.createObstacles();

    this.movingObstacles = this.physics.add.group({ immovable: true });
    this.createMovingObstacles();

    this.createSurfaces();

    this.energy = this.physics.add.group();
    this.rareEnergy = this.physics.add.group();
    this.hazards = this.physics.add.group();
    this.behaviorPickups = this.physics.add.group();
    this.ropePickups = this.physics.add.group();
    this.powerPickups = this.physics.add.group();
    this.teleportPickups = this.physics.add.group();
    this.skullPickups = this.physics.add.group();
    this.projectiles = this.isShootingMode() ? this.physics.add.group() : undefined;

    if (!shootingMode) {
      this.spawnEnergyOrbs(this.settings.energyCount);
      this.spawnRareEnergy(this.settings.rareEnergyCount);
      this.spawnBehaviorPickups(this.settings.behaviorPickupCount);
      this.spawnRopePickups(ROPE_PICKUP_LIMIT);
      this.spawnPowerPickups(POWER_PICKUP_LIMIT);
      this.spawnTeleportPickups(TELEPORT_PICKUP_LIMIT);
      this.spawnSkullPickups(SKULL_PICKUP_LIMIT);
    }
    this.spawnHazards();

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
    this.physics.add.collider(
      playerShapes,
      playerShapes,
      pursuitMode ? this.handleTagCollision : undefined,
      undefined,
      this
    );

    if (shootingMode && this.projectiles) {
      if (this.obstacles) {
        this.physics.add.collider(this.projectiles, this.obstacles, (projectile) =>
          (projectile as Phaser.GameObjects.GameObject).destroy()
        );
      }
      if (this.movingObstacles) {
        this.physics.add.collider(this.projectiles, this.movingObstacles, (projectile) =>
          (projectile as Phaser.GameObjects.GameObject).destroy()
        );
      }
    }

    this.physics.add.overlap(playerShapes, this.energy, (_playerShape, energy) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const orb = energy as Phaser.GameObjects.Arc;
      if (!player || !orb.active) {
        return;
      }

      if (this.isPursuitMode() && player.role !== 'collector') {
        return;
      }

      if (this.isShootingMode()) {
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
      if (this.isPursuitMode() && player.role !== 'collector') return;
      if (this.isShootingMode()) return;
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
      if (this.isPlayerCloaked(player)) {
        return;
      }
      orb.destroy();
      if (this.isShootingMode()) {
        this.damageShields(player, this.settings.projectileDamage, PROJECTILE_HIT_FLASH);
        if (!this.roundOver) {
          this.spawnHazards(1);
        }
        return;
      }
      if (this.isPursuitMode() && player.role !== 'collector') {
        this.applyHazardPenalty(player);
        if (!this.roundOver) {
          this.spawnHazards(1);
        }
        return;
      }
      player.score -= 2;
      this.applyHazardPenalty(player);
      this.evaluateScore(player);
      if (!this.roundOver) {
        this.spawnHazards(1);
      }
    });

    if (shootingMode && this.projectiles) {
      this.physics.add.overlap(playerShapes, this.projectiles, (_playerShape, projectile) => {
        const player = this.players.find((p) => p.shape === _playerShape);
        const bolt = projectile as Phaser.GameObjects.GameObject;
        if (!player || !bolt.active) return;
        const ownerId = bolt.getData('ownerId') as string | undefined;
        if (ownerId && ownerId === player.id) {
          return;
        }
        this.handleProjectileImpact(player, bolt);
      });
    }

    this.physics.add.overlap(playerShapes, this.behaviorPickups, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      if (!player) return;
      const item = pickup as Phaser.GameObjects.Shape;
      const effect = (item.getData('effect') as BehaviorEffect | undefined) ?? 'boost';
      if (this.isPlayerCloaked(player) && (effect === 'slow' || effect === 'disrupt')) {
        return;
      }
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

    this.physics.add.overlap(playerShapes, this.powerPickups, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const power = pickup as Phaser.GameObjects.Shape;
      if (!player || !power.active) return;
      if (player.carriedPower) {
        return;
      }
      const powerId = (power.getData('powerId') as PlayerPowerType | undefined) ?? 'glue';
      power.destroy();
      this.grantPower(player, powerId);
      this.time.delayedCall(POWER_RESPAWN_DELAY, () => this.spawnPowerPickups(1));
    });

    this.physics.add.overlap(playerShapes, this.teleportPickups!, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const shard = pickup as Phaser.GameObjects.Shape;
      if (!player || !shard.active) {
        return;
      }
      shard.destroy();
      this.teleportPlayer(player);
      if (!this.roundOver) {
        this.time.delayedCall(TELEPORT_RESPAWN_DELAY, () => this.spawnTeleportPickups(1));
      }
    });

    this.physics.add.overlap(playerShapes, this.skullPickups!, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const shard = pickup as Phaser.GameObjects.Shape;
      if (!player || !shard.active || this.roundOver) {
        return;
      }
      shard.destroy();
      const opponent = this.players.find((p) => p.id !== player.id);
      if (opponent) {
        this.recordWin(opponent, 'debt');
      }
      if (!this.roundOver) {
        this.time.delayedCall(SKULL_RESPAWN_DELAY, () => this.spawnSkullPickups(1));
      }
    });

    if (pursuitMode) {
      this.startModeTimer();
    }
  }

  private getPlayerBindings(): PlayerBindingDefinition[] {
    const defaultBindings: PlayerBindingDefinition[] = [
      {
        id: 'p1',
        label: 'Pilot One',
        color: 0x7f5af0,
        movementKeys: ['W', 'S', 'A', 'D'],
        dashKey: Phaser.Input.Keyboard.KeyCodes.SHIFT,
        hookKey: Phaser.Input.Keyboard.KeyCodes.E,
        shootKey: { code: Phaser.Input.Keyboard.KeyCodes.F, label: 'F' },
        powerKey: {
          code: Phaser.Input.Keyboard.KeyCodes.R,
          label: 'R'
        }
      },
      {
        id: 'p2',
        label: 'Pilot Two',
        color: 0xff8906,
        movementKeys: ['UP', 'DOWN', 'LEFT', 'RIGHT'],
        dashKey: Phaser.Input.Keyboard.KeyCodes.ENTER,
        hookKey: Phaser.Input.Keyboard.KeyCodes.P,
        shootKey: { code: Phaser.Input.Keyboard.KeyCodes.L, label: 'L' },
        powerKey: {
          code: Phaser.Input.Keyboard.KeyCodes.O,
          label: 'O'
        }
      }
    ];
    const registryBindings = this.registry.get('playerBindings') as PlayerBindingDefinition[] | undefined;
    if (Array.isArray(registryBindings) && registryBindings.length > 0) {
      return registryBindings.map((binding, index) => ({
        ...binding,
        shootKey: binding.shootKey ?? defaultBindings[index % defaultBindings.length].shootKey
      }));
    }
    return defaultBindings;
  }

  update(): void {
    this.pruneSurfaceZones();
    this.players.forEach((player) => {
      this.updatePlayerSurface(player);
      this.updatePlayerMovement(player);
      this.applyBoundaryBehavior(player);
      this.updateEffectAura(player);
    });
    this.updateHooks();
    this.overlay?.update(this.players.map((player) => this.toScoreState(player)), {
      timerRemainingMs: this.getTimerRemaining()
    });
  }

  private handleTagCollision: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    _shapeA,
    _shapeB
  ): void => {
    if (!this.isPursuitMode() || this.roundOver) {
      return;
    }

    const firstObject = this.extractGameObject(_shapeA);
    const secondObject = this.extractGameObject(_shapeB);
    const first = this.players.find((p) => p.shape === firstObject);
    const second = this.players.find((p) => p.shape === secondObject);
    if (!first || !second || first.id === second.id) {
      return;
    }

    const chaser = first.role === 'chaser' ? first : second.role === 'chaser' ? second : undefined;
    const collector = first.role === 'collector' ? first : second.role === 'collector' ? second : undefined;
    if (!chaser || !collector) {
      return;
    }

    const cooldownUntil = this.tagCooldowns[chaser.id] ?? 0;
    if (cooldownUntil > this.time.now) {
      return;
    }

    this.tagCooldowns[chaser.id] = this.time.now + 900;
    this.registerTag(chaser, collector);
  };

  private extractGameObject(entry: unknown): Phaser.GameObjects.GameObject | undefined {
    const bodyCandidate = entry as Phaser.Physics.Arcade.Body;
    if (bodyCandidate && 'gameObject' in bodyCandidate && bodyCandidate.gameObject) {
      return bodyCandidate.gameObject as Phaser.GameObjects.GameObject;
    }
    return entry as Phaser.GameObjects.GameObject;
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

    const hasInput = velocity.lengthSq() > 0;
    if (hasInput) {
      velocity.normalize();
      player.facing.set(velocity.x, velocity.y);
    }
    const totalSpeedMultiplier = player.speedMultiplier * player.surfaceMultiplier * player.roleSpeedMultiplier;
    body.setVelocity(velocity.x * PLAYER_SPEED * totalSpeedMultiplier, velocity.y * PLAYER_SPEED * totalSpeedMultiplier);

    const dashReady = this.time.now - (this.lastDash[player.id] ?? 0) >= DASH_COOLDOWN;
    if (dashReady && hasInput && Phaser.Input.Keyboard.JustDown(player.dashKey)) {
      const direction = velocity.clone();
      this.dashState[player.id] = { direction, until: this.time.now + DASH_DURATION };
      this.lastDash[player.id] = this.time.now;
      const dashSpeed = DASH_SPEED * totalSpeedMultiplier;
      body.setVelocity(direction.x * dashSpeed, direction.y * dashSpeed);
      this.addDashBurst(player.shape.x, player.shape.y, player.color);
    }

    if (!this.isShootingMode() && Phaser.Input.Keyboard.JustDown(player.hookKey)) {
      this.attemptHook(player);
    }

    this.updatePlayerShooting(player);

    if (Phaser.Input.Keyboard.JustDown(player.powerKey)) {
      this.consumePlayerPower(player);
    }
  }

  private updatePlayerShooting(player: Player): void {
    if (!this.isShootingMode() || !this.projectiles || this.roundOver) {
      return;
    }

    if (!player.shootKey.isDown) {
      return;
    }

    const cooldownReady = (this.projectileCooldowns[player.id] ?? 0) <= this.time.now;
    if (!cooldownReady) {
      return;
    }

    const maxRange = this.getProjectileRange();
    const targetInfo = this.findNearestTarget(player, maxRange);
    if (!targetInfo) {
      return;
    }

    player.facing = targetInfo.direction.clone();
    this.fireProjectile(player, targetInfo.direction.clone());
    const recoil = player.body.velocity.clone().scale(SHOOT_RECOIL_DAMPENING);
    player.body.setVelocity(recoil.x, recoil.y);
  }

  private applyBoundaryBehavior(player: Player): void {
    if (this.settings.boundaryBehavior === 'collide') {
      player.body.setCollideWorldBounds(true);
      return;
    }

    player.body.setCollideWorldBounds(false);
    const radius = player.body.halfWidth ?? 18;
    const width = this.scale.width;
    const height = this.scale.height;
    const leftLimit = -radius;
    const rightLimit = width + radius;
    const topLimit = -radius;
    const bottomLimit = height + radius;

    let x = player.shape.x;
    let y = player.shape.y;

    if (x < leftLimit) x = rightLimit;
    else if (x > rightLimit) x = leftLimit;

    if (y < topLimit) y = bottomLimit;
    else if (y > bottomLimit) y = topLimit;

    if (x !== player.shape.x || y !== player.shape.y) {
      player.shape.setPosition(x, y);
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
    shoot: { key: Phaser.Input.Keyboard.Key; label: string };
    wins: number;
    power: { key: Phaser.Input.Keyboard.Key; label: string };
    role: PlayerRole;
    roleSpeedMultiplier: number;
    maxHookCharges: number;
    maxHealth: number;
  }): Player {
    const radius = 18;
    const shape = this.add.circle(config.x, config.y, radius, config.color, 0.9);
    this.physics.add.existing(shape);
    const body = shape.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius);
    body.setCollideWorldBounds(this.settings.boundaryBehavior === 'collide');
    body.pushable = false;

    const player: Player = {
      id: config.id,
      label: config.label,
      color: config.color,
      shape,
      body,
      facing: new Phaser.Math.Vector2(0, 1),
      score: this.isShootingMode() ? config.maxHealth : 0,
      health: config.maxHealth,
      maxHealth: config.maxHealth,
      wins: config.wins,
      controls: config.keys,
      dashKey: config.dash,
      hookKey: config.hook,
      shootKey: config.shoot.key,
      powerKey: config.power.key,
      powerKeyLabel: config.power.label,
      role: config.role,
      roleSpeedMultiplier: config.roleSpeedMultiplier,
      speedMultiplier: 1,
      surfaceMultiplier: 1,
      hookCharges: config.maxHookCharges,
      maxHookCharges: config.maxHookCharges
    };

    this.applyQueuedUpgrades(player);

    return player;
  }

  private applyQueuedUpgrades(player: Player): void {
    const queued = pullQueuedUpgrades(player.id);
    queued.forEach((upgradeId) => this.applyUpgradeEffect(player, upgradeId));
  }

  private applyUpgradeEffect(player: Player, upgradeId: UpgradeId): void {
    switch (upgradeId) {
      case 'afterburner':
        player.speedMultiplier += 0.1;
        break;
      case 'reserve-core':
        if (this.isShootingMode()) {
          player.health = Math.min(player.maxHealth, player.health + 1);
          player.score = player.health;
        } else {
          player.score += 1;
        }
        break;
      case 'hook-stock':
        player.maxHookCharges += 1;
        player.hookCharges = Math.min(player.maxHookCharges, player.hookCharges + 1);
        break;
      default:
        break;
    }
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

  private spawnPowerPickups(count?: number): void {
    if (!this.powerPickups) return;
    const amount = count ?? 1;
    for (let i = 0; i < amount; i += 1) {
      if (this.powerPickups.countActive(true) >= POWER_PICKUP_LIMIT) {
        break;
      }
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const definition = POWER_DEFINITIONS.glue;
      const pickup = this.add.star(position.x, position.y, 6, 10, 18, definition.pickupColor, 0.95);
      pickup.setStrokeStyle(2, 0x0f0e17, 0.8);
      pickup.setData('powerId', definition.id);
      this.physics.add.existing(pickup);
      this.powerPickups.add(pickup);
    }
  }

  private spawnTeleportPickups(count?: number): void {
    if (!this.teleportPickups) return;
    const amount = count ?? 1;
    for (let i = 0; i < amount; i += 1) {
      if (this.teleportPickups.countActive(true) >= TELEPORT_PICKUP_LIMIT) {
        break;
      }
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const pickup = this.add.star(position.x, position.y, 4, 10, 16, 0x9d4edd, 0.95);
      pickup.setStrokeStyle(2, 0xffffff, 0.7);
      this.physics.add.existing(pickup);
      this.teleportPickups.add(pickup);
    }
  }

  private spawnSkullPickups(count?: number): void {
    if (!this.skullPickups) return;
    const amount = count ?? 1;
    for (let i = 0; i < amount; i += 1) {
      if (this.skullPickups.countActive(true) >= SKULL_PICKUP_LIMIT) {
        break;
      }
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const pickup = this.add.polygon(position.x, position.y, this.createRegularPolygonPoints(6, 14), 0x16161a, 0.92);
      pickup.setStrokeStyle(2, 0xff5470, 0.9);
      this.physics.add.existing(pickup);
      this.skullPickups.add(pickup);
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

  private teleportPlayer(player: Player): void {
    let destination: Phaser.Math.Vector2 | undefined;
    for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i += 1) {
      const candidate = this.findSpawnPosition(24);
      if (!candidate) {
        continue;
      }
      const distance = Phaser.Math.Distance.Between(player.shape.x, player.shape.y, candidate.x, candidate.y);
      if (distance >= TELEPORT_MIN_DISTANCE) {
        destination = candidate;
        break;
      }
    }
    if (!destination) {
      return;
    }
    player.body.stop();
    player.body.reset(destination.x, destination.y);
    player.shape.setPosition(destination.x, destination.y);
    this.addTeleportFlash(destination.x, destination.y);
    this.addStatusPing(destination.x, destination.y, 0x9d4edd);
  }

  private addTeleportFlash(x: number, y: number): void {
    const ring = this.add.circle(x, y, 10, 0xffffff, 0);
    ring.setStrokeStyle(3, 0x9d4edd, 0.8);
    this.tweens.add({
      targets: ring,
      radius: { from: 10, to: 80 },
      alpha: { from: 1, to: 0 },
      duration: 350,
      onComplete: () => ring.destroy()
    });
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

  private isPlayerCloaked(player: Player): boolean {
    return player.activeEffect?.type === 'cloak';
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

  private getProjectileRange(): number {
    return this.settings.projectileSpeed * (this.settings.projectileLifetimeMs / 1000);
  }

  private findNearestTarget(
    player: Player,
    maxRange: number
  ): { target: Player; direction: Phaser.Math.Vector2 } | undefined {
    let nearest: Player | undefined;
    let nearestDistance = Number.MAX_SAFE_INTEGER;
    this.players.forEach((candidate) => {
      if (candidate.id === player.id) {
        return;
      }
      const distance = Phaser.Math.Distance.Between(
        player.shape.x,
        player.shape.y,
        candidate.shape.x,
        candidate.shape.y
      );
      if (distance > maxRange || distance >= nearestDistance) {
        return;
      }
      nearest = candidate;
      nearestDistance = distance;
    });

    if (!nearest) {
      return undefined;
    }

    const direction = new Phaser.Math.Vector2(nearest.shape.x - player.shape.x, nearest.shape.y - player.shape.y);
    if (direction.lengthSq() === 0) {
      return undefined;
    }

    return { target: nearest, direction: direction.normalize() };
  }

  private fireProjectile(player: Player, direction?: Phaser.Math.Vector2): void {
    if (!this.projectiles || !this.isShootingMode() || this.roundOver) {
      return;
    }
    const nextReady = this.projectileCooldowns[player.id] ?? 0;
    if (nextReady > this.time.now) {
      return;
    }
    const aimDirection =
      direction && direction.lengthSq() > 0
        ? direction.clone().normalize()
        : player.facing.lengthSq() > 0
        ? player.facing.clone().normalize()
        : new Phaser.Math.Vector2(0, 1);
    const spawn = new Phaser.Math.Vector2(player.shape.x, player.shape.y).add(aimDirection.clone().scale(24));
    const bolt = this.add.circle(spawn.x, spawn.y, PROJECTILE_RADIUS, player.color, 0.9);
    this.physics.add.existing(bolt);
    const body = bolt.body as Phaser.Physics.Arcade.Body;
    body.setCircle(PROJECTILE_RADIUS);
    body.setVelocity(aimDirection.x * this.settings.projectileSpeed, aimDirection.y * this.settings.projectileSpeed);
    body.setAllowGravity(false);
    bolt.setDepth(0.5);
    bolt.setData('ownerId', player.id);
    this.projectiles.add(bolt);
    this.projectileCooldowns[player.id] = this.time.now + this.settings.projectileCooldownMs;
    this.time.delayedCall(this.settings.projectileLifetimeMs, () => bolt.destroy());
  }

  private releaseHook(playerId: string): void {
    const hook = this.activeHooks[playerId];
    if (!hook) return;
    hook.tether.destroy();
    this.activeHooks[playerId] = undefined;
  }

  private handleProjectileImpact(target: Player, projectile: Phaser.GameObjects.GameObject): void {
    if (!projectile.active) {
      return;
    }
    projectile.destroy();
    this.damageShields(target, this.settings.projectileDamage, PROJECTILE_HIT_FLASH);
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
      overlapsGroup(this.ropePickups) ||
      overlapsGroup(this.powerPickups) ||
      overlapsGroup(this.teleportPickups)
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
    const currency = getCurrency(player.id);

    const shootingGoal = this.isShootingMode() ? player.maxHealth : undefined;
    const pursuitGoal = this.isPursuitMode() && player.role === 'chaser' ? this.settings.chaserTagGoal : undefined;
    const goal = shootingGoal ?? pursuitGoal ?? this.settings.winningScore;
    const timerNote = this.isPursuitMode() && this.settings.modeTimerSeconds > 0
      ? ` before ${Math.ceil(this.settings.modeTimerSeconds / 60)}m is up`
      : '';
    const objective = this.isPursuitMode()
      ? player.role === 'chaser'
        ? `Tag the collector ${goal} times${timerNote}.`
        : `Collect energy to ${goal} and avoid tags${timerNote}.`
      : this.isShootingMode()
      ? 'Land plasma hits to strip rival shields. First to zero shields loses.'
      : undefined;
    const roleColor = this.isPursuitMode() ? (player.role === 'chaser' ? '#ff5470' : '#2cb67d') : '#ffd803';

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
      value: this.isShootingMode() ? player.health : player.score,
      color: `#${player.color.toString(16).padStart(6, '0')}`,
      dashReady,
      dashPercent,
      goal,
      effects,
      wins: player.wins,
      hookCharges: player.hookCharges,
      maxHookCharges: player.maxHookCharges,
      surfaceLabel: player.currentSurfaceLabel,
      role: this.isPursuitMode() ? (player.role === 'chaser' ? 'Chaser' : 'Collector') : shootingGoal ? 'Duelist' : undefined,
      roleColor: this.isPursuitMode() ? roleColor : shootingGoal ? roleColor : undefined,
      objective,
      currency: {
        balance: currency.balance,
        earned: currency.recentEarnings ?? 0
      },
      power: player.carriedPower
        ? {
            label: POWER_DEFINITIONS[player.carriedPower].label,
            ready: true,
            hint: player.powerKeyLabel
          }
        : undefined
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

  private damageShields(player: Player, amount: number, color?: number): void {
    if (!this.isShootingMode()) {
      player.score -= amount;
      this.evaluateScore(player);
      return;
    }
    player.health = Math.max(0, player.health - amount);
    player.score = player.health;
    this.applyHazardPenalty(player);
    this.addStatusPing(player.shape.x, player.shape.y, color ?? PROJECTILE_HIT_FLASH);
    if (player.health <= 0) {
      const opponent = this.players.find((p) => p.id !== player.id);
      if (opponent) {
        this.recordWin(opponent, 'score');
      }
    }
  }

  private registerTag(chaser: Player, collector: Player): void {
    if (this.roundOver) {
      return;
    }
    chaser.score += 1;
    this.applyHazardPenalty(collector);
    this.addStatusPing(collector.shape.x, collector.shape.y, chaser.color);
    this.evaluateScore(chaser);
  }

  private startModeTimer(): void {
    if (!this.isPursuitMode() || this.settings.modeTimerSeconds <= 0) {
      return;
    }
    this.modeTimerExpiresAt = this.time.now + this.settings.modeTimerSeconds * 1000;
    this.modeTimer?.remove(false);
    this.modeTimer = this.time.delayedCall(this.settings.modeTimerSeconds * 1000, () => {
      if (this.roundOver) {
        return;
      }
      const collector = this.players.find((player) => player.role === 'collector');
      if (collector) {
        this.recordWin(collector, 'timer');
      }
    });
  }

  private isPursuitMode(): boolean {
    return this.settings.mode === 'pursuit';
  }

  private isShootingMode(): boolean {
    return this.settings.mode === 'shooting';
  }

  private getTimerRemaining(): number | undefined {
    if (!this.modeTimerExpiresAt) {
      return undefined;
    }
    return Math.max(0, this.modeTimerExpiresAt - this.time.now);
  }

  private chooseChaserId(playerIds: string[]): string | undefined {
    if (!playerIds.length) {
      return undefined;
    }
    if (!this.lastChaserId) {
      this.lastChaserId = playerIds[0];
      return this.lastChaserId;
    }
    const alternate = playerIds.find((id) => id !== this.lastChaserId);
    this.lastChaserId = alternate ?? playerIds[0];
    return this.lastChaserId;
  }

  private evaluateScore(player: Player): void {
    if (this.roundOver) {
      return;
    }

    if (this.isShootingMode()) {
      if (player.health <= 0) {
        const opponent = this.players.find((p) => p.id !== player.id);
        if (opponent) {
          this.recordWin(opponent, 'score');
        }
      }
      return;
    }

    if (this.isPursuitMode()) {
      if (player.role === 'collector' && player.score >= this.settings.winningScore) {
        this.recordWin(player, 'score');
        return;
      }
      if (player.role === 'chaser' && player.score >= this.settings.chaserTagGoal) {
        this.recordWin(player, 'tag');
        return;
      }
      if (player.role === 'collector' && player.score <= this.settings.negativeLossThreshold) {
        const chaser = this.players.find((p) => p.role === 'chaser');
        if (chaser) {
          this.recordWin(chaser, 'debt');
        }
      }
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
        this.recordWin(player, 'debt');
      }
    }
  }

  private recordWin(winner: Player, reason: 'score' | 'debt' | 'tag' | 'timer'): void {
    if (this.roundOver) {
      return;
    }
    this.roundOver = true;
    this.modeTimer?.remove(false);
    this.modeTimer = undefined;
    this.modeTimerExpiresAt = undefined;
    this.matchWins[winner.id] = (this.matchWins[winner.id] ?? 0) + 1;
    winner.wins = this.matchWins[winner.id];
    const flareColor =
      reason === 'debt' ? 0xff5470 : reason === 'tag' ? 0xff8906 : reason === 'timer' ? 0x2cb67d : 0x2cb67d;
    this.addStatusPing(winner.shape.x, winner.shape.y, flareColor);
    Object.entries(this.activeHooks).forEach(([id, hook]) => {
      hook?.tether.destroy();
      this.activeHooks[id] = undefined;
    });
    this.grantRoundCurrency(winner, reason);
    this.launchUpgradeIntermission();
  }

  private grantRoundCurrency(winner: Player, reason: 'score' | 'debt' | 'tag' | 'timer'): void {
    const winBonus =
      reason === 'tag' ? 3 : reason === 'score' ? 2 : reason === 'timer' ? 1 : 1;
    this.players.forEach((player) => {
      const base = Math.max(1, Math.round(Math.max(player.score, 0) * 0.5));
      const bonus = player.id === winner.id ? winBonus : 1;
      const total = Math.max(1, base + bonus);
      awardCurrency(player.id, total);
      this.lastRoundEarnings[player.id] = total;
    });
  }

  private launchUpgradeIntermission(): void {
    if (this.upgradeModal || typeof window === 'undefined') {
      this.time.delayedCall(800, () => this.scene.restart());
      return;
    }

    const players = this.players.map((player) => ({
      id: player.id,
      label: player.label,
      color: `#${player.color.toString(16).padStart(6, '0')}`,
      currency: getCurrency(player.id),
      roundEarnings: this.lastRoundEarnings[player.id] ?? 0
    }));

    this.upgradeModal = new UpgradeModal({
      players,
      onSpend: () =>
        this.overlay?.update(this.players.map((p) => this.toScoreState(p)), {
          timerRemainingMs: this.getTimerRemaining()
        })
    });

    this.upgradeModal.open().then(() => {
      this.upgradeModal = undefined;
      this.scene.restart();
    });
  }

  shutdown(): void {
    this.overlay?.destroy();
    Object.values(this.activeHooks).forEach((hook) => hook?.tether.destroy());
    this.activeHooks = {};
    this.modeTimer?.remove(false);
    this.modeTimer = undefined;
    this.modeTimerExpiresAt = undefined;
    if (typeof window !== 'undefined' && this.overlayPowerHandler) {
      window.removeEventListener(OVERLAY_POWER_EVENT, this.overlayPowerHandler as EventListener);
      this.overlayPowerHandler = undefined;
    }
  }

  private createSurfaces(): void {
    const surfaces = this.level?.surfaces ?? [];
    surfaces.forEach((surface) => this.addSurfaceZone(surface));
  }

  private addSurfaceZone(surface: SurfaceSchema, lifespan?: number): SurfaceZone {
    const shape = this.add.rectangle(surface.x, surface.y, surface.width, surface.height, surface.color ?? 0xffffff, 0.25);
    shape.setDepth(-0.5);
    shape.setBlendMode(Phaser.BlendModes.ADD);
    const expiresAt = lifespan ? this.time.now + lifespan : undefined;
    const zone: SurfaceZone = { ...surface, shape, expiresAt };
    this.surfaceZones.push(zone);
    return zone;
  }

  private updatePlayerSurface(player: Player): void {
    const bounds = player.shape.getBounds();
    let overlap: SurfaceZone | undefined;
    for (let i = this.surfaceZones.length - 1; i >= 0; i -= 1) {
      const zone = this.surfaceZones[i];
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, zone.shape.getBounds())) {
        overlap = zone;
        break;
      }
    }
    if (overlap) {
      if (player.currentSurfaceId !== overlap.id) {
        player.currentSurfaceId = overlap.id;
        player.currentSurfaceLabel = overlap.label;
        player.surfaceMultiplier = overlap.multiplier;
      }
      return;
    }
    if (player.currentSurfaceId) {
      this.clearSurfaceState(player);
    }
  }

  private clearSurfaceState(player: Player): void {
    player.currentSurfaceId = undefined;
    player.currentSurfaceLabel = undefined;
    player.surfaceMultiplier = 1;
  }

  private pruneSurfaceZones(): void {
    if (!this.surfaceZones.length) return;
    const now = this.time.now;
    this.surfaceZones = this.surfaceZones.filter((zone) => {
      if (zone.expiresAt && zone.expiresAt <= now) {
        zone.shape.destroy();
        this.players
          .filter((player) => player.currentSurfaceId === zone.id)
          .forEach((player) => this.clearSurfaceState(player));
        return false;
      }
      return true;
    });
  }

  private grantPower(player: Player, power: PlayerPowerType): void {
    player.carriedPower = power;
    this.addStatusPing(player.shape.x, player.shape.y, POWER_DEFINITIONS[power].pickupColor);
  }

  private consumePlayerPower(player: Player): void {
    if (!player.carriedPower) {
      return;
    }
    switch (player.carriedPower) {
      case 'glue':
        this.deployGlueField(player);
        break;
      default:
        break;
    }
    player.carriedPower = undefined;
  }

  private deployGlueField(player: Player): void {
    const direction = player.facing.lengthSq() > 0 ? player.facing.clone() : new Phaser.Math.Vector2(0, 1);
    const offset = GLUE_SIZE * 0.5 + Math.max(player.body.halfWidth, player.body.halfHeight);
    const dropPosition = new Phaser.Math.Vector2(player.shape.x, player.shape.y).subtract(direction.scale(offset));
    const halfSize = GLUE_SIZE / 2;
    dropPosition.x = Phaser.Math.Clamp(dropPosition.x, halfSize, this.scale.width - halfSize);
    dropPosition.y = Phaser.Math.Clamp(dropPosition.y, halfSize, this.scale.height - halfSize);
    const id = `glue-${this.time.now}-${Phaser.Math.Between(0, 999)}`;
    const zone: SurfaceSchema = {
      id,
      label: 'Glue Slick',
      x: dropPosition.x,
      y: dropPosition.y,
      width: GLUE_SIZE,
      height: GLUE_SIZE,
      multiplier: GLUE_MULTIPLIER,
      color: 0xffa6c9
    };
    this.addSurfaceZone(zone, GLUE_DURATION);
    this.addStatusPing(dropPosition.x, dropPosition.y, 0xffa6c9);
  }

  private destroyGroup(
    group?: Phaser.GameObjects.Group | Phaser.Physics.Arcade.Group | Phaser.Physics.Arcade.StaticGroup
  ): void {
    if (!group) {
      return;
    }
    const hasChildren = Boolean((group as Phaser.GameObjects.Group).children);
    if (!hasChildren) {
      return;
    }
    group.clear(true, true);
    group.destroy(true);
  }
}
