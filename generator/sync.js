(() => {
  // Partition qui défile avec la vidéo YouTube (générée par /generator/).
  // Chaque <div class="lanna-score"> porte data-youtube-id, data-sync (deux
  // repères {time, x}) et data-end-x (fin de la partition, en px).
  const MARKER_WIDTH = 40;
  const TARGET = 0.33; // le repère se fixe à 33 % de la largeur

  const scores = [];
  for (const block of document.querySelectorAll('.lanna-score')) {
    const id = block.dataset.youtubeId;
    const svg = block.querySelector('svg');
    const iframe = [...document.querySelectorAll('iframe')].find((f) => f.src.includes('/embed/' + id));
    if (!svg || !iframe) {
      console.error('lanna-score : partition ou vidéo introuvable', id);
      continue;
    }
    const [a, b] = JSON.parse(block.dataset.sync);
    block.style.overflow = 'hidden';
    block.style.width = '100%';
    block.style.position = 'relative';
    svg.style.display = 'block';

    // Repère de lecture : bande large, car la synchronisation n'est pas parfaite.
    const marker = document.createElement('div');
    marker.style.cssText =
      'position:absolute;top:0;bottom:0;left:0;' +
      `width:${MARKER_WIDTH}px;margin-left:${-MARKER_WIDTH / 2}px;` +
      'background:rgba(220,40,40,.22);' +
      'border-left:2px solid rgba(220,40,40,.6);' +
      'border-right:2px solid rgba(220,40,40,.6);' +
      'pointer-events:none;';
    block.appendChild(marker);

    const url = new URL(iframe.src, location.href);
    if (url.searchParams.get('enablejsapi') !== '1') {
      url.searchParams.set('enablejsapi', '1');
      url.searchParams.set('origin', location.origin);
      iframe.src = url.toString();
    }
    scores.push({ block, svg, marker, iframe, a, speed: (b.x - a.x) / (b.time - a.time), endX: +block.dataset.endX, width: +svg.getAttribute('width'), player: null });
  }
  if (!scores.length) return;

  function update(s) {
    // Le repère s'arrête juste avant la fin de la partition
    const x = Math.min(s.a.x + (s.player.getCurrentTime() - s.a.time) * s.speed, s.endX - MARKER_WIDTH / 2);
    const view = s.block.getBoundingClientRect().width;
    // Pas de défilement avant 33 %, ni au-delà de la fin (ni vers la droite
    // quand la partition est plus étroite que l'écran)
    const shift = Math.max(Math.min(0, view - s.width), Math.min(0, view * TARGET - x));
    s.svg.style.transform = `translateX(${shift}px)`;
    s.marker.style.transform = `translateX(${x + shift}px)`;
  }

  function loop() {
    for (const s of scores) if (s.player && typeof s.player.getCurrentTime === 'function') update(s);
    requestAnimationFrame(loop);
  }

  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (typeof previous === 'function') previous();
    for (const s of scores) s.player = new window.YT.Player(s.iframe, {});
    requestAnimationFrame(loop);
  };

  if (window.YT && window.YT.Player) window.onYouTubeIframeAPIReady();
  else {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }
})();
