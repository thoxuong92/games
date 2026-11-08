(function () {
  if (new URLSearchParams(location.search).has('frame_id')) return;
  var a = document.createElement('a');
  a.id = 'joukyuu-home';
  a.href = 'https://game.joukyuu.com/';
  a.textContent = '← Joukyuu Games';
  a.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.45);color:#fff;font:700 13px/1.4 system-ui,sans-serif;text-decoration:none';
  document.body.appendChild(a);
})();
