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
  controls: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
};

const PLAYER_SPEED = 220;
const DASH_SPEED = 420;
const DASH_COOLDOWN = 800;
const DASH_DURATION = 180;

export class ArenaScene extends Phaser.Scene {
  private overlay?: Overlay;
  private players: Player[] = [];
  private energy?: Phaser.Physics.Arcade.Group;
  private lastDash: Record<string, number> = {};
  private dashState: Record<string, { direction: Phaser.Math.Vector2; until: number } | undefined> = {};

  constructor() {
    super('Arena');
  }

  create(): void {
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
      dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)
    }));

    this.players.push(this.createPlayer({
      id: 'p2',
      label: 'Player 2',
      color: 0xff8906,
      x: 600,
      y: 300,
      keys: this.createKeys(['UP', 'DOWN', 'LEFT', 'RIGHT']),
      dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER)
    }));

    this.energy = this.physics.add.group();
    this.spawnEnergyOrbs();
    this.physics.add.overlap(this.players.map((p) => p.shape), this.energy, (_playerShape, energy) => {
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
  }

  update(): void {
    this.players.forEach((player) => this.updatePlayerMovement(player));
    this.overlay?.update(this.players.map(this.toScoreState));
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
    body.setVelocity(velocity.x * PLAYER_SPEED, velocity.y * PLAYER_SPEED);

    const dashReady = this.time.now - (this.lastDash[player.id] ?? 0) >= DASH_COOLDOWN;
    const hasInput = velocity.lengthSq() > 0;
    if (dashReady && hasInput && Phaser.Input.Keyboard.JustDown(player.dashKey)) {
      const direction = velocity.clone();
      this.dashState[player.id] = { direction, until: this.time.now + DASH_DURATION };
      this.lastDash[player.id] = this.time.now;
      body.setVelocity(direction.x * DASH_SPEED, direction.y * DASH_SPEED);
      this.addDashBurst(player.shape.x, player.shape.y, player.color);
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
      dashKey: config.dash
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
      const x = Phaser.Math.Between(50, this.scale.width - 50);
      const y = Phaser.Math.Between(50, this.scale.height - 50);
      const orb = this.add.circle(x, y, 10, 0x2cb67d, 0.8);
      this.physics.add.existing(orb);
      this.energy.add(orb);
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

  private toScoreState(player: Player): ScoreState {
    return {
      id: player.id,
      label: player.label,
      value: player.score,
      color: `#${player.color.toString(16).padStart(6, '0')}`
    };
  }

  shutdown(): void {
    this.overlay?.destroy();
  }
}
