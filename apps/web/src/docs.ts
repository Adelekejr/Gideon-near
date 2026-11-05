import { initChrome } from "./chrome";

initChrome("Docs");

const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".docs-toc a"));
const sections = links
  .map((a) => document.getElementById((a.getAttribute("href") ?? "").slice(1)))
  .filter((el): el is HTMLElement => !!el);

if (sections.length && "IntersectionObserver" in window) {
  const mark = (id: string) => links.forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${id}` ? "true" : "false"));
  const io = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (vis) mark(vis.target.id);
  }, { rootMargin: "-15% 0px -55% 0px", threshold: [0.1, 0.4] });
  sections.forEach((s) => io.observe(s));
  mark(sections[0].id);
}
