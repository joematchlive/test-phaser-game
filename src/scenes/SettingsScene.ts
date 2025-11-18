import Phaser from 'phaser';
import { clampSetting, cycleLevel, getActiveSettings, getLevelById, getModeMetadata, updateSettings } from '../state/settings';
import type { GameMode } from '../state/settings';

type StepperConfig = {
  label: string;
  adjust: (delta: number) => void;
  getValue: () => string;
  description?: () => string;
};

export class SettingsScene extends Phaser.Scene {
  constructor() {
    super('Settings');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0f0e17');
    this.addBackground();

    const title = this.add.text(this.scale.width / 2, 80, 'Arena Settings', {
      fontSize: '36px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe'
    });
    title.setOrigin(0.5);

    const steppers: StepperConfig[] = [
      {
        label: 'Target score',
        adjust: (delta) => clampSetting('winningScore', delta, 5, 20),
        getValue: () => `${getActiveSettings().winningScore} pts`
      },
      {
        label: 'Debt limit',
        adjust: (delta) => {
          const current = getActiveSettings().negativeLossThreshold;
          const next = Phaser.Math.Clamp(current + delta, -10, -1);
          updateSettings({ negativeLossThreshold: next });
        },
        getValue: () => `${getActiveSettings().negativeLossThreshold} pts`,
        description: () => 'Drop to this negative score and your craft forfeits the round.'
      },
      {
        label: 'Energy orbs',
        adjust: (delta) => clampSetting('energyCount', delta, 3, 10),
        getValue: () => `${getActiveSettings().energyCount} on spawn`
      },
      {
        label: 'Hazards',
        adjust: (delta) => clampSetting('hazardCount', delta, 0, 5),
        getValue: () => `${getActiveSettings().hazardCount} live`
      },
      {
        label: 'Behavior pickups',
        adjust: (delta) => clampSetting('behaviorPickupCount', delta, 0, 4),
        getValue: () => `${getActiveSettings().behaviorPickupCount} modifiers`
      },
      {
        label: 'Mode',
        adjust: (delta) => this.cycleMode(delta > 0 ? 1 : -1),
        getValue: () => getModeMetadata(getActiveSettings().mode).label,
        description: () => getModeMetadata(getActiveSettings().mode).description
      },
      {
        label: 'Arena layout',
        adjust: (delta) => cycleLevel(delta > 0 ? 1 : -1),
        getValue: () => getLevelById(getActiveSettings().levelId).name,
        description: () => getLevelById(getActiveSettings().levelId).description
      }
    ];

    let offsetY = 160;
    steppers.forEach((stepper) => {
      this.createStepper(stepper, offsetY);
      offsetY += 90;
    });

    this.createButton(this.scale.width / 2, this.scale.height - 80, 'Back to menu', () => {
      this.scene.start('Menu');
    });

    this.input.keyboard?.once('keydown-ESC', () => this.scene.start('Menu'));
  }

  private createStepper(config: StepperConfig, y: number): void {
    const label = this.add.text(this.scale.width / 2, y, config.label, {
      fontSize: '20px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe'
    });
    label.setOrigin(0.5);

    const valueText = this.add.text(this.scale.width / 2, y + 28, config.getValue(), {
      fontSize: '22px',
      fontFamily: 'Space Mono, monospace',
      color: '#2cb67d'
    });
    valueText.setOrigin(0.5);

    const left = this.addStepperButton(this.scale.width / 2 - 120, y + 28, '<', () => {
      config.adjust(-1);
      valueText.setText(config.getValue());
      description?.setText(config.description?.() ?? '');
    });

    const right = this.addStepperButton(this.scale.width / 2 + 120, y + 28, '>', () => {
      config.adjust(1);
      valueText.setText(config.getValue());
      description?.setText(config.description?.() ?? '');
    });

    let description: Phaser.GameObjects.Text | undefined;
    if (config.description) {
      description = this.add.text(this.scale.width / 2, y + 62, config.description(), {
        fontSize: '14px',
        fontFamily: 'Space Mono, monospace',
        color: '#a7a9be',
        align: 'center',
        wordWrap: { width: 520 }
      });
      description.setOrigin(0.5);
    }

    [left, right].forEach((button) => button.setData('valueText', valueText));
  }

  private addStepperButton(x: number, y: number, label: string, handler: () => void): Phaser.GameObjects.Text {
    const button = this.add.text(x, y, label, {
      fontSize: '28px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe',
      backgroundColor: 'rgba(255,255,255,0.05)',
      padding: { left: 12, right: 12, top: 4, bottom: 4 }
    });
    button.setOrigin(0.5);
    button.setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setStyle({ color: '#2cb67d' }));
    button.on('pointerout', () => button.setStyle({ color: '#fffffe' }));
    button.on('pointerup', handler);
    return button;
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

  private addBackground(): void {
    const grid = this.add.graphics({ lineStyle: { width: 1, color: 0xff8906, alpha: 0.08 } });
    for (let x = 0; x < this.scale.width; x += 40) {
      grid.lineBetween(x, 0, x, this.scale.height);
    }
    for (let y = 0; y < this.scale.height; y += 40) {
      grid.lineBetween(0, y, this.scale.width, y);
    }
  }

  private cycleMode(direction: 1 | -1): void {
    const modes: GameMode[] = ['classic', 'minefield'];
    const current = getActiveSettings().mode;
    const index = modes.indexOf(current);
    const next = modes[(index + direction + modes.length) % modes.length];
    updateSettings({ mode: next });
  }

}
