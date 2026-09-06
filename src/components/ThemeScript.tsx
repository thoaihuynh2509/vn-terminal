/**
 * Runs before first paint to stamp data-theme on <html>, so a dark-mode reader
 * never sees a white flash. Mirrors the reference site's cookie approach but
 * uses localStorage — there is no server-rendered theme dependency here.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
