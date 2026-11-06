/* Saved theme before first paint. Auto follows this device. */
(function () {
  var m = "", s = "";
  try {
    m = localStorage.getItem("gideon:theme") || "";
    s = localStorage.getItem("gideon:shift") || "";
  } catch (e) {}
  if (m !== "light" && m !== "dark" && m !== "system") {
    m = s === "night" || s === "plan" ? "dark" : s === "day" || s === "signal" ? "light" : "system";
  }
  var dark = m === "dark" || (m === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-mode", m);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
