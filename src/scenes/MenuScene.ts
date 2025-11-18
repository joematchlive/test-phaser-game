import Phaser from 'phaser';
import { getActiveSettings, getLevelById, getModeMetadata } from '../state/settings';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0f0e17');
    this.addBackground();

    const title = this.add.text(this.scale.width / 2, 140, 'Neon Tethers', {
      fontSize: '48px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe'
    });
    title.setOrigin(0.5);

    const tagline = this.add.text(this.scale.width / 2, 200, 'A two-player energy tug-of-war', {
      fontSize: '20px',
      fontFamily: 'Space Mono, monospace',
      color: '#a7a9be'
    });
    tagline.setOrigin(0.5);

    this.createButton(this.scale.width / 2, 300, 'New Quick Match', () => {
      this.scene.start('Arena');
    });

    this.createButton(this.scale.width / 2, 360, 'Settings', () => {
      this.scene.start('Settings');
    });

    const settings = getActiveSettings();
    const level = getLevelById(settings.levelId);

    const levelInfo = this.add.text(
      this.scale.width / 2,
      440,
      `Level: ${level.name}\n${level.description}`,
      {
        fontSize: '18px',
        fontFamily: 'Space Mono, monospace',
        color: '#2cb67d',
        align: 'center',
        wordWrap: { width: 520 }
      }
    );
    levelInfo.setOrigin(0.5);

    const modeMeta = getModeMetadata(settings.mode);
    const modeInfo = this.add.text(
      this.scale.width / 2,
      500,
      `Mode: ${modeMeta.label}\n${modeMeta.description}`,
      {
        fontSize: '16px',
        fontFamily: 'Space Mono, monospace',
        color: '#fffffe',
        align: 'center',
        wordWrap: { width: 520 }
      }
    );
    modeInfo.setOrigin(0.5);

    const hint = this.add.text(this.scale.width / 2, 560, 'Change arena layouts in Settings, press ESC anytime to come back.', {
      fontSize: '14px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe',
      align: 'center'
    });
    hint.setOrigin(0.5);
  }

  private addBackground(): void {
    const grid = this.add.graphics({ lineStyle: { width: 1, color: 0x2cb67d, alpha: 0.1 } });
    for (let x = 0; x < this.scale.width; x += 48) {
      grid.lineBetween(x, 0, x, this.scale.height);
    }
    for (let y = 0; y < this.scale.height; y += 48) {
      grid.lineBetween(0, y, this.scale.width, y);
    }
  }

  private createButton(x: number, y: number, label: string, handler: () => void): void {
    const button = this.add.text(x, y, label, {
      fontSize: '24px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe',
      backgroundColor: 'rgba(255,255,255,0.08)',
      padding: { left: 24, right: 24, top: 12, bottom: 12 }
    });
    button.setOrigin(0.5);
    button.setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setStyle({ backgroundColor: 'rgba(44,182,125,0.4)' }));
    button.on('pointerout', () => button.setStyle({ backgroundColor: 'rgba(255,255,255,0.08)' }));
    button.on('pointerup', handler);
  }
}
