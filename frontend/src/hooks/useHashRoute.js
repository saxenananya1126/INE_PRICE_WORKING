import { useCallback, useEffect, useState } from "react";

// Tiny router: #/ (overview), #/find (search), #/product/660 (details). Works with the browser back button.
function parse(hash) {
  const product = /^#\/product\/(\d+)/.exec(hash);
  if (product) return { name: "product", id: Number(product[1]) };
  if (hash.startsWith("#/find")) return { name: "find" };
  return { name: "overview" };
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const go = useCallback((path) => {
    window.location.hash = path;
  }, []);

  return [route, go];
}
