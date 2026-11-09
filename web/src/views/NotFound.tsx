import { href } from '../lib/router';

export function NotFound() {
  return (
    <div class="page narrow">
      <p class="nf-code" aria-hidden="true">404</p>
      <h1>Page not found</h1>
      <p class="lede">Nothing lives at this address. The site has energy-transition challenges, a battery-materials atlas and feasibility studies.</p>
      <a class="btn" href={href.challenges()}>Back to the challenges</a>
    </div>
  );
}
