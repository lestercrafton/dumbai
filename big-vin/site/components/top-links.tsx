import {ArrowUpRight} from 'lucide-react';

/** Slim bar above every page linking to Lester's NFL DFS project. */
export default function TopLinks() {
  return <div className="vin-top-links">
    <a className="vin-milly-link" href="https://millymate.sitetime.workers.dev" target="_blank" rel="noopener noreferrer">
      Milly (NFL DFS) <ArrowUpRight size={14} aria-hidden="true"/><span className="sr-only"> (opens in a new tab)</span>
    </a>
  </div>;
}
