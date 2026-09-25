import Link from "next/link";
import { OpenSourceBand } from "./github-star";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <OpenSourceBand />
      <nav aria-label="Site">
        <Link href="/about">About</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/leaderboard">Leaderboard</Link>
        <Link href="/city">Cities</Link>
        <Link href="/projects">Projects</Link>
        <Link href="/remove">Remove a pin</Link>
        <a href="https://github.com/nafisfaysal/makersmap" target="_blank" rel="noopener">GitHub</a>
      </nav>
      <p>A city-level atlas of makers. Pins listed from public intro posts stay out of search engines until claimed.</p>
    </footer>
  );
}
