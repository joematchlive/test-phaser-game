export type ScoreState = {
  id: string;
  label: string;
  value: number;
  color: string;
};

export class Overlay {
  private scoreboard: HTMLDivElement;
  private instructionPanel: HTMLDivElement;
  private instructionToggle: HTMLButtonElement;

  constructor() {
    this.scoreboard = document.createElement('div');
    this.scoreboard.className = 'scoreboard';
    document.body.appendChild(this.scoreboard);

    this.instructionPanel = document.createElement('div');
    this.instructionPanel.className = 'instruction-panel';
    this.instructionPanel.innerHTML = `
      <h3>How to play</h3>
      <ul>
        <li><strong>Player 1:</strong> WASD to move, Shift to Dash</li>
        <li><strong>Player 2:</strong> Arrow Keys to move, Enter to Dash</li>
        <li>Collect energy orbs. First to reach 10 wins.</li>
        <li>Use Dash to burst through tight spaces.</li>
      </ul>
    `;
    document.body.appendChild(this.instructionPanel);

    this.instructionToggle = document.createElement('button');
    this.instructionToggle.className = 'instruction-toggle';
    this.instructionToggle.type = 'button';
    this.instructionToggle.setAttribute('aria-expanded', 'false');
    this.instructionToggle.textContent = 'Show Instructions';
    this.instructionToggle.addEventListener('click', () => this.toggleInstructions());
    document.body.appendChild(this.instructionToggle);
  }

  update(scores: ScoreState[]): void {
    this.scoreboard.innerHTML = scores
      .map((score) => `<span style="color:${score.color}">${score.label}: ${score.value}</span>`)
      .join('<br />');
  }

  private toggleInstructions(): void {
    const expanded = this.instructionToggle.getAttribute('aria-expanded') === 'true';
    this.instructionToggle.setAttribute('aria-expanded', String(!expanded));
    this.instructionToggle.textContent = expanded ? 'Show Instructions' : 'Hide Instructions';
    this.instructionPanel.classList.toggle('instruction-panel--visible', !expanded);
  }

  destroy(): void {
    this.scoreboard.remove();
    this.instructionPanel.remove();
    this.instructionToggle.remove();
  }
}
