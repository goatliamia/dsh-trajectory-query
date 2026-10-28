  // 勾选状态按会话记住:切回对话再回来,不应该被重置成默认全开。
  (function () {
    const key = 'geist.layers.' + (data.mainSession || 'local');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
    if (saved && typeof saved === 'object') {
      for (const [name, on] of Object.entries(saved.layers || {})) { if (on) overviewLayers.add(name); else overviewLayers.delete(name); }
      if (typeof geistActorLayers === 'object') for (const [name, on] of Object.entries(saved.actors || {})) geistActorLayers[name] = on;
    }
    let timer = 0;
    const save = () => {
      const layers = {}, actors = {};
      document.querySelectorAll('[data-br-layer]').forEach(input => { layers[input.dataset.brLayer] = input.checked; });
      document.querySelectorAll('[data-actor-layer]').forEach(input => { actors[input.dataset.actorLayer] = input.checked; });
      try { localStorage.setItem(key, JSON.stringify({ layers, actors })); } catch { /* 存不下就算了 */ }
    };
    document.addEventListener('change', event => {
      const input = event.target;
      if (!input || !input.matches || !input.matches('[data-br-layer],[data-actor-layer]')) return;
      if (input.dataset.brLayer) { input.checked ? overviewLayers.add(input.dataset.brLayer) : overviewLayers.delete(input.dataset.brLayer); }
      else if (typeof geistActorLayers === 'object') geistActorLayers[input.dataset.actorLayer] = input.checked;
      clearTimeout(timer); timer = setTimeout(save, 120);
    }, true);
  })();
