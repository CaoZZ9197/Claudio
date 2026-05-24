/**
 * Claudio Theme Loader
 * 支持 URL 参数切换主题：?theme=dark | ?theme=light
 * 本地存储记住用户偏好
 */
(function () {
  const THEME_KEY = "claudio-theme";
  const themeLink = document.getElementById("theme-stylesheet");

  function getThemeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("theme");
  }

  function getThemeFromStorage() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function saveTheme(name) {
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch {
      // storage not available
    }
  }

  function applyTheme(name) {
    if (!themeLink) return;

    const validThemes = ["dark", "light"];
    const theme = validThemes.includes(name) ? name : "dark";

    themeLink.href = `/themes/${theme}.css`;
    saveTheme(theme);
    document.documentElement.setAttribute("data-theme", theme);
  }

  // 优先级：URL 参数 > 本地存储 > 默认 dark
  const urlTheme = getThemeFromUrl();
  const storedTheme = getThemeFromStorage();
  applyTheme(urlTheme || storedTheme || "dark");

  // 暴露 API 给其他脚本
  window.ClaudioTheme = {
    set: applyTheme,
    get: () => document.documentElement.getAttribute("data-theme"),
  };
})();
