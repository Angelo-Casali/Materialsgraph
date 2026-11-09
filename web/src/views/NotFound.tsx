import { href } from '../lib/router';

export function NotFound() {
  return (
    <div class="page narrow center">
      <p class="kicker">Here be dragons</p>
      <h1>Uncharted territory</h1>
      <p>This page is not on the map. The site covers energy-transition challenges, battery materials, feasibility studies and how the data is gathered.</p>
      <a class="btn" href={href.challenges()}>Back to the start</a>
    </div>
  );
}
