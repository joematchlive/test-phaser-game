import Phaser from 'phaser';
import {
  clampSetting,
  cycleLevel,
  getActiveSettings,
  getLevelById,
  getModeMetadata,
  setMode,
  updateSettings
} from '../state/settings';
import type { GameMode, GameSettings } from '../state/settings';

type StepperConfig = {
  label: string;
  adjust: (delta: number) => void;
  getValue: () => string;
  description?: () => string;
};

type StepperSection = {
  label: string;
  description: string;
  steppers: StepperConfig[];
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

    const sections: StepperSection[] = [
      {
        label: 'Match flow',
        description: 'Tweak victory conditions and pacing for each round.',
        steppers: [
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
            label: 'Mode',
            adjust: (delta) => this.cycleMode(delta > 0 ? 1 : -1),
            getValue: () => getModeMetadata(getActiveSettings().mode).label,
            description: () => getModeMetadata(getActiveSettings().mode).description
          },
          {
            label: 'Chaser tags to win',
            adjust: (delta) => {
              const next = Phaser.Math.Clamp(getActiveSettings().chaserTagGoal + delta, 1, 8);
              updateSettings({ chaserTagGoal: next });
            },
            getValue: () => `${getActiveSettings().chaserTagGoal} tags`,
            description: () => 'Pursuit: how many clean tags the Chaser needs.'
          },
          {
            label: 'Mode timer',
            adjust: (delta) => {
              const next = Phaser.Math.Clamp(getActiveSettings().modeTimerSeconds + delta * 15, 0, 240);
              updateSettings({ modeTimerSeconds: next });
            },
            getValue: () => {
              const seconds = getActiveSettings().modeTimerSeconds;
              return seconds > 0 ? `${seconds}s` : 'Off';
            },
            description: () => 'Pursuit: survival timer for collectors. Set to 0 to disable the clock.'
          },
          {
            label: 'Boundary behavior',
            adjust: (delta) => this.cycleBoundaryBehavior(delta > 0 ? 1 : -1),
            getValue: () =>
              getActiveSettings().boundaryBehavior === 'collide' ? 'Collide' : 'Wrap through',
            description: () =>
              getActiveSettings().boundaryBehavior === 'collide'
                ? 'Bounce off the arena edges for crisp wall play.'
                : 'Slip past the arena edges and re-enter from the opposite side.'
          }
        ]
      },
      {
        label: 'Arena layout',
        description: 'Control what spawns into the arena and how busy it feels.',
        steppers: [
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
            label: 'Arena layout',
            adjust: (delta) => cycleLevel(delta > 0 ? 1 : -1),
            getValue: () => getLevelById(getActiveSettings().levelId).name,
            description: () => getLevelById(getActiveSettings().levelId).description
          }
        ]
      }
    ];

    let activeSectionIndex = 0;
    const sectionTitle = this.add.text(this.scale.width / 2, 130, sections[0].label, {
      fontSize: '26px',
      fontFamily: 'Space Mono, monospace',
      color: '#f0f4f8'
    });
    sectionTitle.setOrigin(0.5);

    const sectionHint = this.add.text(this.scale.width / 2, 160, sections[0].description, {
      fontSize: '16px',
      fontFamily: 'Space Mono, monospace',
      color: '#a7a9be',
      align: 'center',
      wordWrap: { width: 540 }
    });
    sectionHint.setOrigin(0.5);

    const tabButtons = sections.map((section, index) =>
      this.createTabButton(
        this.scale.width / 2 + (index - (sections.length - 1) / 2) * 200,
        200,
        section.label,
        () => {
          if (activeSectionIndex === index) {
            return;
          }
          activeSectionIndex = index;
          sectionTitle.setText(section.label);
          sectionHint.setText(section.description);
          tabButtons.forEach((tab, tabIndex) =>
            tab.setStyle(
              tabIndex === activeSectionIndex
                ? { backgroundColor: 'rgba(255,255,255,0.12)', color: '#fffffe' }
                : { backgroundColor: 'rgba(255,255,255,0.04)', color: '#a7a9be' }
            )
          );
          renderSection();
        }
      )
    );

    tabButtons[0].setStyle({ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fffffe' });

    let stepContainer: Phaser.GameObjects.Container | undefined;
    let stepMask: Phaser.GameObjects.Rectangle | undefined;
    let scrollY = 0;
    let contentHeight = 0;

    const viewportTop = 230;
    const viewportHeight = 300;
    const itemSpacing = 100;
    const estimatedStepperHeight = 120;

    const updateScroll = (delta: number) => {
      if (!stepContainer) {
        return;
      }

      if (contentHeight <= viewportHeight) {
        scrollY = 0;
      } else {
        scrollY = Phaser.Math.Clamp(scrollY + delta, viewportHeight - contentHeight, 0);
      }

      stepContainer.setY(scrollY);
    };

    const renderSection = () => {
      if (stepContainer) {
        stepContainer.removeAll(true);
        stepContainer.destroy();
      }

      stepMask?.destroy();

      scrollY = 0;
      stepContainer = undefined;
      stepMask = undefined;

      const section = sections[activeSectionIndex];

      stepContainer = this.add.container(0, 0);
      stepMask = this.add.rectangle(this.scale.width / 2, viewportTop, 680, viewportHeight, 0x000000, 0);
      stepMask.setOrigin(0.5, 0);
      stepContainer.setMask(stepMask.createGeometryMask());

      section.steppers.forEach((stepper, index) => {
        const y = viewportTop + index * itemSpacing;
        const created = this.createStepper(stepper, y);
        stepContainer?.add(created);
      });

      contentHeight = section.steppers.length
        ? (section.steppers.length - 1) * itemSpacing + estimatedStepperHeight
        : 0;

      updateScroll(0);
    };

    renderSection();

    this.events.on('settings:mode-updated', () => renderSection());

    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      updateScroll(-dy * 0.5);
    });

    this.input.keyboard?.on('keydown-UP', () => updateScroll(30));
    this.input.keyboard?.on('keydown-DOWN', () => updateScroll(-30));

    this.createButton(this.scale.width / 2, this.scale.height - 80, 'Back to menu', () => {
      this.scene.start('Menu');
    });

    this.input.keyboard?.once('keydown-ESC', () => this.scene.start('Menu'));
  }

  private createStepper(config: StepperConfig, y: number): Phaser.GameObjects.GameObject[] {
    const created: Phaser.GameObjects.GameObject[] = [];
    const label = this.add.text(this.scale.width / 2, y, config.label, {
      fontSize: '20px',
      fontFamily: 'Space Mono, monospace',
      color: '#fffffe'
    });
    label.setOrigin(0.5);
    created.push(label);

    const valueText = this.add.text(this.scale.width / 2, y + 28, config.getValue(), {
      fontSize: '22px',
      fontFamily: 'Space Mono, monospace',
      color: '#2cb67d'
    });
    valueText.setOrigin(0.5);
    created.push(valueText);

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
      created.push(description);
    }

    [left, right].forEach((button) => button.setData('valueText', valueText));
    created.push(left, right);
    return created;
  }

  private createTabButton(x: number, y: number, label: string, handler: () => void): Phaser.GameObjects.Text {
    const tab = this.add.text(x, y, label, {
      fontSize: '18px',
      fontFamily: 'Space Mono, monospace',
      color: '#a7a9be',
      backgroundColor: 'rgba(255,255,255,0.04)',
      padding: { left: 28, right: 28, top: 10, bottom: 10 }
    });
    tab.setOrigin(0.5);
    tab.setInteractive({ useHandCursor: true });
    tab.on('pointerover', () => {
      if (tab.style.color !== '#fffffe') {
        tab.setStyle({ color: '#fffffe' });
      }
    });
    tab.on('pointerout', () => {
      if (tab.style.backgroundColor !== 'rgba(255,255,255,0.12)') {
        tab.setStyle({ color: '#a7a9be' });
      }
    });
    tab.on('pointerup', handler);
    return tab;
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
    const modes: GameMode[] = ['classic', 'minefield', 'pursuit'];
    const current = getActiveSettings().mode;
    const index = modes.indexOf(current);
    const next = modes[(index + direction + modes.length) % modes.length];
    setMode(next);
    this.events.emit('settings:mode-updated');
  }

  private cycleBoundaryBehavior(direction: 1 | -1): void {
    const behaviors: Array<GameSettings['boundaryBehavior']> = ['collide', 'wrap'];
    const current = getActiveSettings().boundaryBehavior;
    const index = behaviors.indexOf(current);
    const next = behaviors[(index + direction + behaviors.length) % behaviors.length];
    updateSettings({ boundaryBehavior: next });
  }

}
