import Phaser from 'phaser';
import { Overlay, ScoreState } from '../ui/overlay';

type Player = {
  id: string;
  label: string;
  color: number;
  shape: Phaser.GameObjects.Rectangle;
  body: Phaser.Physics.Arcade.Body;
  score: number;
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
};

const PLAYER_SPEED = 220;
const DASH_SPEED = 420;
const DASH_COOLDOWN = 800;
const DASH_DURATION = 180;
const HOOK_RANGE = 280;
const HOOK_DURATION = 500;
const HOOK_PULL_SPEED = 340;
const HOOK_COOLDOWN = 1800;
const MAX_SPAWN_ATTEMPTS = 30;

export class ArenaScene extends Phaser.Scene {
  private overlay?: Overlay;
  private players: Player[] = [];
  private energy?: Phaser.Physics.Arcade.Group;
  private rareEnergy?: Phaser.Physics.Arcade.Group;
  private hazards?: Phaser.Physics.Arcade.Group;
  private behaviorPickups?: Phaser.Physics.Arcade.Group;
  private obstacles?: Phaser.Physics.Arcade.StaticGroup;
  private lastDash: Record<string, number> = {};
  private dashState: Record<string, { direction: Phaser.Math.Vector2; until: number } | undefined> = {};
  private hookTimers: Record<string, number> = {};
  private activeHooks: Record<
    string,
    { target: Player; tether: Phaser.GameObjects.Line; expires: number } | undefined
  > = {};

  constructor() {
    super('Arena');
  }

  create(): void {
    // Ensure the scene restarts from a clean state by clearing player and dash tracking
    this.players = [];
    this.lastDash = {};
    this.dashState = {};
    this.hookTimers = {};
    this.activeHooks = {};

    this.createBackground();
    this.overlay = new Overlay();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.overlay?.destroy();
      this.overlay = undefined;
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.overlay?.destroy();
      this.overlay = undefined;
    });

    this.players.push(this.createPlayer({
      id: 'p1',
      label: 'Player 1',
      color: 0x7f5af0,
      x: 200,
      y: 300,
      keys: this.createKeys(['W', 'S', 'A', 'D']),
      dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      hook: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)
    }));

    this.players.push(this.createPlayer({
      id: 'p2',
      label: 'Player 2',
      color: 0xff8906,
      x: 600,
      y: 300,
      keys: this.createKeys(['UP', 'DOWN', 'LEFT', 'RIGHT']),
      dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      hook: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P)
    }));

    this.obstacles = this.physics.add.staticGroup();
    this.createObstacles();

    this.energy = this.physics.add.group();
    this.rareEnergy = this.physics.add.group();
    this.hazards = this.physics.add.group();
    this.behaviorPickups = this.physics.add.group();

    this.spawnEnergyOrbs();
    this.spawnRareEnergy();
    this.spawnHazards();
    this.spawnBehaviorPickups();

    const playerShapes = this.players.map((p) => p.shape);
    if (this.obstacles) {
      this.physics.add.collider(playerShapes, this.obstacles);
      if (this.hazards) {
        this.physics.add.collider(this.hazards, this.obstacles);
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
      if (player.score >= 10) {
        this.scene.restart();
      } else {
        this.spawnEnergyOrbs(1);
      }
    });

    this.physics.add.overlap(playerShapes, this.rareEnergy, (_playerShape, energy) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const orb = energy as Phaser.GameObjects.Arc;
      if (!player || !orb.active) return;
      orb.destroy();
      player.score += 3;
      this.spawnRareEnergy(1);
    });

    this.physics.add.overlap(playerShapes, this.hazards, (_playerShape, hazard) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      const orb = hazard as Phaser.GameObjects.Arc;
      if (!player || !orb.active) return;
      orb.destroy();
      player.score = Math.max(0, player.score - 2);
      this.applyHazardPenalty(player);
      this.spawnHazards(1);
    });

    this.physics.add.overlap(playerShapes, this.behaviorPickups, (_playerShape, pickup) => {
      const player = this.players.find((p) => p.shape === _playerShape);
      if (!player) return;
      const item = pickup as Phaser.GameObjects.Shape;
      const effect = item.getData('effect');
      item.destroy();
      if (effect === 'boost') {
        this.applySpeedModifier(player, 1.5, 3500);
      } else if (effect === 'slow') {
        this.applySpeedModifier(player, 0.6, 3500);
      }
      this.spawnBehaviorPickups(1);
    });
  }

  update(): void {
    this.players.forEach((player) => this.updatePlayerMovement(player));
    this.updateHooks();
    this.overlay?.update(this.players.map((player) => this.toScoreState(player)));
  }

  private updatePlayerMovement(player: Player): void {
    const body = player.body;
    const { up, down, left, right } = player.controls;

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
      controls: config.keys,
      dashKey: config.dash,
      hookKey: config.hook,
      speedMultiplier: 1
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

  private spawnEnergyOrbs(count = 5): void {
    if (!this.energy) return;
    for (let i = 0; i < count; i += 1) {
      const position = this.findSpawnPosition(12);
      if (!position) continue;
      const orb = this.add.circle(position.x, position.y, 10, 0x2cb67d, 0.8);
      this.physics.add.existing(orb);
      this.energy.add(orb);
    }
  }

  private spawnRareEnergy(count = 1): void {
    if (!this.rareEnergy) return;
    for (let i = 0; i < count; i += 1) {
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const orb = this.add.star(position.x, position.y, 5, 8, 14, 0xffd803, 0.9);
      this.physics.add.existing(orb);
      this.rareEnergy.add(orb);
    }
  }

  private spawnHazards(count = 2): void {
    if (!this.hazards) return;
    for (let i = 0; i < count; i += 1) {
      const position = this.findSpawnPosition(16);
      if (!position) continue;
      const orb = this.add.circle(position.x, position.y, 12, 0xff5470, 0.9);
      this.physics.add.existing(orb);
      const body = orb.body as Phaser.Physics.Arcade.Body;
      body.setCircle(12);
      body.setVelocity(Phaser.Math.Between(-40, 40), Phaser.Math.Between(-40, 40));
      body.setBounce(1, 1);
      body.setCollideWorldBounds(true);
      this.hazards.add(orb);
    }
  }

  private spawnBehaviorPickups(count = 2): void {
    if (!this.behaviorPickups) return;
    const effects: Array<'boost' | 'slow'> = ['boost', 'slow'];
    for (let i = 0; i < count; i += 1) {
      const position = this.findSpawnPosition(14);
      if (!position) continue;
      const effect = effects[(i + Phaser.Math.Between(0, effects.length - 1)) % effects.length];
      const color = effect === 'boost' ? 0x00f0ff : 0xff006e;
      const pickup = this.add.polygon(position.x, position.y, this.createRegularPolygonPoints(6, 16), color, 0.85);
      pickup.setData('effect', effect);
      this.physics.add.existing(pickup);
      this.behaviorPickups.add(pickup);
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

  private applySpeedModifier(player: Player, multiplier: number, duration: number): void {
    player.speedMultiplier = multiplier;
    player.speedResetTimer?.remove(false);
    player.speedResetTimer = this.time.delayedCall(duration, () => {
      player.speedMultiplier = 1;
      player.speedResetTimer = undefined;
    });
  }

  private attemptHook(player: Player): void {
    if (this.time.now - (this.hookTimers[player.id] ?? 0) < HOOK_COOLDOWN) {
      return;
    }
    const target = this.players.find((p) => p.id !== player.id);
    if (!target) return;
    const distance = Phaser.Math.Distance.Between(player.shape.x, player.shape.y, target.shape.x, target.shape.y);
    if (distance > HOOK_RANGE) {
      return;
    }

    this.activeHooks[player.id]?.tether.destroy();
    const tether = this.add.line(
      0,
      0,
      player.shape.x,
      player.shape.y,
      target.shape.x,
      target.shape.y,
      player.color,
      0.75
    );
    tether.setLineWidth(2, 2);
    this.activeHooks[player.id] = { target, tether, expires: this.time.now + HOOK_DURATION };
    this.hookTimers[player.id] = this.time.now;
  }

  private updateHooks(): void {
    Object.entries(this.activeHooks).forEach(([playerId, hook]) => {
      if (!hook) return;
      const shooter = this.players.find((p) => p.id === playerId);
      if (!shooter) {
        hook.tether.destroy();
        this.activeHooks[playerId] = undefined;
        return;
      }
      if (hook.expires <= this.time.now) {
        hook.tether.destroy();
        this.activeHooks[playerId] = undefined;
        return;
      }
      hook.tether.setTo(shooter.shape.x, shooter.shape.y, hook.target.shape.x, hook.target.shape.y);
      const pullVector = new Phaser.Math.Vector2(shooter.shape.x - hook.target.shape.x, shooter.shape.y - hook.target.shape.y);
      if (pullVector.lengthSq() > 0) {
        pullVector.normalize();
        hook.target.body.setVelocity(pullVector.x * HOOK_PULL_SPEED, pullVector.y * HOOK_PULL_SPEED);
      }
    });
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

    const overlapsGroup = (group?: Phaser.GameObjects.Group) =>
      group?.getChildren().some((child) => {
        const withBounds = child as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.GetBounds;
        if (!withBounds.getBounds) {
          return false;
        }
        return Phaser.Geom.Intersects.RectangleToRectangle(bounds, withBounds.getBounds());
      }) ?? false;

    return (
      overlapsGroup(this.energy) ||
      overlapsGroup(this.rareEnergy) ||
      overlapsGroup(this.hazards) ||
      overlapsGroup(this.behaviorPickups)
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

  private toScoreState(player: Player): ScoreState {
    const lastDash = this.lastDash[player.id] ?? -Infinity;
    const elapsed = this.time.now - lastDash;
    const remaining = Math.max(0, DASH_COOLDOWN - elapsed);
    const dashReady = remaining <= 0;
    const dashPercent = dashReady ? 1 : 1 - remaining / DASH_COOLDOWN;

    return {
      id: player.id,
      label: player.label,
      value: player.score,
      color: `#${player.color.toString(16).padStart(6, '0')}`,
      dashReady,
      dashPercent
    };
  }

  private createObstacles(): void {
    if (!this.obstacles) return;
    const configs = [
      { x: 400, y: 200, width: 160, height: 24 },
      { x: 400, y: 400, width: 160, height: 24 },
      { x: 200, y: 300, width: 24, height: 140 },
      { x: 600, y: 300, width: 24, height: 140 }
    ];
    configs.forEach((config) => {
      const block = this.add.rectangle(config.x, config.y, config.width, config.height, 0x0f0e17, 0.8);
      this.physics.add.existing(block, true);
      this.obstacles?.add(block);
    });
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

  shutdown(): void {
    this.overlay?.destroy();
    Object.values(this.activeHooks).forEach((hook) => hook?.tether.destroy());
    this.activeHooks = {};
  }
}
