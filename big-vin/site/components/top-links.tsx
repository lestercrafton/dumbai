import {ArrowUpRight} from 'lucide-react';

/** Slim bar above every page linking to Lester's NFL DFS project. */
export default function TopLinks() {
  return <div className="vin-top-links">
    <a className="vin-milly-link" href="https://millymate.lestercrafton.workers.dev" target="_blank" rel="noopener noreferrer">
      <img src="/milly-sigil.svg" width={30} height={30} alt="" aria-hidden="true"/>Milly (NFL DFS) <ArrowUpRight size={16} aria-hidden="true"/><span className="sr-only"> (opens in a new tab)</span>
    </a>
  </div>;
}
