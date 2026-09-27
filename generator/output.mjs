// The block pasted into a Publii post, below the post's YouTube embed.

export function youtubeId(input) {
  const s = input.trim();
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/.exec(s);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : null;
}

/** "1:05.5" or "65.5" → seconds; null if unreadable. */
export function parseTime(text) {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  if (m[1] !== undefined && parseFloat(m[2]) >= 60) return null;
  return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
}

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function snippet({ svg, videoId, sync, endX, script }) {
  return `<div class="lanna-score" data-youtube-id="${attr(videoId)}" data-sync="${attr(JSON.stringify(sync))}" data-end-x="${endX.toFixed(1)}">
${svg}
</div>
<script>
${script}
</script>
`;
}
