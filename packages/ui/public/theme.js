// Sets the viewer's theme before the page is drawn, so it does not flash.
try {
  const theme = JSON.parse(localStorage.getItem("looku") || "{}").theme;
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  }
} catch {
  // Storage blocked: the system theme is used.
}
