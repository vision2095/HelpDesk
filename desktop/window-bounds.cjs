function workspaceBounds(saved, area) {
  const valid = saved && ["x", "y", "width", "height"].every((key) => Number.isFinite(saved[key]));
  const width = Math.min(area.width, Math.max(1000, valid ? saved.width : 1280));
  const height = Math.min(area.height, Math.round(width / 1.4), Math.max(680, valid ? saved.height : 800));
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(valid ? saved.x : area.x + (area.width - width) / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(valid ? saved.y : area.y + (area.height - height) / 2, area.y + area.height - height))),
  };
}

function floatingBounds(area) {
  const width = Math.max(1, Math.min(1040, area.width - 32));
  const height = Math.max(1, Math.min(620, Math.round(width * 0.6), area.height - 64));
  return {
    width,
    height,
    x: area.x + area.width - width - Math.min(16, Math.max(0, (area.width - width) / 2)),
    y: area.y + Math.min(40, Math.max(0, area.height - height)),
  };
}

module.exports = { workspaceBounds, floatingBounds };
