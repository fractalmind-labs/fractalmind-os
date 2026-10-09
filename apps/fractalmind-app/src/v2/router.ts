// App v2 (#75): hash routes as in the prototype (#/hosts/<address>).
import { useEffect, useState } from "react";

export const PAGES = [
  "workbench",
  "okrs",
  "hosts",
  "agents",
  "memory",
  "governance",
  "identity",
  "settings",
  "orgs",
  "network",
] as const;
export type PageName = (typeof PAGES)[number];
export type Route = { name: PageName; parts: string[] };

export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const name = (PAGES as readonly string[]).includes(parts[0] ?? "") ? (parts[0] as PageName) : "workbench";
  return { name, parts: name === parts[0] ? parts : [name] };
}

export function go(path: string) {
  const hash = `#/${path.replace(/^#?\/?/, "")}`;
  if (location.hash !== hash) location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const change = () => {
      setRoute(parseRoute(location.hash));
      document.getElementById("main")?.scrollTo?.(0, 0);
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  return route;
}
