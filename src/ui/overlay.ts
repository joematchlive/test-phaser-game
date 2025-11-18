export type ScoreState = {
  id: string;
  label: string;
  value: number;
  color: string;
};

export class Overlay {
  private scoreboard: HTMLDivElement;
  private controlHints: HTMLDivElement;

  constructor() {
    this.scoreboard = document.createElement('div');
    this.scoreboard.className = 'scoreboard';
    document.body.appendChild(this.scoreboard);

    this.controlHints = document.createElement('div');
    this.controlHints.className = 'control-hints';
    this.controlHints.innerHTML = `
      <span>Player 1: WASD + Shift Dash</span>
      <span>Player 2: Arrow Keys + Enter Dash</span>
      <span>Collect energy orbs. First to 10 wins.</span>
    `;
    document.body.appendChild(this.controlHints);
  }

  update(scores: ScoreState[]): void {
    this.scoreboard.innerHTML = scores
      .map((score) => `<span style="color:${score.color}">${score.label}: ${score.value}</span>`)
      .join('<br />');
  }

  destroy(): void {
    this.scoreboard.remove();
    this.controlHints.remove();
  }
}
